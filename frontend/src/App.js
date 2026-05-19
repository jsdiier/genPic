import { useState, useEffect } from "react";
import { SignedIn, SignedOut, SignInButton, UserButton, useUser } from "@clerk/clerk-react";

const BACKEND = "http://localhost:8000";

function App() {
  const { user } = useUser();
  // const { getToken } = useAuth();
  const [prompt, setPrompt] = useState("");
  const [taskId, setTaskId] = useState(null);
  const [imageUrl, setImageUrl] = useState(null);
  const [status, setStatus] = useState("");
  const [balance, setBalance] = useState(null);

  // 用户登录后初始化
  useEffect(() => {
    if (user) {
      fetch(`${BACKEND}/init_user`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ clerk_user_id: user.id })
      })
      .then(res => res.json())
      .then(data => setBalance(data.balance));
    }
  }, [user]);

  // 提交任务
  const handleGenerate = async () => {
    if (!prompt) return;
    setStatus("提交中...");
    setImageUrl(null);

    const res = await fetch(`${BACKEND}/generate`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ clerk_user_id: user.id, prompt })
    });

    if (res.status === 402) {
      setStatus("余额不足，请充值");
      return;
    }

    const data = await res.json();
    setTaskId(data.task_id);
    setStatus("生成中，请稍候...");
  };

  // 轮询结果
  useEffect(() => {
    if (!taskId) return;
    const timer = setInterval(async () => {
      const res = await fetch(`${BACKEND}/result/${taskId}`);
      const data = await res.json();
      if (data.status === "done") {
        setImageUrl(data.image_url);
        setStatus("生成成功！");
        setBalance(b => b - 1);
        clearInterval(timer);
      } else if (data.status === "failed") {
        setStatus("生成失败，请重试");
        clearInterval(timer);
      }
    }, 2000);
    return () => clearInterval(timer);
  }, [taskId]);

  return (
    <div style={{ minHeight: "100vh", background: "#f0f2f5", padding: 40 }}>
      <div style={{ maxWidth: 600, margin: "0 auto", background: "white", padding: 40, borderRadius: 12, boxShadow: "0 2px 12px rgba(0,0,0,0.1)" }}>

        <SignedOut>
          <div style={{ textAlign: "center" }}>
            <h2>AI 文生图</h2>
            <p>请先登录后使用</p>
            <SignInButton mode="modal">
              <button style={{ padding: "10px 24px", fontSize: 16, background: "#4f8ef7", color: "white", border: "none", borderRadius: 6, cursor: "pointer" }}>
                登录 / 注册
              </button>
            </SignInButton>
          </div>
        </SignedOut>

        <SignedIn>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 24 }}>
            <h2 style={{ margin: 0 }}>AI 文生图</h2>
            <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
              <span style={{ color: "#666" }}>余额：{balance} 元</span>
              <UserButton />
            </div>
          </div>

          <textarea
            placeholder="输入你的 prompt，比如：一只可爱的小猫坐在窗边看雨"
            value={prompt}
            onChange={e => setPrompt(e.target.value)}
            style={{ width: "100%", padding: 12, fontSize: 16, border: "1px solid #ddd", borderRadius: 6, minHeight: 100, resize: "vertical", boxSizing: "border-box" }}
          />

          <button
            onClick={handleGenerate}
            style={{ width: "100%", padding: "12px 0", fontSize: 16, background: "#4f8ef7", color: "white", border: "none", borderRadius: 6, cursor: "pointer", marginTop: 12 }}
          >
            生成图片
          </button>

          {status && (
            <p style={{ textAlign: "center", color: "#666", marginTop: 16 }}>{status}</p>
          )}

          {imageUrl && (
            <img src={imageUrl} alt="生成结果" style={{ width: "100%", borderRadius: 8, marginTop: 16 }} />
          )}
        </SignedIn>

      </div>
    </div>
  );
}

export default App;