/**
 * SYSTEM Chat UI
 * 
 * A minimal terminal-style interface.
 */

export const chatHTML = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no">
  <meta name="mobile-web-app-capable" content="yes">
  <meta name="theme-color" content="#0a0a0a">
  <title>SYSTEM</title>
  <style>
    *, *::before, *::after { box-sizing: border-box; }
    body, h1, h2, p, div, header, form, button, textarea, span { margin: 0; padding: 0; }

    :root {
      --bg: #0a0a0a;
      --bg-subtle: #111;
      --bg-panel: #0e0e0e;
      --border: #1a1a1a;
      --border-bright: #252525;
      --text: #888;
      --text-bright: #c0c0c0;
      --text-dim: #444;
      --green: #5a8;
      --green-dim: #354;
      --red: #a54;
      --purple: #a5a;
    }

    html, body { height: 100%; overflow: hidden; }

    body {
      font-family: 'SF Mono', 'Menlo', 'Monaco', 'Consolas', monospace;
      font-size: 13px;
      background: var(--bg);
      color: var(--text);
      display: flex;
      flex-direction: column;
      line-height: 1.5;
      -webkit-font-smoothing: antialiased;
    }

    body::before {
      content: '';
      position: fixed;
      inset: 0;
      opacity: 0.03;
      pointer-events: none;
      background-image: url("data:image/svg+xml,%3Csvg viewBox='0 0 256 256' xmlns='http://www.w3.org/2000/svg'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.9' numOctaves='4' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23n)'/%3E%3C/svg%3E");
      z-index: 1000;
    }

    header {
      padding: 12px 16px;
      border-bottom: 1px solid var(--border);
      display: flex;
      align-items: center;
      justify-content: space-between;
      flex-shrink: 0;
      background: var(--bg);
    }

    .logo { font-weight: 500; color: var(--text-bright); letter-spacing: -0.5px; }
    .header-actions { display: flex; align-items: center; gap: 8px; }
    .header-btn {
      padding: 4px 8px;
      background: transparent;
      color: var(--text-dim);
      border: 1px solid var(--border);
      font-family: inherit;
      font-size: 11px;
      cursor: pointer;
      transition: all 0.15s;
    }
    .header-btn:hover { color: var(--text); border-color: var(--border-bright); }
    .header-btn.active { color: var(--green); border-color: var(--green-dim); }
    
    .status { display: flex; align-items: center; gap: 6px; font-size: 10px; color: var(--text-dim); text-transform: uppercase; letter-spacing: 0.5px; }
    .status-dot { width: 6px; height: 6px; border-radius: 50%; background: var(--green); }
    .status.offline .status-dot { background: var(--red); }
    .auth-hidden { visibility: hidden; }

    /* Auth */
    .auth { flex: 1; display: flex; flex-direction: column; }
    .auth.hidden { display: none; }
    .auth:not(.hidden) ~ .main { display: none; }

    .auth-content {
      flex: 1;
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      padding: 20px;
    }

    .eclipse {
      position: relative;
      width: 120px;
      height: 120px;
      margin-bottom: 60px;
    }
    .eclipse::before { content: ''; position: absolute; inset: 0; border-radius: 50%; background: var(--bg); }
    .eclipse::after {
      content: '';
      position: absolute;
      inset: 0;
      border-radius: 50%;
      box-shadow: 0 0 20px 1px rgba(255,255,255,0.2), 0 0 10px 1px rgba(255,255,255,0.15);
      border: 2px solid rgba(255,255,255,0.7);
      animation: pulse 4s ease-in-out infinite;
    }
    .eclipse-glow {
      position: absolute;
      inset: -8px;
      border-radius: 50%;
      background: radial-gradient(circle, transparent 50%, rgba(255,255,255,0.04) 70%, transparent 80%);
      filter: blur(4px);
    }

    @keyframes pulse {
      0%, 100% { box-shadow: 0 0 20px 1px rgba(255,255,255,0.2), 0 0 10px 1px rgba(255,255,255,0.15); }
      50% { box-shadow: 0 0 25px 2px rgba(255,255,255,0.25), 0 0 15px 2px rgba(255,255,255,0.2); }
    }

    #auth-form { display: flex; flex-direction: column; align-items: center; gap: 12px; width: 100%; max-width: 280px; }
    .auth-label { font-size: 10px; color: var(--text-dim); text-transform: uppercase; letter-spacing: 1px; }
    
    #token {
      width: 100%;
      height: 36px;
      padding: 0 12px;
      background: var(--bg-subtle);
      border: 1px solid var(--border);
      color: var(--text-bright);
      font-family: inherit;
      font-size: 12px;
      outline: none;
    }
    #token:focus { border-color: var(--border-bright); }
    #token::placeholder { color: var(--text-dim); }

    #auth-btn {
      margin-top: 4px;
      padding: 10px 24px;
      background: var(--bg-subtle);
      color: var(--text);
      border: 1px solid var(--border);
      font-family: inherit;
      font-size: 11px;
      cursor: pointer;
      text-transform: uppercase;
      letter-spacing: 0.5px;
    }
    #auth-btn:hover { background: var(--border); color: var(--text-bright); }
    #auth-btn:disabled { opacity: 0.5; cursor: not-allowed; }
    .auth-error { color: var(--red); font-size: 11px; min-height: 16px; }

    .auth-footer {
      flex-shrink: 0;
      padding: 20px;
      text-align: center;
      color: var(--text-dim);
      font-size: 10px;
      line-height: 1.6;
    }
    .auth-footer a { color: var(--text); text-decoration: none; }
    .auth-footer a:hover { color: var(--text-bright); }

    /* Main */
    .main { flex: 1; display: flex; overflow: hidden; position: relative; }
    .chat { flex: 1; display: flex; flex-direction: column; min-width: 0; }
    .chat.hidden { display: none; }

    .messages { flex: 1; overflow-y: auto; padding: 16px; }
    .welcome { text-align: center; padding: 60px 20px; color: var(--text-dim); }
    .welcome h1 { font-size: 24px; font-weight: 400; color: var(--text); margin-bottom: 8px; letter-spacing: -1px; }
    .welcome p { font-size: 11px; text-transform: uppercase; letter-spacing: 2px; margin-bottom: 32px; }
    .welcome-cmds { display: flex; flex-wrap: wrap; justify-content: center; gap: 8px; }
    .welcome-cmd {
      padding: 6px 12px;
      background: transparent;
      color: var(--text-dim);
      border: 1px solid var(--border);
      font-family: inherit;
      font-size: 11px;
      cursor: pointer;
    }
    .welcome-cmd:hover { color: var(--text); border-color: var(--border-bright); }

    .msg { margin-bottom: 12px; }
    .msg-line { display: flex; align-items: flex-start; gap: 12px; }
    .msg-who { flex-shrink: 0; width: 28px; font-size: 11px; color: var(--text-dim); text-align: right; }
    .msg.user .msg-who { color: var(--text-dim); }
    .msg.assistant .msg-who { color: var(--green); }
    .msg.system .msg-who { color: var(--red); }
    .msg-text { flex: 1; min-width: 0; word-wrap: break-word; color: var(--text); }
    .msg.user .msg-text { color: var(--text-bright); }
    .msg.typing .msg-text::after { content: '▌'; animation: blink 1s infinite; color: var(--green); }
    @keyframes blink { 0%, 50% { opacity: 1; } 51%, 100% { opacity: 0; } }

    .tool-call { margin: 8px 0; padding: 8px 12px; background: var(--bg-subtle); border: 1px solid var(--border); font-size: 11px; }
    .tool-name { color: var(--green); margin-bottom: 4px; }
    .tool-result { color: var(--text); white-space: pre-wrap; word-break: break-word; }
    .tool-result.error { color: var(--red); }
    .tool-image { margin-top: 8px; }
    .tool-image img { max-width: 100%; border: 1px solid var(--border); border-radius: 4px; cursor: pointer; transition: transform 0.2s; }
    .tool-image img:hover { transform: scale(1.02); }
    .tool-image img.fullscreen { position: fixed; top: 50%; left: 50%; transform: translate(-50%, -50%) scale(1); max-width: 95vw; max-height: 95vh; z-index: 1000; border: 2px solid var(--green); box-shadow: 0 0 50px rgba(0,0,0,0.8); }
    .image-overlay { position: fixed; top: 0; left: 0; width: 100%; height: 100%; background: rgba(0,0,0,0.9); z-index: 999; display: none; }
    .image-overlay.active { display: block; }

    .scheduled-task { margin: 8px 0; padding: 8px 12px; background: var(--bg-subtle); border: 1px solid var(--border); font-size: 11px; }
    .scheduled-when { color: var(--purple); margin-bottom: 4px; }

    /* Real-time notifications via WebSocket */
    .msg.system-notification { background: linear-gradient(135deg, rgba(90, 136, 102, 0.15), rgba(90, 136, 102, 0.05)); border-left: 2px solid var(--green); padding: 12px 16px; margin: 8px 0; animation: slideIn 0.3s ease-out; }
    .notification-content { display: flex; flex-direction: column; gap: 4px; }
    .notification-title { color: var(--green); font-weight: 500; font-size: 12px; }
    .notification-message { color: var(--text-bright); }
    .notification-time { color: var(--text-dim); font-size: 10px; }
    .msg.scheduled { border-left: 2px solid var(--purple); background: linear-gradient(135deg, rgba(165, 90, 165, 0.1), rgba(165, 90, 165, 0.02)); }
    .msg.scheduled .msg-who { color: var(--purple); }
    @keyframes slideIn { from { opacity: 0; transform: translateY(-10px); } to { opacity: 1; transform: translateY(0); } }

    .msg-text code { background: var(--bg-subtle); padding: 2px 4px; font-size: 12px; border: 1px solid var(--border); }
    .msg-text pre { background: var(--bg-subtle); padding: 8px 12px; margin: 8px 0; overflow-x: auto; border: 1px solid var(--border); }
    .msg-text pre code { background: none; padding: 0; border: none; }
    .msg-text strong { color: var(--text-bright); font-weight: 500; }
    .msg-text ul, .msg-text ol { margin: 8px 0; padding-left: 20px; }

    .input-area { 
      padding: 12px 16px; 
      padding-bottom: max(12px, env(safe-area-inset-bottom, 12px));
      border-top: 1px solid var(--border); 
      background: var(--bg);
      flex-shrink: 0;
    }
    .input-row { display: flex; align-items: flex-end; gap: 12px; }
    .input-prompt { color: var(--green); font-size: 14px; line-height: 20px; flex-shrink: 0; }
    #input {
      flex: 1;
      background: transparent;
      border: none;
      color: var(--text-bright);
      font-family: inherit;
      font-size: 16px; /* 16px prevents iOS zoom on focus */
      line-height: 20px;
      resize: none;
      outline: none;
      min-height: 20px;
      max-height: 120px;
      transition: height 0.1s ease-out;
    }
    #input::placeholder { color: var(--text-dim); }
    
    /* Mobile keyboard handling */
    @supports (height: 100dvh) {
      .app { height: 100dvh; }
    }

    .schedules-panel {
      position: absolute;
      top: 0; right: 0; bottom: 0;
      width: 300px;
      background: var(--bg-panel);
      border-left: 1px solid var(--border);
      transform: translateX(100%);
      transition: transform 0.2s;
      display: flex;
      flex-direction: column;
      z-index: 100;
    }
    .schedules-panel.visible { transform: translateX(0); }
    .schedules-header { padding: 12px; border-bottom: 1px solid var(--border); display: flex; justify-content: space-between; align-items: center; }
    .schedules-title { font-size: 11px; text-transform: uppercase; letter-spacing: 0.5px; color: var(--text-dim); }
    .schedules-actions { display: flex; gap: 4px; }
    .schedules-list { flex: 1; overflow-y: auto; padding: 12px; }
    .schedules-empty { color: var(--text-dim); font-size: 11px; text-align: center; padding: 20px; }
    .schedule-item { padding: 8px; border: 1px solid var(--border); margin-bottom: 8px; font-size: 11px; display: flex; justify-content: space-between; align-items: center; }
    .schedule-info { flex: 1; }
    .schedule-time { color: var(--green); margin-bottom: 2px; font-weight: bold; }
    .schedule-desc { color: var(--text); }
    .schedule-delete { background: none; border: 1px solid var(--border); color: var(--red); width: 24px; height: 24px; cursor: pointer; font-size: 14px; opacity: 0.6; transition: opacity 0.2s; }
    .schedule-delete:hover { opacity: 1; background: var(--bg-subtle); }

    @media (max-width: 600px) { .schedules-panel { width: 100%; } }
  </style>
</head>
<body>
  <header>
    <div class="logo">SYSTEM</div>
    <div class="header-actions auth-hidden" id="header-actions">
      <button class="header-btn" id="new-btn" title="New conversation">new</button>
      <button class="header-btn" id="schedule-btn" title="View schedules">cron</button>
      <button class="header-btn" id="disconnect-btn" title="Disconnect">exit</button>
      <div class="status" id="status"><span class="status-dot"></span><span>connected</span></div>
    </div>
  </header>

  <div class="auth" id="auth">
    <div class="auth-content">
      <div class="eclipse"><div class="eclipse-glow"></div></div>
      <form id="auth-form" onsubmit="return false;">
        <label class="auth-label" for="token">api secret</label>
        <input type="password" id="token" placeholder="enter your API_SECRET" autocomplete="off">
        <button type="submit" id="auth-btn">connect</button>
        <div class="auth-error" id="auth-err"></div>
      </form>
    </div>
    <div class="auth-footer">
      your self-hosted SYSTEM instance<br>
      <a href="https://github.com/ygwyg/system" target="_blank">docs →</a>
    </div>
  </div>

  <div class="main" id="main">
    <div class="chat hidden" id="chat">
      <div class="messages" id="msgs">
        <div class="welcome" id="welcome">
          <h1>SYSTEM</h1>
          <p>remote control</p>
          <div class="welcome-cmds">
            <button class="welcome-cmd" data-cmd="what's the volume?">volume</button>
            <button class="welcome-cmd" data-cmd="play music">play</button>
            <button class="welcome-cmd" data-cmd="open Safari">safari</button>
            <button class="welcome-cmd" data-cmd="notify me">notify</button>
          </div>
        </div>
      </div>
      <div class="input-area">
        <div class="input-row">
          <span class="input-prompt">›</span>
          <textarea id="input" placeholder="type a command..." rows="1"></textarea>
        </div>
      </div>
    </div>
    <div class="schedules-panel" id="schedules">
      <div class="schedules-header">
        <span class="schedules-title">scheduled tasks</span>
        <div class="schedules-actions">
          <button class="header-btn" id="refresh-schedules">↻</button>
          <button class="header-btn" id="close-schedules">×</button>
        </div>
      </div>
      <div class="schedules-list" id="schedules-list"><div class="schedules-empty">no scheduled tasks</div></div>
    </div>
  </div>

  <script>
    const API = '/agents/system-agent';
    let token = sessionStorage.getItem('system_token') || '';
    
    const $ = id => document.getElementById(id);
    const auth = $('auth'), chat = $('chat'), msgs = $('msgs'), input = $('input');
    const welcome = $('welcome'), status = $('status'), authErr = $('auth-err');
    const authBtn = $('auth-btn'), tokenInput = $('token');
    const schedulesPanel = $('schedules'), schedulesList = $('schedules-list');

    // Check existing token
    if (token) verify();

    $('auth-form').addEventListener('submit', tryAuth);
    
    async function tryAuth() {
      const t = tokenInput.value.trim();
      if (!t) return authErr.textContent = 'token required';
      
      authBtn.disabled = true;
      authErr.textContent = 'connecting...';
      
      try {
        // Verify by calling an authenticated endpoint
        const res = await fetch(API + '/schedules', { headers: { Authorization: 'Bearer ' + t } });
        if (res.ok) {
          token = t;
          sessionStorage.setItem('system_token', token);
          showChat();
        } else if (res.status === 401) {
          authErr.textContent = 'invalid token';
        } else {
          authErr.textContent = 'connection failed';
        }
      } catch {
        authErr.textContent = 'connection failed';
      }
      authBtn.disabled = false;
    }

    async function verify() {
      try {
        const res = await fetch(API + '/schedules', { headers: { Authorization: 'Bearer ' + token } });
        if (res.ok) showChat();
        else logout(res.status === 401 ? 'token expired' : 'verification failed');
      } catch { logout('connection failed'); }
    }

    function showChat() {
      auth.classList.add('hidden');
      chat.classList.remove('hidden');
      $('header-actions').classList.remove('auth-hidden');
      setOnline(true);
      input.focus();
      
      // Connect WebSocket for real-time updates
      setTimeout(connectWebSocket, 500);
      
      // Request browser notification permission
      if ('Notification' in window && Notification.permission === 'default') {
        Notification.requestPermission();
      }
    }

    function setOnline(on) {
      status.className = 'status' + (on ? '' : ' offline');
      status.querySelector('span:last-child').textContent = on ? 'connected' : 'offline';
    }
    
    // Logout and return to login screen
    function logout(message) {
      // Close WebSocket
      if (ws) { ws.close(); ws = null; }
      if (wsReconnectTimer) { clearTimeout(wsReconnectTimer); wsReconnectTimer = null; }
      
      // Clear token
      sessionStorage.removeItem('system_token');
      token = '';
      
      // Show login screen
      chat.classList.add('hidden');
      auth.classList.remove('hidden');
      $('header-actions').classList.add('auth-hidden');
      tokenInput.value = '';
      authErr.textContent = message || '';
      
      // Reset chat
      msgs.innerHTML = '<div class="welcome" id="welcome"><h1>SYSTEM</h1><p>remote control</p></div>';
    }

    // ═══════════════════════════════════════════════════════════════
    // WebSocket for REAL-TIME updates
    // ═══════════════════════════════════════════════════════════════
    let ws = null;
    let wsReconnectTimer = null;
    
    function connectWebSocket() {
      if (!token || ws) return;
      
      const wsUrl = API.replace('https://', 'wss://').replace('http://', 'ws://');
      
      try {
        ws = new WebSocket(wsUrl);
        
        ws.onopen = () => {
          setOnline(true);
          ws.send(JSON.stringify({ type: 'auth', token: token }));
        };
        
        ws.onmessage = (event) => {
          try {
            const data = JSON.parse(event.data);
            handleWSMessage(data);
          } catch {}
        };
        
        ws.onclose = () => {
          ws = null;
          if (token) wsReconnectTimer = setTimeout(connectWebSocket, 3000);
        };
        
        ws.onerror = () => { ws = null; };
      } catch {}
    }
    
    function handleWSMessage(data) {
      if (data.type === 'notification') {
        // Show real-time notification
        const payload = data.payload;
        addSystemNotification(payload.title || 'Notification', payload.message);
      } else if (data.type === 'scheduled_result') {
        // Scheduled task completed - show result in chat
        const payload = data.payload;
        addScheduledResult(payload);
      } else if (data.type === 'chat') {
        // Chat response via WebSocket
        addResponse(data.payload);
      } else if (data.type === 'bridge_status') {
        setOnline(data.payload.online);
      }
    }
    
    function addSystemNotification(title, message) {
      const div = document.createElement('div');
      div.className = 'msg system-notification';
      div.innerHTML = '<div class="notification-content"><div class="notification-title">🔔 ' + esc(title) + '</div><div class="notification-message">' + esc(message) + '</div><div class="notification-time">' + new Date().toLocaleTimeString() + '</div></div>';
      msgs.appendChild(div);
      msgs.scrollTop = msgs.scrollHeight;
      
      // Also show browser notification if permitted
      if (Notification.permission === 'granted') {
        new Notification(title, { body: message, icon: '/favicon.ico' });
      }
    }
    
    function addScheduledResult(payload) {
      const div = document.createElement('div');
      div.className = 'msg assistant scheduled';
      let html = '<div class="msg-line"><span class="msg-who">⏰</span><span class="msg-text">' + esc(payload.description) + '</span></div>';
      html += '<div class="tool-call"><div class="tool-name">' + esc(payload.tool) + '</div><div class="tool-result ' + (payload.success ? '' : 'error') + '">' + esc(payload.result) + '</div>';
      if (payload.image && payload.image.data) {
        html += '<div class="tool-image"><img src="data:' + (payload.image.mimeType || 'image/png') + ';base64,' + payload.image.data + '" alt="Screenshot" /></div>';
      }
      html += '</div>';
      div.innerHTML = html;
      msgs.appendChild(div);
      msgs.scrollTop = msgs.scrollHeight;
    }
    
    // Connect WebSocket when authenticated
    if (token) {
      setTimeout(connectWebSocket, 500);
      // Request notification permission
      if (Notification.permission === 'default') {
        Notification.requestPermission();
      }
    }

    $('disconnect-btn').addEventListener('click', () => logout());

    async function send() {
      const text = input.value.trim();
      if (!text) return;
      
      welcome.style.display = 'none';
      addMsg('user', text);
      
      // Immediately collapse input and blur to dismiss keyboard on mobile
      input.value = '';
      input.style.height = '20px';
      input.blur();
      
      // Re-focus after a tick (keeps keyboard up on desktop, dismisses on mobile)
      setTimeout(() => {
        if (window.innerWidth > 768) input.focus();
        msgs.scrollTop = msgs.scrollHeight;
      }, 50);
      
      const typing = addMsg('assistant', '', true);
      
      try {
        const res = await fetch(API + '/chat', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + token },
          body: JSON.stringify({ message: text })
        });
        
        typing.remove();
        
        if (res.ok) {
          const data = await res.json();
          addResponse(data);
          setOnline(true);
        } else if (res.status === 401) {
          logout('session expired');
        } else {
          const err = await res.json().catch(() => ({}));
          addMsg('system', err.error || 'error');
        }
      } catch {
        typing.remove();
        addMsg('system', 'connection failed');
        setOnline(false);
      }
    }

    function addMsg(type, text, isTyping = false) {
      const div = document.createElement('div');
      div.className = 'msg ' + type + (isTyping ? ' typing' : '');
      const who = type === 'user' ? 'you' : type === 'system' ? 'sys' : '›';
      div.innerHTML = '<div class="msg-line"><span class="msg-who">' + who + '</span><span class="msg-text">' + (type === 'assistant' ? md(text) : esc(text)) + '</span></div>';
      msgs.appendChild(div);
      msgs.scrollTop = msgs.scrollHeight;
      return div;
    }

    function addResponse(data) {
      const div = document.createElement('div');
      div.className = 'msg assistant';
      
      let msg = (data.message || '').replace(/^(Done!?|Sure!?)\\s*/i, '').trim();
      let html = '<div class="msg-line"><span class="msg-who">›</span><span class="msg-text">' + md(msg) + '</span></div>';
      
      // Handle multiple actions (new format)
      if (data.actions && data.actions.length > 0) {
        for (const action of data.actions) {
          html += '<div class="tool-call"><div class="tool-name">' + esc(action.tool) + '</div><div class="tool-result ' + (action.success ? '' : 'error') + '">' + esc(action.result) + '</div>';
          // Display image if present
          if (action.image && action.image.data) {
            html += '<div class="tool-image"><img src="data:' + (action.image.mimeType || 'image/png') + ';base64,' + action.image.data + '" alt="Screenshot" /></div>';
          }
          html += '</div>';
        }
      } else if (data.action) {
        // Backwards compat for single action
        html += '<div class="tool-call"><div class="tool-name">' + esc(data.action.tool) + '</div><div class="tool-result ' + (data.action.success ? '' : 'error') + '">' + esc(data.action.result) + '</div>';
        if (data.action.image && data.action.image.data) {
          html += '<div class="tool-image"><img src="data:' + (data.action.image.mimeType || 'image/png') + ';base64,' + data.action.image.data + '" alt="Screenshot" /></div>';
        }
        html += '</div>';
      }
      if (data.scheduled) {
        html += '<div class="scheduled-task"><div class="scheduled-when">⏱ ' + esc(data.scheduled.when) + '</div><div>' + esc(data.scheduled.description) + '</div></div>';
      }
      
      div.innerHTML = html;
      msgs.appendChild(div);
      msgs.scrollTop = msgs.scrollHeight;
    }

    function esc(s) { return s ? String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;') : ''; }
    
    function md(text) {
      if (!text) return '';
      let h = esc(text);
      h = h.replace(/\`\`\`(\\w*)\\n([\\s\\S]*?)\`\`\`/g, '<pre><code>$2</code></pre>');
      h = h.replace(/\`([^\`]+)\`/g, '<code>$1</code>');
      h = h.replace(/\\*\\*(.+?)\\*\\*/g, '<strong>$1</strong>');
      h = h.replace(/\\*(.+?)\\*/g, '<em>$1</em>');
      h = h.replace(/^- (.+)$/gm, '<li>$1</li>');
      h = h.replace(/\\n/g, '<br>');
      return h;
    }

    input.addEventListener('keydown', e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); } });
    input.addEventListener('input', () => { 
      input.style.height = '20px'; // Reset first
      input.style.height = Math.min(input.scrollHeight, 120) + 'px';
    });
    
    // Scroll to bottom when input gets focus (mobile keyboard appears)
    input.addEventListener('focus', () => {
      setTimeout(() => msgs.scrollTop = msgs.scrollHeight, 300);
    });

    // Image click to expand
    const overlay = document.createElement('div');
    overlay.className = 'image-overlay';
    document.body.appendChild(overlay);
    
    msgs.addEventListener('click', e => {
      const img = e.target;
      if (img.tagName === 'IMG' && img.closest('.tool-image')) {
        if (img.classList.contains('fullscreen')) {
          img.classList.remove('fullscreen');
          overlay.classList.remove('active');
        } else {
          img.classList.add('fullscreen');
          overlay.classList.add('active');
        }
      }
    });
    
    overlay.addEventListener('click', () => {
      document.querySelectorAll('.tool-image img.fullscreen').forEach(img => img.classList.remove('fullscreen'));
      overlay.classList.remove('active');
    });

    document.querySelectorAll('.welcome-cmd').forEach(btn => {
      btn.addEventListener('click', () => { input.value = btn.dataset.cmd; send(); });
    });

    $('new-btn').addEventListener('click', () => {
      if (!confirm('Clear history?')) return;
      msgs.innerHTML = '<div class="welcome" id="welcome"><h1>SYSTEM</h1><p>remote control</p><div class="welcome-cmds"><button class="welcome-cmd" data-cmd="what\\'s the volume?">volume</button><button class="welcome-cmd" data-cmd="play music">play</button></div></div>';
      document.querySelectorAll('.welcome-cmd').forEach(btn => btn.addEventListener('click', () => { input.value = btn.dataset.cmd; send(); }));
    });

    $('schedule-btn').addEventListener('click', () => {
      schedulesPanel.classList.toggle('visible');
      $('schedule-btn').classList.toggle('active');
      if (schedulesPanel.classList.contains('visible')) loadSchedules();
    });

    $('close-schedules').addEventListener('click', () => { schedulesPanel.classList.remove('visible'); $('schedule-btn').classList.remove('active'); });
    $('refresh-schedules').addEventListener('click', loadSchedules);

    async function loadSchedules() {
      try {
        const res = await fetch(API + '/schedules', { headers: { Authorization: 'Bearer ' + token } });
        if (res.status === 401) return logout('session expired');
        if (!res.ok) throw new Error();
        const data = await res.json();
        if (data.schedules?.length > 0) {
          schedulesList.innerHTML = data.schedules.map(s => 
            '<div class="schedule-item" data-id="' + esc(s.id) + '">' +
            '<div class="schedule-info"><div class="schedule-time">' + formatTime(s.time) + '</div>' +
            '<div class="schedule-desc">' + esc(s.payload?.description || s.payload?.tool || 'Task') + '</div></div>' +
            '<button class="schedule-delete" onclick="deleteSchedule(\\''+esc(s.id)+'\\')">×</button>' +
            '</div>'
          ).join('');
        } else {
          schedulesList.innerHTML = '<div class="schedules-empty">no scheduled tasks</div>';
        }
      } catch { schedulesList.innerHTML = '<div class="schedules-empty">failed to load</div>'; }
    }
    
    // Expose deleteSchedule globally for onclick handlers
    window.deleteSchedule = async function(id) {
      if (!confirm('Delete this scheduled task?')) return;
      try {
        const res = await fetch(API + '/schedules/' + id, { 
          method: 'DELETE',
          headers: { Authorization: 'Bearer ' + token } 
        });
        if (res.ok) {
          loadSchedules();
        } else {
          alert('Failed to delete');
        }
      } catch { alert('Failed to delete'); }
    };

    function formatTime(t) {
      if (!t) return 'unknown';
      if (typeof t === 'string' && t.includes(' ')) {
        const p = t.split(' ');
        if (p.length === 5 && p[0] === '0' && p[1] !== '*') {
          const h = parseInt(p[1]);
          return 'daily at ' + (h % 12 || 12) + (h >= 12 ? 'pm' : 'am');
        }
        return t;
      }
      try { return new Date(t).toLocaleString(); } catch { return t; }
    }
  </script>
</body>
</html>`;
