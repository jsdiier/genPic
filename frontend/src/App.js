import { useState, useEffect } from "react";
import { SignedIn, SignedOut, SignInButton, UserButton, useUser } from "@clerk/clerk-react";

const BACKEND = "https://genpic-pgye.onrender.com";

function App() {
  const { user } = useUser();
  const [mode, setMode] = useState("text2img");
  const [prompt, setPrompt] = useState("");
  const [taskId, setTaskId] = useState(null);
  const [imageUrl, setImageUrl] = useState(null);
  const [status, setStatus] = useState("");
  const [balance, setBalance] = useState(null);
  const [dragOver, setDragOver] = useState(false);
  const [uploadedFiles, setUploadedFiles] = useState([]);
  const [previewUrls, setPreviewUrls] = useState([]);

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

  // 处理拖拽
  const handleDrop = (e) => {
    e.preventDefault();
    setDragOver(false);
    const newFiles = Array.from(e.dataTransfer.files)
      .filter(f => f.type.startsWith("image/"))
      .slice(0, 4 - uploadedFiles.length);
    setUploadedFiles(prev => [...prev, ...newFiles].slice(0, 4));
    setPreviewUrls(prev => [...prev, ...newFiles.map(f => URL.createObjectURL(f))].slice(0, 4));
  };

  const handleFileSelect = (e) => {
    const newFiles = Array.from(e.target.files)
      .filter(f => f.type.startsWith("image/"))
      .slice(0, 4 - uploadedFiles.length);
    setUploadedFiles(prev => [...prev, ...newFiles].slice(0, 4));
    setPreviewUrls(prev => [...prev, ...newFiles.map(f => URL.createObjectURL(f))].slice(0, 4));
  };

  const removeImage = (index) => {
    setUploadedFiles(prev => prev.filter((_, i) => i !== index));
    setPreviewUrls(prev => prev.filter((_, i) => i !== index));
  };

  // 提交任务
  const handleGenerate = async () => {
    if (!prompt) return;
    if (mode === "img2img" && uploadedFiles.length === 0) {
      setStatus("请先上传图片");
      return;
    }

    setStatus("提交中...");
    setImageUrl(null);

    let res;

    if (mode === "text2img") {
      res = await fetch(`${BACKEND}/generate`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ clerk_user_id: user.id, prompt })
      });
    } else {
      const formData = new FormData();
      formData.append("prompt", prompt);
      formData.append("clerk_user_id", user.id);
      uploadedFiles.forEach(file => formData.append("files", file));
      res = await fetch(`${BACKEND}/img2img`, {
        method: "POST",
        body: formData
      });
    }

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
            <h2>AI 绘图</h2>
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
            <h2 style={{ margin: 0 }}>AI 绘图</h2>
            <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
              <span style={{ color: "#666" }}>余额：{balance} 元</span>
              <UserButton />
            </div>
          </div>

          {/* 模式切换 */}
          <div style={{ display: "flex", marginBottom: 20, border: "1px solid #ddd", borderRadius: 8, overflow: "hidden" }}>
            <button
              onClick={() => setMode("text2img")}
              style={{ flex: 1, padding: "10px 0", border: "none", cursor: "pointer", background: mode === "text2img" ? "#4f8ef7" : "white", color: mode === "text2img" ? "white" : "#666", fontSize: 15 }}
            >
              文生图
            </button>
            <button
              onClick={() => setMode("img2img")}
              style={{ flex: 1, padding: "10px 0", border: "none", cursor: "pointer", background: mode === "img2img" ? "#4f8ef7" : "white", color: mode === "img2img" ? "white" : "#666", fontSize: 15 }}
            >
              图生图
            </button>
          </div>

          {/* 图生图上传区域 */}
          {mode === "img2img" && (
            <div
              onDrop={handleDrop}
              onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
              onDragLeave={() => setDragOver(false)}
              onClick={() => uploadedFiles.length < 4 && document.getElementById("fileInput").click()}
              style={{
                border: `2px dashed ${dragOver ? "#4f8ef7" : "#ddd"}`,
                borderRadius: 8,
                padding: 20,
                textAlign: "center",
                cursor: uploadedFiles.length < 4 ? "pointer" : "default",
                marginBottom: 16,
                background: dragOver ? "#f0f7ff" : "white"
              }}
            >
              {previewUrls.length > 0 ? (
                <div style={{ display: "flex", gap: 8, flexWrap: "wrap", justifyContent: "center" }}>
                  {previewUrls.map((url, i) => (
                    <div key={i} style={{ position: "relative" }}>
                      <img src={url} alt={`预览${i+1}`} style={{ width: 120, height: 120, objectFit: "cover", borderRadius: 6 }} />
                      <button
                        onClick={(e) => { e.stopPropagation(); removeImage(i); }}
                        style={{ position: "absolute", top: 4, right: 4, background: "rgba(0,0,0,0.5)", color: "white", border: "none", borderRadius: "50%", width: 20, height: 20, cursor: "pointer", fontSize: 12 }}
                      >
                        ×
                      </button>
                    </div>
                  ))}
                  {previewUrls.length < 4 && (
                    <div style={{ width: 120, height: 120, border: "2px dashed #ddd", borderRadius: 6, display: "flex", alignItems: "center", justifyContent: "center", color: "#999", fontSize: 24 }}>
                      +
                    </div>
                  )}
                </div>
              ) : (
                <p style={{ color: "#999", margin: 0 }}>拖拽最多4张图片，或点击上传</p>
              )}
              <input id="fileInput" type="file" accept="image/*" multiple onChange={handleFileSelect} style={{ display: "none" }} />
            </div>
          )}

          <textarea
            placeholder={mode === "text2img" ? "输入你的 prompt，比如：一只可爱的小猫坐在窗边看雨" : "输入你想要的风格，比如：卡通风格"}
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