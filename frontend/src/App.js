import { useState, useEffect, useRef, useCallback } from "react";

const BACKEND = "https://genpic-pgye.onrender.com";

// =====================
// 设计 tokens（Claude 风格）
// =====================
const C = {
  bg: "#f0eee6",
  surface: "#faf9f5",
  surfaceAlt: "#f5f3ec",
  border: "#e3dfd3",
  borderSoft: "#ebe7dc",
  text: "#1f1e1c",
  textSoft: "#6b6760",
  textFaint: "#9a958b",
  accent: "#c15f3c",
  accentHover: "#a64f30",
  accentSoft: "#f3e6df",
  danger: "#b3432b",
  serif: "'Georgia', 'Songti SC', 'Times New Roman', serif",
  sans: "-apple-system, 'PingFang SC', 'Helvetica Neue', sans-serif",
};

function getToken() { return localStorage.getItem("token"); }
function saveToken(token) { localStorage.setItem("token", token); }
function clearToken() {
  localStorage.removeItem("token");
  localStorage.removeItem("username");
}
function authHeaders() {
  return {
    "Content-Type": "application/json",
    "Authorization": `Bearer ${getToken()}`
  };
}

const inputStyle = {
  width: "100%", padding: "11px 14px", border: `1px solid ${C.border}`,
  borderRadius: 10, fontSize: 14, marginBottom: 12, boxSizing: "border-box",
  outline: "none", background: C.surface, color: C.text, fontFamily: "inherit",
};

const iconBtn = {
  background: "none", border: "none", color: C.textSoft, cursor: "pointer",
  fontSize: 22, padding: 4, lineHeight: 1,
};
const miniBtn = {
  background: "none", border: "none", color: C.textFaint, cursor: "pointer",
  fontSize: 13, padding: "2px 4px", lineHeight: 1,
};

// =====================
// 登录/注册页面
// =====================
function AuthPage({ onLogin }) {
  const [mode, setMode] = useState("login");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  const handleSubmit = async () => {
    if (!username.trim() || !password.trim()) return;
    setLoading(true);
    setError("");
    try {
      const res = await fetch(`${BACKEND}/${mode}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username: username.trim(), password })
      });
      const data = await res.json();
      if (!res.ok) { setError(data.detail || "操作失败"); return; }
      saveToken(data.token);
      localStorage.setItem("username", data.username);
      onLogin(data.username, data.balance);
    } catch {
      setError("网络错误，请重试");
    } finally {
      setLoading(false);
    }
  };

  const handleKeyDown = (e) => { if (e.key === "Enter") handleSubmit(); };

  return (
    <div style={{ display: "flex", justifyContent: "center", alignItems: "center", width: "100%", height: "100vh", background: C.bg, fontFamily: C.sans }}>
      <div style={{ width: 360, padding: "0 24px" }}>
        <div style={{ textAlign: "center", marginBottom: 36 }}>
          <div style={{ width: 44, height: 44, borderRadius: "50%", background: C.accent, margin: "0 auto 20px", display: "flex", alignItems: "center", justifyContent: "center", color: "white", fontSize: 22, fontFamily: C.serif }}>✷</div>
          <h1 style={{ margin: "0 0 8px", fontSize: 28, fontFamily: C.serif, color: C.text, fontWeight: 500, letterSpacing: "-0.01em" }}>画室</h1>
          <p style={{ color: C.textSoft, margin: 0, fontSize: 14 }}>
            {mode === "login" ? "欢迎回来，登录后继续创作" : "创建一个账号开始创作"}
          </p>
        </div>

        <div style={{ display: "flex", marginBottom: 20, gap: 24, justifyContent: "center" }}>
          {["login", "register"].map(m => (
            <button
              key={m}
              onClick={() => { setMode(m); setError(""); }}
              style={{
                background: "none", border: "none", cursor: "pointer", fontSize: 14,
                padding: "4px 2px", color: mode === m ? C.text : C.textFaint,
                borderBottom: mode === m ? `2px solid ${C.accent}` : "2px solid transparent",
                fontWeight: mode === m ? 600 : 400,
              }}
            >
              {m === "login" ? "登录" : "注册"}
            </button>
          ))}
        </div>

        <input placeholder="用户名" value={username} onChange={e => setUsername(e.target.value)} onKeyDown={handleKeyDown} style={inputStyle} />
        <input type="password" placeholder="密码（至少6位）" value={password} onChange={e => setPassword(e.target.value)} onKeyDown={handleKeyDown} style={{ ...inputStyle, marginBottom: 16 }} />

        {error && <div style={{ color: C.danger, fontSize: 13, marginBottom: 12, textAlign: "center" }}>{error}</div>}

        <button
          onClick={handleSubmit}
          disabled={loading || !username.trim() || !password.trim()}
          style={{
            width: "100%", padding: "11px 0",
            background: loading || !username.trim() || !password.trim() ? C.border : C.accent,
            color: "white", border: "none", borderRadius: 10, fontSize: 15,
            cursor: loading ? "default" : "pointer", fontWeight: 500, transition: "background 0.15s",
          }}
        >
          {loading ? "请稍候…" : mode === "login" ? "登录" : "注册"}
        </button>
      </div>
    </div>
  );
}

// =====================
// 主应用
// =====================
function App() {
  const [currentUser, setCurrentUser] = useState(() => localStorage.getItem("username"));
  const [prompt, setPrompt] = useState("");
  const [uploadedFiles, setUploadedFiles] = useState([]);
  const [previewUrls, setPreviewUrls] = useState([]);
  const [results, setResults] = useState([]);
  const [balance, setBalance] = useState(null);
  const [dragOver, setDragOver] = useState(false);
  const [loading, setLoading] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(() => window.innerWidth > 768);
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

  const isMobile = () => window.innerWidth <= 768;

  const loadSessions = useCallback(async () => {
    if (!getToken()) return;
    const res = await fetch(`${BACKEND}/sessions`, { headers: authHeaders() });
    if (!res.ok) return;
    const data = await res.json();
    setSessions(data.sessions);
  }, []);

  const loadBalance = useCallback(async () => {
    if (!getToken()) return;
    const res = await fetch(`${BACKEND}/balance`, { headers: authHeaders() });
    if (!res.ok) return;
    const data = await res.json();
    setBalance(data.balance);
  }, []);

  useEffect(() => {
    if (currentUser) { loadBalance(); loadSessions(); }
  }, [currentUser, loadBalance, loadSessions]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [results]);

  const handleLogin = (username, bal) => {
    setCurrentUser(username);
    setBalance(bal);
    loadSessions();
  };

  const handleLogout = () => {
    clearToken();
    setCurrentUser(null);
    setBalance(null);
    setSessions([]);
    setResults([]);
    setCurrentSessionId(null);
  };

  const loadSession = async (sessionId) => {
    setCurrentSessionId(sessionId);
    if (isMobile()) setSidebarOpen(false);
    const res = await fetch(`${BACKEND}/messages/${sessionId}`, { headers: authHeaders() });
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
    if (isMobile()) setSidebarOpen(false);
  };

  const deleteSession = async (e, sessionId) => {
    e.stopPropagation();
    await fetch(`${BACKEND}/sessions/${sessionId}`, { method: "DELETE", headers: authHeaders() });
    if (currentSessionId === sessionId) { setCurrentSessionId(null); setResults([]); }
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
      headers: authHeaders(),
      body: JSON.stringify({ session_id: sessionId, title: renameValue.trim() })
    });
    setRenamingSessionId(null);
    loadSessions();
  };

  const addFiles = (newFiles) => {
    const filtered = Array.from(newFiles).filter(f => f.type.startsWith("image/")).slice(0, 4 - uploadedFiles.length);
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
    const imageItems = items.filter(item => item.type.startsWith("image/")).map(item => item.getAsFile());
    if (imageItems.length > 0) addFiles(imageItems);
  };

  const handleSubmit = async () => {
    if (!prompt.trim() || loading) return;
    if (balance <= 0) {
      setResults(prev => [...prev, { type: "error", text: "余额不足，请联系管理员充值" }]);
      return;
    }

    setLoading(true);
    const currentPrompt = prompt;
    const currentFiles = [...uploadedFiles];
    const currentPreviews = [...previewUrls];

    setPrompt("");
    setUploadedFiles([]);
    setPreviewUrls([]);

    setResults(prev => [...prev, { type: "prompt", text: currentPrompt, images: currentPreviews }]);

    let sessionId = currentSessionId;
    if (!sessionId) {
      const title = currentPrompt.slice(0, 12);
      const res = await fetch(`${BACKEND}/sessions/create`, {
        method: "POST",
        headers: authHeaders(),
        body: JSON.stringify({ title })
      });
      const data = await res.json();
      sessionId = data.session_id;
      setCurrentSessionId(sessionId);
      await loadSessions();
    }

    await fetch(`${BACKEND}/messages/save`, {
      method: "POST",
      headers: authHeaders(),
      body: JSON.stringify({ session_id: sessionId, type: "prompt", content: currentPrompt })
    });

    let res;
    try {
      if (currentFiles.length > 0) {
        const formData = new FormData();
        formData.append("prompt", currentPrompt);
        formData.append("aspect_ratio", aspectRatio);
        formData.append("resolution", resolution);
        currentFiles.forEach(file => formData.append("files", file));
        const endpoint = model === "gpt" ? `${BACKEND}/gpt/img2img` : `${BACKEND}/img2img`;
        res = await fetch(endpoint, {
          method: "POST",
          headers: { "Authorization": `Bearer ${getToken()}` },
          body: formData
        });
      } else {
        const endpoint = model === "gpt" ? `${BACKEND}/gpt/generate` : `${BACKEND}/generate`;
        res = await fetch(endpoint, {
          method: "POST",
          headers: authHeaders(),
          body: JSON.stringify({ prompt: currentPrompt, aspect_ratio: aspectRatio, resolution: resolution })
        });
      }

      if (res.status === 401) { handleLogout(); return; }
      if (res.status === 402) {
        setResults(prev => [...prev, { type: "error", text: "余额不足，请联系管理员充值" }]);
        setLoading(false);
        return;
      }

      const data = await res.json();
      const taskId = data.task_id;
      const ossImageUrls = data.image_urls || [];

      if (ossImageUrls.length > 0) {
        await fetch(`${BACKEND}/messages/save`, {
          method: "POST",
          headers: authHeaders(),
          body: JSON.stringify({ session_id: sessionId, type: "input_images", content: JSON.stringify(ossImageUrls) })
        });
      }

      setResults(prev => [...prev, { type: "loading", taskId }]);

      const timer = setInterval(async () => {
        const r = await fetch(`${BACKEND}/result/${taskId}`, { headers: authHeaders() });
        const d = await r.json();
        if (d.status === "done") {
          await fetch(`${BACKEND}/messages/save`, {
            method: "POST",
            headers: authHeaders(),
            body: JSON.stringify({ session_id: sessionId, type: "image", content: d.image_url })
          });
          setResults(prev => prev.map(item => item.taskId === taskId ? { type: "image", url: d.image_url } : item));
          setBalance(b => b - 1);
          setLoading(false);
          clearInterval(timer);
        } else if (d.status === "failed") {
          setResults(prev => prev.map(item => item.taskId === taskId ? { type: "error", text: "生成失败，请重试" } : item));
          setLoading(false);
          clearInterval(timer);
        }
      }, 2000);

    } catch {
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

  if (!currentUser || !getToken()) {
    return <AuthPage onLogin={handleLogin} />;
  }

  const selectStyle = {
    flexShrink: 0, border: `1px solid ${C.border}`, borderRadius: 8,
    padding: "6px 12px", fontSize: 13, color: C.textSoft, cursor: "pointer",
    background: C.surface, fontFamily: "inherit", outline: "none",
  };

  return (
    <div style={{ display: "flex", height: "100vh", background: C.bg, fontFamily: C.sans, color: C.text }}>

      {sidebarOpen && isMobile() && (
        <div onClick={() => setSidebarOpen(false)} style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.3)", zIndex: 20 }} />
      )}

      {sidebarOpen && (
        <div style={{
          width: 256, background: C.surfaceAlt, display: "flex", flexDirection: "column",
          flexShrink: 0, borderRight: `1px solid ${C.border}`,
          ...(isMobile() ? { position: "fixed", top: 0, bottom: 0, left: 0, zIndex: 30 } : {}),
        }}>
          <div style={{ padding: "18px 16px 12px", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <span style={{ fontFamily: C.serif, fontSize: 19, fontWeight: 500 }}>画室</span>
            <button onClick={() => setSidebarOpen(false)} style={iconBtn}>‹</button>
          </div>

          <div style={{ padding: "0 12px 12px" }}>
            <button
              onClick={newSession}
              style={{
                width: "100%", padding: "9px 14px", background: "transparent",
                color: C.text, border: `1px solid ${C.border}`, borderRadius: 9,
                cursor: "pointer", fontSize: 13, textAlign: "left", fontWeight: 500,
                display: "flex", alignItems: "center", gap: 8,
              }}
            >
              <span style={{ fontSize: 16, color: C.accent }}>＋</span> 新建创作
            </button>
          </div>

          <div style={{ flex: 1, overflowY: "auto", padding: "0 8px" }}>
            {sessions.map(session => {
              const active = currentSessionId === session.session_id;
              return (
                <div
                  key={session.session_id}
                  onClick={() => loadSession(session.session_id)}
                  onMouseEnter={() => setHoveredSessionId(session.session_id)}
                  onMouseLeave={() => setHoveredSessionId(null)}
                  style={{
                    padding: "9px 12px", borderRadius: 8, cursor: "pointer",
                    color: active ? C.text : C.textSoft,
                    background: active ? C.accentSoft : (hoveredSessionId === session.session_id ? C.surface : "transparent"),
                    fontSize: 13, marginBottom: 2, display: "flex", alignItems: "center",
                    justifyContent: "space-between",
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
                      style={{ background: C.surface, border: `1px solid ${C.border}`, color: C.text, borderRadius: 5, padding: "3px 6px", fontSize: 13, width: "100%", outline: "none" }}
                    />
                  ) : (
                    <>
                      <span style={{ flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                        {session.title}
                      </span>
                      {hoveredSessionId === session.session_id && (
                        <div style={{ display: "flex", gap: 2, marginLeft: 4 }}>
                          <button onClick={e => startRename(e, session)} style={miniBtn} title="重命名">✎</button>
                          <button onClick={e => deleteSession(e, session.session_id)} style={miniBtn} title="删除">⌫</button>
                        </div>
                      )}
                    </>
                  )}
                </div>
              );
            })}
          </div>

          <div style={{ padding: "14px 16px", borderTop: `1px solid ${C.border}`, display: "flex", alignItems: "center", justifyContent: "space-between" }}>
            <div>
              <div style={{ fontSize: 13, fontWeight: 500 }}>{currentUser}</div>
              <div style={{ color: C.textFaint, fontSize: 12, marginTop: 2 }}>剩余 {balance ?? "…"} 次</div>
            </div>
            <button onClick={handleLogout} style={{ background: "none", border: `1px solid ${C.border}`, color: C.textSoft, borderRadius: 7, padding: "5px 12px", cursor: "pointer", fontSize: 12 }}>
              退出
            </button>
          </div>
        </div>
      )}

      <div style={{ flex: 1, display: "flex", flexDirection: "column", overflow: "hidden", minWidth: 0 }}>
        <div style={{ display: "flex", alignItems: "center", padding: "14px 20px", background: C.bg, borderBottom: `1px solid ${C.borderSoft}` }}>
          {!sidebarOpen && (
            <button onClick={() => setSidebarOpen(true)} style={{ ...iconBtn, marginRight: 12, fontSize: 20 }}>☰</button>
          )}
          <span style={{ fontFamily: C.serif, fontSize: 16, fontWeight: 500 }}>
            {sessions.find(s => s.session_id === currentSessionId)?.title || "新的创作"}
          </span>
        </div>

        <div style={{ flex: 1, overflowY: "auto", padding: "8px clamp(16px, 12%, 22%)" }}>
          {results.length === 0 && (
            <div style={{ textAlign: "center", marginTop: "18vh", padding: "0 20px" }}>
              <div style={{ width: 52, height: 52, borderRadius: "50%", background: C.accentSoft, margin: "0 auto 22px", display: "flex", alignItems: "center", justifyContent: "center", color: C.accent, fontSize: 26 }}>✷</div>
              <h2 style={{ fontFamily: C.serif, fontSize: 26, fontWeight: 500, margin: "0 0 10px", color: C.text, letterSpacing: "-0.01em" }}>今天想创作什么？</h2>
              <p style={{ color: C.textSoft, fontSize: 15, margin: 0 }}>输入文字生成图片，或上传图片进行风格转换</p>
            </div>
          )}

          {results.map((item, i) => (
            <div key={i} style={{
              padding: "26px 0",
              borderBottom: i < results.length - 1 ? `1px solid ${C.borderSoft}` : "none",
            }}>
              {item.type === "prompt" && (
                <div>
                  <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 12 }}>
                    <span style={{ fontSize: 11, fontWeight: 600, color: C.textFaint, letterSpacing: "0.06em" }}>你</span>
                  </div>
                  {item.images?.length > 0 && (
                    <div style={{ display: "flex", gap: 8, marginBottom: 12, flexWrap: "wrap" }}>
                      {item.images.map((url, j) => (
                        <img key={j} src={url} alt="" style={{ width: 72, height: 72, objectFit: "cover", borderRadius: 8, border: `1px solid ${C.border}` }} />
                      ))}
                    </div>
                  )}
                  <p style={{ margin: 0, fontSize: 16, lineHeight: 1.65, color: C.text }}>{item.text}</p>
                </div>
              )}

              {item.type === "input_images" && (
                <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                  {item.images.map((url, j) => (
                    <img key={j} src={url} alt="" style={{ width: 90, height: 90, objectFit: "cover", borderRadius: 8, border: `1px solid ${C.border}` }} />
                  ))}
                </div>
              )}

              {item.type === "loading" && (
                <div>
                  <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 12 }}>
                    <span style={{ fontSize: 11, fontWeight: 600, color: C.accent, letterSpacing: "0.06em" }}>画室</span>
                  </div>
                  <div style={{ display: "flex", alignItems: "center", gap: 10, color: C.textSoft, fontSize: 14 }}>
                    <span className="genpic-pulse" style={{ width: 8, height: 8, borderRadius: "50%", background: C.accent, display: "inline-block" }} />
                    正在绘制，请稍候…
                  </div>
                </div>
              )}

              {item.type === "image" && (
                <div>
                  <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 12 }}>
                    <span style={{ fontSize: 11, fontWeight: 600, color: C.accent, letterSpacing: "0.06em" }}>画室</span>
                  </div>
                  <img src={item.url} alt="生成结果" style={{ maxWidth: "min(100%, 420px)", borderRadius: 12, border: `1px solid ${C.border}`, display: "block" }} />
                </div>
              )}

              {item.type === "error" && (
                <div style={{ display: "flex", alignItems: "center", gap: 8, color: C.danger, fontSize: 14 }}>
                  <span>⚠</span> {item.text}
                </div>
              )}
            </div>
          ))}
          <div ref={bottomRef} />
        </div>

        <div style={{ padding: "12px clamp(16px, 12%, 22%) 20px", background: C.bg }}>
          <div style={{ display: "flex", gap: 6, marginBottom: 10, overflowX: "auto", paddingBottom: 2 }}>
            <select value={model} onChange={e => setModel(e.target.value)} style={selectStyle}>
              <option value="nano">NanoBanana 2</option>
              <option value="gpt">GPT Image-2</option>
            </select>
            <select value={aspectRatio} onChange={e => setAspectRatio(e.target.value)} style={selectStyle}>
              <option value="auto">比例 · 自动</option>
              <option value="1:1">1:1</option>
              <option value="16:9">16:9</option>
              <option value="9:16">9:16</option>
              <option value="4:3">4:3</option>
              <option value="3:4">3:4</option>
              <option value="3:2">3:2</option>
              <option value="2:3">2:3</option>
              <option value="21:9">21:9</option>
            </select>
            <select value={resolution} onChange={e => setResolution(e.target.value)} style={selectStyle}>
              <option value="1K">画质 · 1K</option>
              <option value="2K">画质 · 2K</option>
              <option value="4K">画质 · 4K</option>
            </select>
            <button onClick={() => fileInputRef.current?.click()} style={{ ...selectStyle, display: "flex", alignItems: "center", gap: 5, whiteSpace: "nowrap" }}>
              ⊕ 上传图片
            </button>
          </div>

          <div
            style={{
              border: `1.5px solid ${dragOver ? C.accent : C.border}`,
              borderRadius: 16, background: dragOver ? C.accentSoft : C.surface,
              overflow: "hidden", boxShadow: "0 1px 3px rgba(0,0,0,0.03)",
            }}
            onDrop={handleDrop}
            onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
            onDragLeave={() => setDragOver(false)}
          >
            {previewUrls.length > 0 && (
              <div style={{ display: "flex", gap: 8, padding: "14px 14px 0", flexWrap: "wrap" }}>
                {previewUrls.map((url, i) => (
                  <div key={i} style={{ position: "relative" }}>
                    <img src={url} alt="" style={{ width: 64, height: 64, objectFit: "cover", borderRadius: 8, border: `1px solid ${C.border}` }} />
                    <button onClick={() => removeImage(i)} style={{ position: "absolute", top: -6, right: -6, background: C.text, color: "white", border: `2px solid ${C.surface}`, borderRadius: "50%", width: 20, height: 20, cursor: "pointer", fontSize: 11, lineHeight: 1, padding: 0 }}>×</button>
                  </div>
                ))}
              </div>
            )}

            <textarea
              value={prompt}
              onChange={e => setPrompt(e.target.value)}
              onKeyDown={handleKeyDown}
              onPaste={handlePaste}
              placeholder={previewUrls.length > 0 ? "描述你想要的风格…" : "描述你想要的画面…"}
              style={{
                width: "100%", padding: "16px", border: "none", outline: "none",
                resize: "none", fontSize: 15, fontFamily: "inherit", minHeight: 56,
                boxSizing: "border-box", background: "transparent", color: C.text, lineHeight: 1.5,
              }}
              rows={2}
            />

            <div style={{ display: "flex", justifyContent: "flex-end", padding: "0 14px 14px" }}>
              <button
                onClick={handleSubmit}
                disabled={!prompt.trim() || loading}
                style={{
                  background: prompt.trim() && !loading ? C.accent : C.border,
                  color: "white", border: "none", borderRadius: 10,
                  padding: "9px 22px", cursor: prompt.trim() && !loading ? "pointer" : "default",
                  fontSize: 14, fontWeight: 500, transition: "background 0.15s",
                }}
              >
                {loading ? "生成中…" : "生成"}
              </button>
            </div>
          </div>
          <input ref={fileInputRef} type="file" accept="image/*" multiple onChange={e => addFiles(e.target.files)} style={{ display: "none" }} />
        </div>
      </div>

      <style>{`
        .genpic-pulse { animation: genpicPulse 1.2s ease-in-out infinite; }
        @keyframes genpicPulse { 0%,100% { opacity: 0.3; transform: scale(0.8); } 50% { opacity: 1; transform: scale(1); } }
        ::selection { background: ${C.accentSoft}; }
        textarea::placeholder { color: ${C.textFaint}; }
        * { -webkit-tap-highlight-color: transparent; }
      `}</style>
    </div>
  );
}

export default App;