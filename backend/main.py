from fastapi import FastAPI, HTTPException, UploadFile, File, Form, Depends
from fastapi.middleware.cors import CORSMiddleware
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials
from pydantic import BaseModel
import sqlite3
import requests
import oss2
import uuid
import threading
import os
import datetime
import hashlib
import jwt  # pip install PyJWT

app = FastAPI()

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],  # 上线后改成你的具体域名
    allow_methods=["*"],
    allow_headers=["*"],
)

# =====================
# 数据库初始化
# =====================
conn = sqlite3.connect("/data/tasks.db", check_same_thread=False)
conn.row_factory = sqlite3.Row
conn.execute("""
    CREATE TABLE IF NOT EXISTS users (
        user_id TEXT PRIMARY KEY,
        username TEXT UNIQUE NOT NULL,
        password_hash TEXT NOT NULL,
        balance INTEGER DEFAULT 1
    )
""")
conn.execute("""
    CREATE TABLE IF NOT EXISTS tasks (
        task_id TEXT PRIMARY KEY,
        user_id TEXT,
        prompt TEXT,
        status TEXT DEFAULT 'pending',
        image_url TEXT
    )
""")
conn.execute("""
    CREATE TABLE IF NOT EXISTS sessions (
        session_id TEXT PRIMARY KEY,
        user_id TEXT,
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
JWT_SECRET = os.environ.get("JWT_SECRET", "change-this-to-a-random-secret")
API_URL = "https://api.nanobananaapi.ai/api/v1/nanobanana/generate-2"
CALLBACK_URL = "https://genpic-pgye.onrender.com/callback"

OSS_ACCESS_KEY_ID = os.environ.get("OSS_ACCESS_KEY_ID")
OSS_ACCESS_KEY_SECRET = os.environ.get("OSS_ACCESS_KEY_SECRET")
OSS_BUCKET = "genpic-images"
OSS_ENDPOINT = "oss-cn-shanghai.aliyuncs.com"

auth_oss = oss2.Auth(OSS_ACCESS_KEY_ID, OSS_ACCESS_KEY_SECRET)
bucket = oss2.Bucket(auth_oss, OSS_ENDPOINT, OSS_BUCKET)

# =====================
# JWT 工具
# =====================
security = HTTPBearer()

def hash_password(password: str) -> str:
    return hashlib.sha256(password.encode()).hexdigest()

def create_token(user_id: str, username: str) -> str:
    payload = {
        "user_id": user_id,
        "username": username,
        "exp": datetime.datetime.utcnow() + datetime.timedelta(days=30)
    }
    return jwt.encode(payload, JWT_SECRET, algorithm="HS256")

def get_current_user(credentials: HTTPAuthorizationCredentials = Depends(security)):
    token = credentials.credentials
    try:
        payload = jwt.decode(token, JWT_SECRET, algorithms=["HS256"])
        return payload  # 包含 user_id 和 username
    except jwt.ExpiredSignatureError:
        raise HTTPException(status_code=401, detail="Token 已过期，请重新登录")
    except jwt.InvalidTokenError:
        raise HTTPException(status_code=401, detail="无效的 Token")

# =====================
# 注册 / 登录
# =====================
class RegisterRequest(BaseModel):
    username: str
    password: str

class LoginRequest(BaseModel):
    username: str
    password: str

@app.post("/register")
def register(body: RegisterRequest):
    if len(body.username.strip()) < 2:
        raise HTTPException(status_code=400, detail="用户名至少2个字符")
    if len(body.password) < 6:
        raise HTTPException(status_code=400, detail="密码至少6位")

    existing = conn.execute(
        "SELECT user_id FROM users WHERE username=?", (body.username,)
    ).fetchone()
    if existing:
        raise HTTPException(status_code=400, detail="用户名已被占用")

    user_id = str(uuid.uuid4())
    password_hash = hash_password(body.password)
    conn.execute(
        "INSERT INTO users (user_id, username, password_hash, balance) VALUES (?, ?, ?, ?)",
        (user_id, body.username, password_hash, 1)
    )
    conn.commit()

    token = create_token(user_id, body.username)
    return {"token": token, "username": body.username, "balance": 1}

@app.post("/login")
def login(body: LoginRequest):
    user = conn.execute(
        "SELECT * FROM users WHERE username=?", (body.username,)
    ).fetchone()
    if not user or user["password_hash"] != hash_password(body.password):
        raise HTTPException(status_code=401, detail="用户名或密码错误")

    token = create_token(user["user_id"], user["username"])
    return {"token": token, "username": user["username"], "balance": user["balance"]}

# =====================
# 查询余额
# =====================
@app.get("/balance")
def get_balance(current_user=Depends(get_current_user)):
    user = conn.execute(
        "SELECT balance FROM users WHERE user_id=?", (current_user["user_id"],)
    ).fetchone()
    if not user:
        raise HTTPException(status_code=404, detail="用户不存在")
    return {"balance": user["balance"]}

# =====================
# 管理员接口
# =====================
class SetBalanceRequest(BaseModel):
    username: str
    amount: int
    admin_key: str

class RechargeRequest(BaseModel):
    username: str
    amount: int
    admin_key: str

ADMIN_KEY = os.environ.get("ADMIN_KEY", "change-this-admin-key")

@app.post("/admin/set_balance")
def set_balance(body: SetBalanceRequest):
    if body.admin_key != ADMIN_KEY:
        raise HTTPException(status_code=403, detail="无权限")
    conn.execute(
        "UPDATE users SET balance=? WHERE username=?",
        (body.amount, body.username)
    )
    conn.commit()
    return {"msg": "设置成功"}

@app.post("/admin/recharge")
def recharge(body: RechargeRequest):
    if body.admin_key != ADMIN_KEY:
        raise HTTPException(status_code=403, detail="无权限")
    conn.execute(
        "UPDATE users SET balance=balance+? WHERE username=?",
        (body.amount, body.username)
    )
    conn.commit()
    return {"msg": "充值成功"}

# =====================
# 文生图 - Nano
# =====================
class GenerateRequest(BaseModel):
    prompt: str
    aspect_ratio: str = "auto"
    resolution: str = "1K"

@app.post("/generate")
def generate(body: GenerateRequest, current_user=Depends(get_current_user)):
    user_id = current_user["user_id"]
    user = conn.execute("SELECT balance FROM users WHERE user_id=?", (user_id,)).fetchone()
    if not user or user["balance"] < 1:
        raise HTTPException(status_code=402, detail="余额不足，请充值")

    headers = {"Authorization": f"Bearer {API_KEY}", "Content-Type": "application/json"}
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
    conn.execute(
        "INSERT INTO tasks (task_id, user_id, prompt, status) VALUES (?, ?, ?, ?)",
        (task_id, user_id, body.prompt, "pending")
    )
    conn.commit()
    return {"task_id": task_id}

# =====================
# 文生图 - GPT
# =====================
class GPTGenerateRequest(BaseModel):
    prompt: str
    size: str = "1024x1024"
    quality: str = "medium"

def run_gpt_generate(task_id, prompt, size, quality, user_id):
    try:
        image_url = gpt_generate(prompt, size, quality)
        conn.execute("UPDATE tasks SET status='done', image_url=? WHERE task_id=?", (image_url, task_id))
        conn.execute("UPDATE users SET balance=balance-1 WHERE user_id=?", (user_id,))
        conn.commit()
    except Exception as e:
        print(f"GPT generate error: {e}")
        conn.execute("UPDATE tasks SET status='failed' WHERE task_id=?", (task_id,))
        conn.commit()

@app.post("/gpt/generate")
def gpt_generate_api(body: GPTGenerateRequest, current_user=Depends(get_current_user)):
    user_id = current_user["user_id"]
    user = conn.execute("SELECT balance FROM users WHERE user_id=?", (user_id,)).fetchone()
    if not user or user["balance"] < 1:
        raise HTTPException(status_code=402, detail="余额不足，请充值")

    task_id = str(uuid.uuid4())
    conn.execute(
        "INSERT INTO tasks (task_id, user_id, prompt, status) VALUES (?, ?, ?, ?)",
        (task_id, user_id, body.prompt, "pending")
    )
    conn.commit()

    thread = threading.Thread(target=run_gpt_generate, args=(task_id, body.prompt, body.size, body.quality, user_id))
    thread.start()
    return {"task_id": task_id}

# =====================
# 图生图 - Nano
# =====================
@app.post("/img2img")
async def img2img(
    prompt: str = Form(...),
    aspect_ratio: str = Form("auto"),
    resolution: str = Form("1K"),
    files: list[UploadFile] = File(...),
    current_user=Depends(get_current_user)
):
    user_id = current_user["user_id"]
    user = conn.execute("SELECT balance FROM users WHERE user_id=?", (user_id,)).fetchone()
    if not user or user["balance"] < 1:
        raise HTTPException(status_code=402, detail="余额不足，请充值")

    image_urls = []
    for file in files:
        file_content = await file.read()
        file_ext = file.filename.split(".")[-1]
        oss_key = f"uploads/{uuid.uuid4()}.{file_ext}"
        bucket.put_object(oss_key, file_content)
        image_urls.append(f"https://{OSS_BUCKET}.{OSS_ENDPOINT}/{oss_key}")

    headers = {"Authorization": f"Bearer {API_KEY}", "Content-Type": "application/json"}
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
    conn.execute(
        "INSERT INTO tasks (task_id, user_id, prompt, status) VALUES (?, ?, ?, ?)",
        (task_id, user_id, prompt, "pending")
    )
    conn.commit()
    return {"task_id": task_id, "image_urls": image_urls}

# =====================
# 图生图 - GPT
# =====================
def run_gpt_img2img(task_id, prompt, image_urls, size, quality, user_id):
    try:
        image_url = gpt_img2img(prompt, image_urls, size, quality)
        conn.execute("UPDATE tasks SET status='done', image_url=? WHERE task_id=?", (image_url, task_id))
        conn.execute("UPDATE users SET balance=balance-1 WHERE user_id=?", (user_id,))
        conn.commit()
    except Exception as e:
        print(f"GPT img2img error: {e}")
        conn.execute("UPDATE tasks SET status='failed' WHERE task_id=?", (task_id,))
        conn.commit()

@app.post("/gpt/img2img")
async def gpt_img2img_api(
    prompt: str = Form(...),
    size: str = Form("1024x1024"),
    quality: str = Form("medium"),
    files: list[UploadFile] = File(...),
    current_user=Depends(get_current_user)
):
    user_id = current_user["user_id"]
    user = conn.execute("SELECT balance FROM users WHERE user_id=?", (user_id,)).fetchone()
    if not user or user["balance"] < 1:
        raise HTTPException(status_code=402, detail="余额不足，请充值")

    image_urls = []
    for file in files:
        file_content = await file.read()
        file_ext = file.filename.split(".")[-1]
        oss_key = f"uploads/{uuid.uuid4()}.{file_ext}"
        bucket.put_object(oss_key, file_content)
        image_urls.append(f"https://{OSS_BUCKET}.{OSS_ENDPOINT}/{oss_key}")

    task_id = str(uuid.uuid4())
    conn.execute(
        "INSERT INTO tasks (task_id, user_id, prompt, status) VALUES (?, ?, ?, ?)",
        (task_id, user_id, prompt, "pending")
    )
    conn.commit()

    thread = threading.Thread(target=run_gpt_img2img, args=(task_id, prompt, image_urls, size, quality, user_id))
    thread.start()
    return {"task_id": task_id, "image_urls": image_urls}

# =====================
# OSS + OpenAI 工具函数
# =====================
import openai
import io
import base64

def gpt_generate(prompt: str, size: str = "1024x1024", quality: str = "medium") -> str:
    client = openai.OpenAI(api_key=OPENAI_API_KEY)
    result = client.images.generate(
        model="gpt-image-2",
        prompt=prompt,
        size=size,
        quality=quality
    )
    image_bytes = base64.b64decode(result.data[0].b64_json)
    oss_key = f"gpt/{uuid.uuid4()}.jpg"
    bucket.put_object(oss_key, image_bytes)
    return f"https://{OSS_BUCKET}.{OSS_ENDPOINT}/{oss_key}"

def gpt_img2img(prompt: str, image_urls: list, size: str = "1024x1024", quality: str = "medium") -> str:
    client = openai.OpenAI(api_key=OPENAI_API_KEY)
    image_files = []
    for url in image_urls:
        resp = requests.get(url)
        buf = io.BytesIO(resp.content)
        buf.name = "image.jpg"
        image_files.append(buf)
    result = client.images.edit(
        model="gpt-image-2",
        image=image_files,
        prompt=prompt,
        size=size,
        quality=quality
    )
    image_bytes = base64.b64decode(result.data[0].b64_json)
    oss_key = f"gpt/{uuid.uuid4()}.jpg"
    bucket.put_object(oss_key, image_bytes)
    return f"https://{OSS_BUCKET}.{OSS_ENDPOINT}/{oss_key}"

# =====================
# Nano 回调
# =====================
@app.post("/callback")
def callback(data: dict):
    if data.get("code") == 200:
        task_id = data["data"]["taskId"]
        image_url = data["data"]["info"]["resultImageUrl"]
        row = conn.execute("SELECT user_id FROM tasks WHERE task_id=?", (task_id,)).fetchone()
        if row:
            conn.execute("UPDATE tasks SET status='done', image_url=? WHERE task_id=?", (image_url, task_id))
            conn.execute("UPDATE users SET balance=balance-1 WHERE user_id=?", (row["user_id"],))
            conn.commit()
    else:
        task_id = data["data"]["taskId"]
        conn.execute("UPDATE tasks SET status='failed' WHERE task_id=?", (task_id,))
        conn.commit()
    return {"msg": "ok"}

# =====================
# 轮询结果
# =====================
@app.get("/result/{task_id}")
def get_result(task_id: str, current_user=Depends(get_current_user)):
    task = conn.execute("SELECT status, image_url FROM tasks WHERE task_id=?", (task_id,)).fetchone()
    if not task:
        raise HTTPException(status_code=404, detail="任务不存在")
    return {"status": task["status"], "image_url": task["image_url"]}

# =====================
# Session 接口
# =====================
class CreateSessionRequest(BaseModel):
    title: str

@app.post("/sessions/create")
def create_session(body: CreateSessionRequest, current_user=Depends(get_current_user)):
    session_id = str(uuid.uuid4())
    created_at = datetime.datetime.now().isoformat()
    conn.execute(
        "INSERT INTO sessions (session_id, user_id, title, created_at) VALUES (?, ?, ?, ?)",
        (session_id, current_user["user_id"], body.title, created_at)
    )
    conn.commit()
    return {"session_id": session_id}

@app.get("/sessions")
def get_sessions(current_user=Depends(get_current_user)):
    sessions = conn.execute(
        "SELECT * FROM sessions WHERE user_id=? ORDER BY created_at DESC",
        (current_user["user_id"],)
    ).fetchall()
    return {"sessions": [dict(s) for s in sessions]}

class SaveMessageRequest(BaseModel):
    session_id: str
    type: str
    content: str

@app.post("/messages/save")
def save_message(body: SaveMessageRequest, current_user=Depends(get_current_user)):
    message_id = str(uuid.uuid4())
    created_at = datetime.datetime.now().isoformat()
    conn.execute(
        "INSERT INTO messages (message_id, session_id, type, content, created_at) VALUES (?, ?, ?, ?, ?)",
        (message_id, body.session_id, body.type, body.content, created_at)
    )
    conn.commit()
    return {"message_id": message_id}

@app.get("/messages/{session_id}")
def get_messages(session_id: str, current_user=Depends(get_current_user)):
    messages = conn.execute(
        "SELECT * FROM messages WHERE session_id=? ORDER BY created_at ASC",
        (session_id,)
    ).fetchall()
    return {"messages": [dict(m) for m in messages]}

class UpdateSessionTitleRequest(BaseModel):
    session_id: str
    title: str

@app.put("/sessions/update_title")
def update_session_title(body: UpdateSessionTitleRequest, current_user=Depends(get_current_user)):
    conn.execute("UPDATE sessions SET title=? WHERE session_id=?", (body.title, body.session_id))
    conn.commit()
    return {"msg": "更新成功"}

@app.delete("/sessions/{session_id}")
def delete_session(session_id: str, current_user=Depends(get_current_user)):
    conn.execute("DELETE FROM sessions WHERE session_id=?", (session_id,))
    conn.execute("DELETE FROM messages WHERE session_id=?", (session_id,))
    conn.commit()
    return {"msg": "删除成功"}