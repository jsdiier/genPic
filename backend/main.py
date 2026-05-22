from fastapi import FastAPI, Header, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
import sqlite3
import requests
import oss2
import uuid
import os

app = FastAPI()

app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "http://localhost:3000",
        "https://gen-pic-six.vercel.app"
    ],
    allow_methods=["*"],
    allow_headers=["*"],
)

# =====================
# 数据库初始化
# =====================
conn = sqlite3.connect("tasks.db", check_same_thread=False)
conn.row_factory = sqlite3.Row
conn.execute("""
    CREATE TABLE IF NOT EXISTS users (
        clerk_user_id TEXT PRIMARY KEY,
        balance INTEGER DEFAULT 0
    )
""")
conn.execute("""
    CREATE TABLE IF NOT EXISTS tasks (
        task_id TEXT PRIMARY KEY,
        clerk_user_id TEXT,
        prompt TEXT,
        status TEXT DEFAULT 'pending',
        image_url TEXT
    )
""")
conn.execute("""
    CREATE TABLE IF NOT EXISTS sessions (
        session_id TEXT PRIMARY KEY,
        clerk_user_id TEXT,
        title TEXT,
        created_at TEXT
    )
""")
conn.execute("""
    CREATE TABLE IF NOT EXISTS messages (
        message_id TEXT PRIMARY KEY,
        session_id TEXT,
        type TEXT,
        content TEXT,
        created_at TEXT
    )
""")
conn.commit()

# =====================
# 配置
# =====================
API_KEY = os.environ.get("NANO_API_KEY")
OPENAI_API_KEY = os.environ.get("OPENAI_API_KEY")
API_URL = "https://api.nanobananaapi.ai/api/v1/nanobanana/generate-2"
CALLBACK_URL = "https://genpic-pgye.onrender.com/callback"




# =====================
# 用户初始化
# =====================
class UserInit(BaseModel):
    clerk_user_id: str

class SetBalanceRequest(BaseModel):
    clerk_user_id: str
    amount: int
    admin_key: str

@app.post("/init_user")
def init_user(body: UserInit):
    existing = conn.execute(
        "SELECT * FROM users WHERE clerk_user_id=?", (body.clerk_user_id,)
    ).fetchone()
    if not existing:
        conn.execute(
            "INSERT INTO users (clerk_user_id, balance) VALUES (?, ?)",
            (body.clerk_user_id, 1)
        )
        conn.commit()
        return {"msg": "用户创建成功", "balance": 1}
    return {"msg": "用户已存在", "balance": existing["balance"]}

# =====================
# 查询余额
# =====================
@app.get("/balance/{clerk_user_id}")
def get_balance(clerk_user_id: str):
    user = conn.execute(
        "SELECT balance FROM users WHERE clerk_user_id=?", (clerk_user_id,)
    ).fetchone()
    if not user:
        raise HTTPException(status_code=404, detail="用户不存在")
    return {"balance": user["balance"]}



@app.post("/admin/set_balance")
def set_balance(body: SetBalanceRequest):
    if body.admin_key != "760828":
        raise HTTPException(status_code=403, detail="无权限")
    conn.execute(
        "UPDATE users SET balance=? WHERE clerk_user_id=?",
        (body.amount, body.clerk_user_id)
    )
    conn.commit()
    return {"msg": "设置成功"}

# =====================
# 提交文生图任务
# =====================
class GenerateRequest(BaseModel):
    clerk_user_id: str
    prompt: str
    aspect_ratio: str = "auto"
    resolution: str = "1K"

@app.post("/generate")
def generate(body: GenerateRequest):
    # 查余额
    user = conn.execute(
        "SELECT balance FROM users WHERE clerk_user_id=?", (body.clerk_user_id,)
    ).fetchone()
    if not user or user["balance"] < 1:
        raise HTTPException(status_code=402, detail="余额不足，请充值")

    # 提交给 Nano
    headers = {
        "Authorization": f"Bearer {API_KEY}",
        "Content-Type": "application/json"
    }
    payload = {
        "prompt": body.prompt,
        "imageUrls": [],
        "aspectRatio": body.aspect_ratio,
        "resolution": body.resolution,
        "outputFormat": "jpg",
        "callBackUrl": CALLBACK_URL
    }
    response = requests.post(API_URL, headers=headers, json=payload)
    result = response.json()

    if result["code"] != 200:
        raise HTTPException(status_code=500, detail="Nano 平台提交失败")

    task_id = result["data"]["taskId"]

    # 存任务
    conn.execute(
        "INSERT INTO tasks (task_id, clerk_user_id, prompt, status) VALUES (?, ?, ?, ?)",
        (task_id, body.clerk_user_id, body.prompt, "pending")
    )
    conn.commit()

    return {"task_id": task_id}


class GPTGenerateRequest(BaseModel):
    clerk_user_id: str
    prompt: str
    size: str = "1024x1024"
    quality: str = "medium"

@app.post("/gpt/generate")
def gpt_generate_api(body: GPTGenerateRequest):
    user = conn.execute(
        "SELECT balance FROM users WHERE clerk_user_id=?", (body.clerk_user_id,)
    ).fetchone()
    if not user or user["balance"] < 1:
        raise HTTPException(status_code=402, detail="余额不足，请充值")

    image_url = gpt_generate(body.prompt, body.size, body.quality)

    task_id = str(uuid.uuid4())
    conn.execute(
        "INSERT INTO tasks (task_id, clerk_user_id, prompt, status, image_url) VALUES (?, ?, ?, ?, ?)",
        (task_id, body.clerk_user_id, body.prompt, "done", image_url)
    )
    conn.execute(
        "UPDATE users SET balance=balance-1 WHERE clerk_user_id=?",
        (body.clerk_user_id,)
    )
    conn.commit()

    return {"task_id": task_id, "image_url": image_url}

@app.post("/gpt/img2img")
async def gpt_img2img_api(
    prompt: str = Form(...),
    clerk_user_id: str = Form(...),
    size: str = Form("1024x1024"),
    quality: str = Form("medium"),
    files: list[UploadFile] = File(...)
):
    user = conn.execute(
        "SELECT balance FROM users WHERE clerk_user_id=?", (clerk_user_id,)
    ).fetchone()
    if not user or user["balance"] < 1:
        raise HTTPException(status_code=402, detail="余额不足，请充值")

    # 先上传到 OSS 拿到 URL
    image_urls = []
    for file in files:
        file_content = await file.read()
        file_ext = file.filename.split(".")[-1]
        oss_key = f"uploads/{uuid.uuid4()}.{file_ext}"
        bucket.put_object(oss_key, file_content)
        image_urls.append(f"https://{OSS_BUCKET}.{OSS_ENDPOINT}/{oss_key}")

    image_url = gpt_img2img(prompt, image_urls, size, quality)

    task_id = str(uuid.uuid4())
    conn.execute(
        "INSERT INTO tasks (task_id, clerk_user_id, prompt, status, image_url) VALUES (?, ?, ?, ?, ?)",
        (task_id, clerk_user_id, prompt, "done", image_url)
    )
    conn.execute(
        "UPDATE users SET balance=balance-1 WHERE clerk_user_id=?",
        (clerk_user_id,)
    )
    conn.commit()

    return {"task_id": task_id, "image_url": image_url, "image_urls": image_urls}

# =====================
# 图生图接口
# =====================
from fastapi import UploadFile, File, Form

# =====================
# OSS 配置
# =====================
import os

OSS_ACCESS_KEY_ID = os.environ.get("OSS_ACCESS_KEY_ID")
OSS_ACCESS_KEY_SECRET = os.environ.get("OSS_ACCESS_KEY_SECRET")
OSS_BUCKET = "genpic-images"
OSS_ENDPOINT = "oss-cn-shanghai.aliyuncs.com"

auth = oss2.Auth(OSS_ACCESS_KEY_ID, OSS_ACCESS_KEY_SECRET)
bucket = oss2.Bucket(auth, OSS_ENDPOINT, OSS_BUCKET)

import openai
import io

def gpt_generate(prompt: str, size: str = "1024x1024", quality: str = "medium") -> str:
    client = openai.OpenAI(api_key=OPENAI_API_KEY)
    result = client.images.generate(
        model="gpt-image-2",
        prompt=prompt,
        size=size,
        quality=quality,
        response_format="b64_json"
    )
    import base64
    image_bytes = base64.b64decode(result.data[0].b64_json)
    oss_key = f"gpt/{uuid.uuid4()}.jpg"
    bucket.put_object(oss_key, image_bytes)
    return f"https://{OSS_BUCKET}.{OSS_ENDPOINT}/{oss_key}"

def gpt_img2img(prompt: str, image_urls: list, size: str = "1024x1024", quality: str = "medium") -> str:
    client = openai.OpenAI(api_key=OPENAI_API_KEY)
    image_files = []
    for url in image_urls:
        resp = requests.get(url)
        image_files.append(io.BytesIO(resp.content))
    result = client.images.edit(
        model="gpt-image-2",
        image=image_files,
        prompt=prompt,
        size=size,
        quality=quality
    )
    import base64
    image_bytes = base64.b64decode(result.data[0].b64_json)
    oss_key = f"gpt/{uuid.uuid4()}.jpg"
    bucket.put_object(oss_key, image_bytes)
    return f"https://{OSS_BUCKET}.{OSS_ENDPOINT}/{oss_key}"

@app.post("/img2img")
async def img2img(
    prompt: str = Form(...),
    clerk_user_id: str = Form(...),
    aspect_ratio: str = Form("auto"),
    resolution: str = Form("1K"),
    files: list[UploadFile] = File(...)
):
    # 查余额
    user = conn.execute(
        "SELECT balance FROM users WHERE clerk_user_id=?", (clerk_user_id,)
    ).fetchone()
    if not user or user["balance"] < 1:
        raise HTTPException(status_code=402, detail="余额不足，请充值")

    # 上传多张图片到 OSS
    image_urls = []
    for file in files:
        file_content = await file.read()
        file_ext = file.filename.split(".")[-1]
        oss_key = f"uploads/{uuid.uuid4()}.{file_ext}"
        bucket.put_object(oss_key, file_content)
        image_url = f"https://{OSS_BUCKET}.{OSS_ENDPOINT}/{oss_key}"
        image_urls.append(image_url)
        print(f"OSS URL: {image_url}")

    # 提交给 Nano
    headers = {
        "Authorization": f"Bearer {API_KEY}",
        "Content-Type": "application/json"
    }
    payload = {
        "prompt": prompt,
        "imageUrls": image_urls,
        "aspectRatio": aspect_ratio,
        "resolution": resolution,
        "outputFormat": "jpg",
        "callBackUrl": CALLBACK_URL
    }
    response = requests.post(API_URL, headers=headers, json=payload)
    result = response.json()

    if result["code"] != 200:
        raise HTTPException(status_code=500, detail="Nano 平台提交失败")

    task_id = result["data"]["taskId"]

    # 存任务
    conn.execute(
        "INSERT INTO tasks (task_id, clerk_user_id, prompt, status) VALUES (?, ?, ?, ?)",
        (task_id, clerk_user_id, prompt, "pending")
    )
    conn.commit()

    return {"task_id": task_id, "image_urls": image_urls}

# =====================
# Nano 回调
# =====================
@app.post("/callback")
def callback(data: dict):
    if data.get("code") == 200:
        task_id = data["data"]["taskId"]
        image_url = data["data"]["info"]["resultImageUrl"]
        clerk_user_id = conn.execute(
            "SELECT clerk_user_id FROM tasks WHERE task_id=?", (task_id,)
        ).fetchone()["clerk_user_id"]

        # 存图片，扣余额
        conn.execute(
            "UPDATE tasks SET status='done', image_url=? WHERE task_id=?",
            (image_url, task_id)
        )
        conn.execute(
            "UPDATE users SET balance=balance-1 WHERE clerk_user_id=?",
            (clerk_user_id,)
        )
        conn.commit()
    else:
        task_id = data["data"]["taskId"]
        conn.execute(
            "UPDATE tasks SET status='failed' WHERE task_id=?", (task_id,)
        )
        conn.commit()

    return {"msg": "ok"}

# =====================
# 轮询结果
# =====================
@app.get("/result/{task_id}")
def get_result(task_id: str):
    task = conn.execute(
        "SELECT status, image_url FROM tasks WHERE task_id=?", (task_id,)
    ).fetchone()
    if not task:
        raise HTTPException(status_code=404, detail="任务不存在")
    return {"status": task["status"], "image_url": task["image_url"]}

# =====================
# 管理员充值
# =====================
class RechargeRequest(BaseModel):
    clerk_user_id: str
    amount: int
    admin_key: str

@app.post("/admin/recharge")
def recharge(body: RechargeRequest):
    if body.admin_key != "760828":
        raise HTTPException(status_code=403, detail="无权限")
    conn.execute(
        "UPDATE users SET balance=balance+? WHERE clerk_user_id=?",
        (body.amount, body.clerk_user_id)
    )
    conn.commit()
    return {"msg": "充值成功"}

import datetime

# =====================
# Session 接口
# =====================
class CreateSessionRequest(BaseModel):
    clerk_user_id: str
    title: str

@app.post("/sessions/create")
def create_session(body: CreateSessionRequest):
    session_id = str(uuid.uuid4())
    created_at = datetime.datetime.now().isoformat()
    conn.execute(
        "INSERT INTO sessions (session_id, clerk_user_id, title, created_at) VALUES (?, ?, ?, ?)",
        (session_id, body.clerk_user_id, body.title, created_at)
    )
    conn.commit()
    return {"session_id": session_id}

@app.get("/sessions/{clerk_user_id}")
def get_sessions(clerk_user_id: str):
    sessions = conn.execute(
        "SELECT * FROM sessions WHERE clerk_user_id=? ORDER BY created_at DESC",
        (clerk_user_id,)
    ).fetchall()
    return {"sessions": [dict(s) for s in sessions]}

class SaveMessageRequest(BaseModel):
    session_id: str
    type: str
    content: str

@app.post("/messages/save")
def save_message(body: SaveMessageRequest):
    message_id = str(uuid.uuid4())
    created_at = datetime.datetime.now().isoformat()
    conn.execute(
        "INSERT INTO messages (message_id, session_id, type, content, created_at) VALUES (?, ?, ?, ?, ?)",
        (message_id, body.session_id, body.type, body.content, created_at)
    )
    conn.commit()
    return {"message_id": message_id}

@app.get("/messages/{session_id}")
def get_messages(session_id: str):
    messages = conn.execute(
        "SELECT * FROM messages WHERE session_id=? ORDER BY created_at ASC",
        (session_id,)
    ).fetchall()
    return {"messages": [dict(m) for m in messages]}

class UpdateSessionTitleRequest(BaseModel):
    session_id: str
    title: str

@app.put("/sessions/update_title")
def update_session_title(body: UpdateSessionTitleRequest):
    conn.execute(
        "UPDATE sessions SET title=? WHERE session_id=?",
        (body.title, body.session_id)
    )
    conn.commit()
    return {"msg": "更新成功"}

@app.delete("/sessions/{session_id}")
def delete_session(session_id: str):
    conn.execute("DELETE FROM sessions WHERE session_id=?", (session_id,))
    conn.execute("DELETE FROM messages WHERE session_id=?", (session_id,))
    conn.commit()
    return {"msg": "删除成功"}