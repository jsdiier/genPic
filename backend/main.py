from fastapi import FastAPI, Header, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
import sqlite3
import requests
import oss2
import uuid

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
conn.commit()

# =====================
# 配置
# =====================
API_KEY = "d21a6f21367e966a41c225bac07eb9f4"
API_URL = "https://api.nanobananaapi.ai/api/v1/nanobanana/generate"
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
        "type": "TEXTTOIAMGE",
        "numImages": 1,
        "image_size": "1:1",
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

@app.post("/img2img")
async def img2img(
    prompt: str = Form(...),
    clerk_user_id: str = Form(...),
    file: UploadFile = File(...)
):
    # 查余额
    user = conn.execute(
        "SELECT balance FROM users WHERE clerk_user_id=?", (clerk_user_id,)
    ).fetchone()
    if not user or user["balance"] < 1:
        raise HTTPException(status_code=402, detail="余额不足，请充值")

    # 上传图片到 OSS
    file_content = await file.read()
    file_ext = file.filename.split(".")[-1]
    oss_key = f"uploads/{uuid.uuid4()}.{file_ext}"
    bucket.put_object(oss_key, file_content)
    image_url = f"https://{OSS_BUCKET}.{OSS_ENDPOINT}/{oss_key}"

    # 提交给 Nano
    headers = {
        "Authorization": f"Bearer {API_KEY}",
        "Content-Type": "application/json"
    }
    payload = {
        "prompt": prompt,
        "type": "IMAGETOIAMGE",
        "numImages": 1,
        "image_size": "1:1",
        "callBackUrl": CALLBACK_URL,
        "imageUrls": [image_url]
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

    return {"task_id": task_id}

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