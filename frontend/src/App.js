import { useState, useEffect, useRef, useCallback } from "react";
import { SignedIn, SignedOut, SignInButton, UserButton, useUser } from "@clerk/clerk-react";

const BACKEND = "https://genpic-pgye.onrender.com";

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
  const [sessions, setSessions] = useState([]);
  const [currentSessionId, setCurrentSessionId] = useState(null);
  const [hoveredSessionId, setHoveredSessionId] = useState(null);
  const [renamingSessionId, setRenamingSessionId] = useState(null);
  const [renameValue, setRenameValue] = useState("");
  const [aspectRatio, setAspectRatio] = useState("auto");
  const [resolution, setResolution] = useState("1K");
  const [model, setModel] = useState("nano");
  const fileInputRef = useRef(null);
  const bottomRef = useRef(null);

  const loadSessions = useCallback(async () => {
    if (!user) return;
    const res = await fetch(`${BACKEND}/sessions/${user.id}`);
    const data = await res.json();
    setSessions(data.sessions);
  }, [user]);

  useEffect(() => {
    if (user) {
      fetch(`${BACKEND}/init_user`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ clerk_user_id: user.id })
      })
      .then(res => res.json())
      .then(data => setBalance(data.balance));
      loadSessions();
    }
  }, [user, loadSessions]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [results]);

  const loadSession = async (sessionId) => {
    setCurrentSessionId(sessionId);
    const res = await fetch(`${BACKEND}/messages/${sessionId}`);
    const data = await res.json();
    const items = data.messages.map(m => ({
      type: m.type,
      ...(m.type === "prompt" ? { text: m.content } : {}),
      ...(m.type === "image" ? { url: m.content } : {}),
      ...(m.type === "error" ? { text: m.content } : {}),
      ...(m.type === "input_images" ? { images: JSON.parse(m.content) } : {}),
    }));
    setResults(items);
  };

  const newSession = () => {
    setCurrentSessionId(null);
    setResults([]);
    setPrompt("");
    setUploadedFiles([]);
    setPreviewUrls([]);
  };

  const deleteSession = async (e, sessionId) => {
    e.stopPropagation();
    await fetch(`${BACKEND}/sessions/${sessionId}`, { method: "DELETE" });
    if (currentSessionId === sessionId) {
      setCurrentSessionId(null);
      setResults([]);
    }
    loadSessions();
  };

  const startRename = (e, session) => {
    e.stopPropagation();
    setRenamingSessionId(session.session_id);
    setRenameValue(session.title);
  };

  const submitRename = async (sessionId) => {
    if (!renameValue.trim()) return;
    await fetch(`${BACKEND}/sessions/update_title`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ session_id: sessionId, title: renameValue.trim() })
    });
    setRenamingSessionId(null);
    loadSessions();
  };

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
    if (imageItems.length > 0) addFiles(imageItems);
  };

  const handleSubmit = async () => {
    if (!prompt.trim() || loading) return;
    if (balance <= 0) {
      setResults(prev => [...prev, { type: "error", text: "余额不足，请充值" }]);
      return;
    }

    setLoading(true);

    const currentPrompt = prompt;
    const currentFiles = [...uploadedFiles];
    const currentPreviews = [...previewUrls];

    setPrompt("");
    setUploadedFiles([]);
    setPreviewUrls([]);

    // 立刻显示 prompt 气泡，不等网络请求
    setResults(prev => [...prev, { type: "prompt", text: currentPrompt, images: currentPreviews }]);

    let sessionId = currentSessionId;
    if (!sessionId) {
      const title = currentPrompt.slice(0, 5);
      const res = await fetch(`${BACKEND}/sessions/create`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ clerk_user_id: user.id, title })
      });
      const data = await res.json();
      sessionId = data.session_id;
      setCurrentSessionId(sessionId);
      await loadSessions();
    }

    await fetch(`${BACKEND}/messages/save`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ session_id: sessionId, type: "prompt", content: currentPrompt })
    });


    let res;
    try {
      if (currentFiles.length > 0) {
        const formData = new FormData();
        formData.append("prompt", currentPrompt);
        formData.append("clerk_user_id", user.id);
        formData.append("aspect_ratio", aspectRatio);
        formData.append("resolution", resolution);
        currentFiles.forEach(file => formData.append("files", file));
        const endpoint = model === "gpt" ? `${BACKEND}/gpt/img2img` : `${BACKEND}/img2img`;
        res = await fetch(endpoint, { method: "POST", body: formData });
      } else {
        const endpoint = model === "gpt" ? `${BACKEND}/gpt/generate` : `${BACKEND}/generate`;
        res = await fetch(endpoint, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ clerk_user_id: user.id, prompt: currentPrompt, aspect_ratio: aspectRatio, resolution: resolution })
        });
      }

      if (res.status === 402) {
        setResults(prev => [...prev, { type: "error", text: "余额不足，请充值" }]);
        setLoading(false);
        return;
      }

      const data = await res.json();
      const taskId = data.task_id;
      const ossImageUrls = data.image_urls || [];

      // 如果是图生图，保存输入图片到数据库
      if (ossImageUrls.length > 0) {
        await fetch(`${BACKEND}/messages/save`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            session_id: sessionId,
            type: "input_images",
            content: JSON.stringify(ossImageUrls)
          })
        });
      }

      setResults(prev => [...prev, { type: "loading", taskId }]);

      const timer = setInterval(async () => {
        const r = await fetch(`${BACKEND}/result/${taskId}`);
        const d = await r.json();
        if (d.status === "done") {
          await fetch(`${BACKEND}/messages/save`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ session_id: sessionId, type: "image", content: d.image_url })
          });
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
                  key={session.session_id}
                  onClick={() => loadSession(session.session_id)}
                  onMouseEnter={() => setHoveredSessionId(session.session_id)}
                  onMouseLeave={() => setHoveredSessionId(null)}
                  style={{
                    padding: "10px 12px",
                    borderRadius: 8,
                    cursor: "pointer",
                    color: currentSessionId === session.session_id ? "white" : "#999",
                    background: currentSessionId === session.session_id ? "#333" : "transparent",
                    fontSize: 13,
                    marginBottom: 2,
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "space-between"
                  }}
                >
                  {renamingSessionId === session.session_id ? (
                    <input
                      value={renameValue}
                      onChange={e => setRenameValue(e.target.value)}
                      onBlur={() => submitRename(session.session_id)}
                      onKeyDown={e => { if (e.key === "Enter") submitRename(session.session_id); if (e.key === "Escape") setRenamingSessionId(null); }}
                      onClick={e => e.stopPropagation()}
                      autoFocus
                      style={{ background: "#444", border: "none", color: "white", borderRadius: 4, padding: "2px 6px", fontSize: 13, width: "100%" }}
                    />
                  ) : (
                    <>
                      <span style={{ flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                        {session.title}
                      </span>
                      {hoveredSessionId === session.session_id && (
                        <div style={{ display: "flex", gap: 4, marginLeft: 4 }}>
                          <button
                            onClick={e => startRename(e, session)}
                            style={{ background: "none", border: "none", color: "#aaa", cursor: "pointer", fontSize: 12, padding: "2px 4px" }}
                            title="重命名"
                          >
                            ✏️
                          </button>
                          <button
                            onClick={e => deleteSession(e, session.session_id)}
                            style={{ background: "none", border: "none", color: "#aaa", cursor: "pointer", fontSize: 12, padding: "2px 4px" }}
                            title="删除"
                          >
                            🗑️
                          </button>
                        </div>
                      )}
                    </>
                  )}
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
              {sessions.find(s => s.session_id === currentSessionId)?.title || "新对话"}
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
                
                {item.type === "input_images" && (
                  <div style={{ display: "flex", justifyContent: "flex-end" }}>
                    <div style={{ background: "#4f8ef7", padding: "10px 16px", borderRadius: 12, maxWidth: "70%" }}>
                      <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                        {item.images.map((url, j) => (
                          <img key={j} src={url} alt="" style={{ width: 80, height: 80, objectFit: "cover", borderRadius: 6 }} />
                        ))}
                      </div>
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
                <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  <button
                    onClick={() => fileInputRef.current?.click()}
                    style={{ background: "none", border: "none", cursor: "pointer", color: "#999", fontSize: 20, padding: 4 }}
                    title="上传图片（最多4张）"
                  >
                    📎
                  </button>
                  <select
                    value={aspectRatio}
                    onChange={e => setAspectRatio(e.target.value)}
                    style={{ border: "1px solid #ddd", borderRadius: 6, padding: "4px 8px", fontSize: 13, color: "#666", cursor: "pointer" }}
                  >
                    <option value="auto">自动</option>
                    <option value="1:1">1:1</option>
                    <option value="16:9">16:9</option>
                    <option value="9:16">9:16</option>
                    <option value="4:3">4:3</option>
                    <option value="3:4">3:4</option>
                    <option value="3:2">3:2</option>
                    <option value="2:3">2:3</option>
                    <option value="21:9">21:9</option>
                  </select>
                  <select
                    value={resolution}
                    onChange={e => setResolution(e.target.value)}
                    style={{ border: "1px solid #ddd", borderRadius: 6, padding: "4px 8px", fontSize: 13, color: "#666", cursor: "pointer" }}
                  >
                    <option value="1K">1K</option>
                    <option value="2K">2K</option>
                    <option value="4K">4K</option>
                  </select>
                  <select
                    value={model}
                    onChange={e => setModel(e.target.value)}
                    style={{ border: "1px solid #ddd", borderRadius: 6, padding: "4px 8px", fontSize: 13, color: "#666", cursor: "pointer" }}
                  >
                    <option value="nano">NanoBanana 2</option>
                    <option value="gpt">GPT Image 2</option>
                  </select>
                </div>
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