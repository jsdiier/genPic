import { useState, useEffect, useRef } from "react";
import { SignedIn, SignedOut, SignInButton, UserButton, useUser } from "@clerk/clerk-react";

const BACKEND = "http://localhost:8000";

function App() {
  const { user } = useUser();
  const [prompt, setPrompt] = useState("");
  const [uploadedFiles, setUploadedFiles] = useState([]);
  const [previewUrls, setPreviewUrls] = useState([]);
  const [results, setResults] = useState([]);
  const [balance, setBalance] = useState(null);
  const [dragOver, setDragOver] = useState(false);
  const [loading, setLoading] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [sessions, setSessions] = useState([
    { id: 1, title: "新对话", active: true }
  ]);
  const fileInputRef = useRef(null);
  const bottomRef = useRef(null);

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

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [results]);

  const addFiles = (newFiles) => {
    const filtered = Array.from(newFiles)
      .filter(f => f.type.startsWith("image/"))
      .slice(0, 4 - uploadedFiles.length);
    setUploadedFiles(prev => [...prev, ...filtered].slice(0, 4));
    setPreviewUrls(prev => [...prev, ...filtered.map(f => URL.createObjectURL(f))].slice(0, 4));
  };

  const removeImage = (index) => {
    setUploadedFiles(prev => prev.filter((_, i) => i !== index));
    setPreviewUrls(prev => prev.filter((_, i) => i !== index));
  };

  const handleDrop = (e) => {
    e.preventDefault();
    setDragOver(false);
    addFiles(e.dataTransfer.files);
  };

  const handlePaste = (e) => {
    const items = Array.from(e.clipboardData.items);
    const imageItems = items
      .filter(item => item.type.startsWith("image/"))
      .map(item => item.getAsFile());
    if (imageItems.length > 0) {
      addFiles(imageItems);
    }
  };

  const newSession = () => {
    const id = Date.now();
    setSessions(prev => [...prev.map(s => ({ ...s, active: false })), { id, title: "新对话", active: true }]);
    setResults([]);
    setPrompt("");
    setUploadedFiles([]);
    setPreviewUrls([]);
  };

  const handleSubmit = async () => {
    if (!prompt.trim() || loading) return;
    if (balance <= 0) {
      setResults(prev => [...prev, { type: "error", text: "余额不足，请充值" }]);
      return;
    }

    setSessions(prev => prev.map(s =>
      s.active ? { ...s, title: prompt.slice(0, 15) + (prompt.length > 15 ? "..." : "") } : s
    ));

    setLoading(true);
    setResults(prev => [...prev, { type: "prompt", text: prompt, images: [...previewUrls] }]);

    const currentPrompt = prompt;
    const currentFiles = [...uploadedFiles];
    setPrompt("");
    setUploadedFiles([]);
    setPreviewUrls([]);

    let res;
    try {
      if (currentFiles.length > 0) {
        const formData = new FormData();
        formData.append("prompt", currentPrompt);
        formData.append("clerk_user_id", user.id);
        currentFiles.forEach(file => formData.append("files", file));
        res = await fetch(`${BACKEND}/img2img`, { method: "POST", body: formData });
      } else {
        res = await fetch(`${BACKEND}/generate`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ clerk_user_id: user.id, prompt: currentPrompt })
        });
      }

      if (res.status === 402) {
        setResults(prev => [...prev, { type: "error", text: "余额不足，请充值" }]);
        setLoading(false);
        return;
      }

      const data = await res.json();
      const taskId = data.task_id;
      setResults(prev => [...prev, { type: "loading", taskId }]);

      const timer = setInterval(async () => {
        const r = await fetch(`${BACKEND}/result/${taskId}`);
        const d = await r.json();
        if (d.status === "done") {
          setResults(prev => prev.map(item =>
            item.taskId === taskId ? { type: "image", url: d.image_url } : item
          ));
          setBalance(b => b - 1);
          setLoading(false);
          clearInterval(timer);
        } else if (d.status === "failed") {
          setResults(prev => prev.map(item =>
            item.taskId === taskId ? { type: "error", text: "生成失败，请重试" } : item
          ));
          setLoading(false);
          clearInterval(timer);
        }
      }, 2000);

    } catch (err) {
      setResults(prev => [...prev, { type: "error", text: "请求失败，请重试" }]);
      setLoading(false);
    }
  };

  const handleKeyDown = (e) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSubmit();
    }
  };

  return (
    <div style={{ display: "flex", height: "100vh", background: "#f9f9f9", fontFamily: "system-ui, sans-serif" }}>

      <SignedOut>
        <div style={{ display: "flex", justifyContent: "center", alignItems: "center", width: "100%" }}>
          <div style={{ textAlign: "center", background: "white", padding: 40, borderRadius: 12, boxShadow: "0 2px 12px rgba(0,0,0,0.1)" }}>
            <h2>AI 绘图</h2>
            <p style={{ color: "#666" }}>请先登录后使用</p>
            <SignInButton mode="modal">
              <button style={{ padding: "10px 24px", fontSize: 16, background: "#4f8ef7", color: "white", border: "none", borderRadius: 6, cursor: "pointer" }}>
                登录 / 注册
              </button>
            </SignInButton>
          </div>
        </div>
      </SignedOut>

      <SignedIn>
        {/* 左侧 Session 栏 */}
        {sidebarOpen && (
          <div style={{ width: 240, background: "#1a1a1a", display: "flex", flexDirection: "column", flexShrink: 0 }}>
            <div style={{ padding: "16px 12px", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <button
                onClick={newSession}
                style={{ flex: 1, padding: "8px 12px", background: "#333", color: "white", border: "none", borderRadius: 8, cursor: "pointer", fontSize: 13, textAlign: "left" }}
              >
                ＋ 新对话
              </button>
              <button
                onClick={() => setSidebarOpen(false)}
                style={{ marginLeft: 8, background: "none", border: "none", color: "#999", cursor: "pointer", fontSize: 18, padding: 4 }}
              >
                ←
              </button>
            </div>

            <div style={{ flex: 1, overflowY: "auto", padding: "0 8px" }}>
              {sessions.map(session => (
                <div
                  key={session.id}
                  onClick={() => setSessions(prev => prev.map(s => ({ ...s, active: s.id === session.id })))}
                  style={{
                    padding: "10px 12px",
                    borderRadius: 8,
                    cursor: "pointer",
                    color: session.active ? "white" : "#999",
                    background: session.active ? "#333" : "transparent",
                    fontSize: 13,
                    marginBottom: 2
                  }}
                >
                  {session.title}
                </div>
              ))}
            </div>

            <div style={{ padding: "12px 16px", borderTop: "1px solid #333", display: "flex", alignItems: "center", gap: 10 }}>
              <UserButton />
              <div>
                <div style={{ color: "white", fontSize: 13 }}>{user?.username}</div>
                <div style={{ color: "#999", fontSize: 12 }}>余额：{balance} 元</div>
              </div>
            </div>
          </div>
        )}

        {/* 主内容区 */}
        <div style={{ flex: 1, display: "flex", flexDirection: "column", overflow: "hidden" }}>
          <div style={{ display: "flex", alignItems: "center", padding: "12px 20px", background: "white", borderBottom: "1px solid #eee" }}>
            {!sidebarOpen && (
              <button
                onClick={() => setSidebarOpen(true)}
                style={{ background: "none", border: "none", cursor: "pointer", fontSize: 18, color: "#666", marginRight: 12, padding: 4 }}
              >
                ☰
              </button>
            )}
            <span style={{ fontWeight: 600, fontSize: 15, color: "#333" }}>
              {sessions.find(s => s.active)?.title || "新对话"}
            </span>
          </div>

          <div style={{ flex: 1, overflowY: "auto", padding: "24px 20%", display: "flex", flexDirection: "column", gap: 16 }}>
            {results.length === 0 && (
              <div style={{ textAlign: "center", color: "#999", marginTop: 80 }}>
                <p style={{ fontSize: 18 }}>输入文字生成图片，或上传图片进行风格转换</p>
              </div>
            )}

            {results.map((item, i) => (
              <div key={i}>
                {item.type === "prompt" && (
                  <div style={{ display: "flex", justifyContent: "flex-end" }}>
                    <div style={{ background: "#4f8ef7", color: "white", padding: "10px 16px", borderRadius: 12, maxWidth: "70%" }}>
                      {item.images?.length > 0 && (
                        <div style={{ display: "flex", gap: 6, marginBottom: 8, flexWrap: "wrap" }}>
                          {item.images.map((url, j) => (
                            <img key={j} src={url} alt="" style={{ width: 60, height: 60, objectFit: "cover", borderRadius: 6 }} />
                          ))}
                        </div>
                      )}
                      <p style={{ margin: 0, fontSize: 14 }}>{item.text}</p>
                    </div>
                  </div>
                )}

                {item.type === "loading" && (
                  <div style={{ display: "flex", justifyContent: "flex-start" }}>
                    <div style={{ background: "white", padding: "16px 20px", borderRadius: 12, boxShadow: "0 1px 4px rgba(0,0,0,0.1)", color: "#666" }}>
                      生成中，请稍候...
                    </div>
                  </div>
                )}

                {item.type === "image" && (
                  <div style={{ display: "flex", justifyContent: "flex-start" }}>
                    <img src={item.url} alt="生成结果" style={{ maxWidth: "70%", borderRadius: 12, boxShadow: "0 2px 8px rgba(0,0,0,0.1)" }} />
                  </div>
                )}

                {item.type === "error" && (
                  <div style={{ display: "flex", justifyContent: "flex-start" }}>
                    <div style={{ background: "white", padding: "12px 16px", borderRadius: 12, color: "#e53e3e", boxShadow: "0 1px 4px rgba(0,0,0,0.1)" }}>
                      {item.text}
                    </div>
                  </div>
                )}
              </div>
            ))}
            <div ref={bottomRef} />
          </div>

          {/* 底部输入区 */}
          <div style={{ padding: "12px 20%", background: "white", borderTop: "1px solid #eee" }}>
            <div
              style={{
                border: `1.5px solid ${dragOver ? "#4f8ef7" : "#ddd"}`,
                borderRadius: 12,
                background: dragOver ? "#f0f7ff" : "white",
                overflow: "hidden"
              }}
              onDrop={handleDrop}
              onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
              onDragLeave={() => setDragOver(false)}
            >
              {previewUrls.length > 0 && (
                <div style={{ display: "flex", gap: 8, padding: "12px 12px 0", flexWrap: "wrap" }}>
                  {previewUrls.map((url, i) => (
                    <div key={i} style={{ position: "relative" }}>
                      <img src={url} alt="" style={{ width: 80, height: 80, objectFit: "cover", borderRadius: 8 }} />
                      <button
                        onClick={() => removeImage(i)}
                        style={{ position: "absolute", top: 2, right: 2, background: "rgba(0,0,0,0.5)", color: "white", border: "none", borderRadius: "50%", width: 20, height: 20, cursor: "pointer", fontSize: 12, lineHeight: "20px", padding: 0 }}
                      >
                        ×
                      </button>
                    </div>
                  ))}
                </div>
              )}

              <textarea
                value={prompt}
                onChange={e => setPrompt(e.target.value)}
                onKeyDown={handleKeyDown}
                onPaste={handlePaste}
                placeholder={previewUrls.length > 0 ? "描述你想要的风格..." : "输入 prompt，或拖拽/粘贴图片进行图生图..."}
                style={{
                  width: "100%",
                  padding: "12px",
                  border: "none",
                  outline: "none",
                  resize: "none",
                  fontSize: 15,
                  fontFamily: "inherit",
                  minHeight: 60,
                  boxSizing: "border-box",
                  background: "transparent"
                }}
                rows={2}
              />

              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "8px 12px" }}>
                <button
                  onClick={() => fileInputRef.current?.click()}
                  style={{ background: "none", border: "none", cursor: "pointer", color: "#999", fontSize: 20, padding: 4 }}
                  title="上传图片（最多4张）"
                >
                  📎
                </button>
                <button
                  onClick={handleSubmit}
                  disabled={!prompt.trim() || loading}
                  style={{
                    background: prompt.trim() && !loading ? "#4f8ef7" : "#ddd",
                    color: "white",
                    border: "none",
                    borderRadius: 8,
                    padding: "8px 20px",
                    cursor: prompt.trim() && !loading ? "pointer" : "default",
                    fontSize: 14
                  }}
                >
                  {loading ? "生成中..." : "生成"}
                </button>
              </div>
            </div>
            <input ref={fileInputRef} type="file" accept="image/*" multiple onChange={e => addFiles(e.target.files)} style={{ display: "none" }} />
          </div>
        </div>
      </SignedIn>
    </div>
  );
}

export default App;