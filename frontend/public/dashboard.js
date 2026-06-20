(function () {
  'use strict';

  // ---- Config ----
  const API_BASE = (new URLSearchParams(location.search).get('api')) || '';
  const POLL_MS = 5000;
  const FETCH_TIMEOUT_MS = 15000;
  const CHAT_TIMEOUT_MS = 120000;
  const LEADER_SLOTS = 4;

  window.Dashboard = window.Dashboard || {};
  const Config = window.Dashboard.Config = {
    API_BASE,
    POLL_MS,
    FETCH_TIMEOUT_MS,
    CHAT_TIMEOUT_MS,
    LEADER_SLOTS,
  };
})();
(function () {
  'use strict';

  const C = window.Dashboard.Config;
  const D = window.Dashboard.Data;

  function esc(s) {
    if (s == null) return '';
    return String(s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/\"/g, '&quot;').replace(/'/g, '&#39;');
  }

  function fmtUptime(sec) {
    sec = Math.max(0, Math.floor(sec || 0));
    const h = Math.floor(sec / 3600);
    const m = Math.floor((sec % 3600) / 60);
    const s = sec % 60;
    if (h > 0) return h + 'ч ' + String(m).padStart(2, '0') + 'м';
    return String(m).padStart(2, '0') + 'м ' + String(s).padStart(2, '0') + 'с';
  }

  function fmtTokens(total) {
    if (total <= 0) return '';
    if (total >= 1000000) return (total / 1000000).toFixed(1) + 'M';
    if (total >= 1000) return (total / 1000).toFixed(1) + 'K';
    return String(total);
  }

  function fmtTime(ms) {
    if (!ms) return '—';
    const d = new Date(ms);
    return d.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
  }

  function normStatus(p) {
    const taskS = (p.task_status || '').toString().toLowerCase();
    const profS = (p.status || p.state || '').toString().toLowerCase();
    if (taskS === 'running' || taskS === 'optimizing' || taskS === 'in_progress' || taskS === 'active') return 'running';
    if (taskS === 'blocked' || taskS === 'paused' || taskS === 'waiting') return 'blocked';
    if (taskS === 'error' || taskS === 'failed' || taskS === 'crashed') return 'error';
    if (profS === 'running' || profS === 'active') return 'running';
    if (profS === 'blocked' || profS === 'paused' || profS === 'waiting') return 'blocked';
    if (profS === 'error' || profS === 'failed' || profS === 'crashed') return 'error';
    return 'idle';
  }

  function normProfile(raw) {
    const name = raw.name || raw.profile || raw.id;
    const ct = raw.current_task || {};
    const task_id = raw.kanban_task || raw.task_id || ct.id || null;
    const task_title = raw.kanban_title || raw.task_title || ct.title || null;
    const task_status = normStatus({
      task_status: raw.kanban_status || raw.task_status || ct.task_status || ct.status,
      status: raw.status,
    });
    let started_at_ms = null;
    if (raw.started_at) {
      const v = Number(raw.started_at);
      if (!isNaN(v)) started_at_ms = v < 1e12 ? v * 1000 : v;
    } else if (raw.started_at_ms) {
      started_at_ms = Number(raw.started_at_ms);
    }
    const uptime = Number(raw.uptime_seconds || raw.uptime || 0);
    return {
      name: String(name || '').toLowerCase(),
      model: raw.model || null,
      task_id,
      task_title,
      task_status,
      tasks: raw.tasks || [],
      usage_input: raw.usage_input || 0,
      usage_output: raw.usage_output || 0,
      usage_percent: raw.usage_percent || 0,
      context_limit: raw.context_limit || 1000000,
      started_at_ms,
      uptime_seconds: isFinite(uptime) ? uptime : 0,
    };
  }

  function getEffectiveUptime(p) {
    if (p.started_at_ms) {
      return Math.max(0, (Date.now() - p.started_at_ms) / 1000);
    }
    return p.uptime_seconds || 0;
  }

  function fmtUsageStr(p) {
    const totalTokens = p.usage_input + p.usage_output;
    const limit = p.context_limit || 1000000;
    const pct = typeof p.usage_percent === 'number' ? p.usage_percent : (limit > 0 ? Math.min(100, Math.round(totalTokens / limit * 100)) : 0);
    const used = totalTokens >= 1000000 ? (totalTokens / 1000000).toFixed(1) + 'M' : totalTokens >= 1000 ? (totalTokens / 1000).toFixed(1) + 'K' : String(totalTokens);
    const total = limit >= 1000000 ? (limit / 1000000).toFixed(0) + 'm' : limit >= 1000 ? (limit / 1000).toFixed(0) + 'k' : String(limit);
    const barLen = 10;
    const filled = Math.round(pct / 100 * barLen);
    const bar = '█'.repeat(filled) + '░'.repeat(barLen - filled);
    return `${used}/${total} │ ${bar} ${pct}%`;
  }

  window.Dashboard.Utils = {
    esc,
    fmtUptime,
    fmtTokens,
    fmtTime,
    normStatus,
    normProfile,
    getEffectiveUptime,
    fmtUsageStr,
  };
})();
(function () {
  'use strict';

  const C = window.Dashboard.Config;
  const D = window.Dashboard.Data = {};

  // profilesByName: { [name]: normalized profile }
  D.profilesByName = {};
  // leaders: array of 4 names (string or null)
  D.leaders = [null, null, null, null];
  // userRoleEntries: full entries from user_role.json (for persistence)
  D.userRoleEntries = [];
  // chat log per leader name: { [name]: [{role, text, ts}] }
  D.chatLog = {};
  // sessions: { [profileName]: Session[] }
  D.sessionsMap = {};
  // active session per leader: { [profileName]: sessionId | null }
  D.activeSessionMap = {};
  D.connState = 'live'; // 'live' | 'demo' | 'error'
  D.lastError = '';
  D.filterText = '';
  D.optimizing = new Set();
  D.sessionsApiAvailable = true;
  D.addDropdownOpen = false;
  D.pendingPickSlot = null;
  // Collapse state per leader: { [name]: boolean }
  D.chatCollapsed = {};
  // Drag state
  D.dragSource = null;
  D.dragOverSlot = null;
  // loaded session marker to avoid refetching
  D.loadedSessions = {};
  // Modal state
  D.profileModalOpen = false;
  D.profileModalFilter = '';
  D.profileModalSelected = [];

  D.els = {
    topGrid: document.getElementById('topGrid'),
    bottomGrid: document.getElementById('bottomGrid'),
    conn: document.getElementById('conn'),
    connText: document.getElementById('connText'),
    leadersCount: document.getElementById('leadersCount'),
    allCount: document.getElementById('allCount'),
    filterInput: document.getElementById('filterInput'),
    filterMeta: document.getElementById('filterMeta'),
    addLeaderBtn: document.getElementById('addLeaderBtn'),
    addLeaderDropdown: document.getElementById('addLeaderDropdown'),
  };
})();
(function () {
  'use strict';

  const C = window.Dashboard.Config;
  const D = window.Dashboard.Data;
  const U = window.Dashboard.Utils;

  async function fetchJson(url, opts, timeoutMs) {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), timeoutMs || C.FETCH_TIMEOUT_MS);
    try {
      const r = await fetch(url, Object.assign({}, opts, { signal: ctrl.signal }));
      if (!r.ok) throw new Error('HTTP ' + r.status);
      return await r.json();
    } finally {
      clearTimeout(t);
    }
  }

  // ---- User Role ----
  async function loadUserRole() {
    try {
      const r = await fetchJson(C.API_BASE + '/api/user-role');
      const entries = (r && r.entries) || [];
      D.userRoleEntries = entries;
      const leaderEntries = entries
        .filter(e => e.role === 'leader')
        .sort((a, b) => a.order - b.order);
      const newLeaders = [null, null, null, null];
      leaderEntries.forEach((e, i) => {
        if (i < C.LEADER_SLOTS) newLeaders[i] = e.profile;
      });
      D.leaders = newLeaders;
    } catch (e) {
      console.warn('loadUserRole error, using defaults', e);
      D.leaders = ['orchestrator', 'rechelok', 'aitrainer', null];
    }
  }

  async function saveUserRole() {
    const entries = [];
    D.leaders.forEach((name, idx) => {
      if (name) {
        entries.push({
          userId: 'user_telegram_123',
          role: 'leader',
          profile: name,
          order: idx,
        });
      }
    });
    D.userRoleEntries = entries;
    try {
      await fetchJson(C.API_BASE + '/api/user-role', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ entries }),
      });
    } catch (e) {
      console.warn('saveUserRole error', e);
    }
  }

  // ---- Profiles / Chat / Optimize ----
  async function loadProfiles() {
    const data = await fetchJson(C.API_BASE + '/api/profiles');
    const list = (data && (data.profiles || data)) || [];
    if (!Array.isArray(list)) throw new Error('Bad payload');
    const map = {};
    for (const raw of list) {
      const p = U.normProfile(raw);
      if (p.name) map[p.name] = p;
    }
    return map;
  }

  async function postOptimize(name) {
    return fetchJson(C.API_BASE + '/api/optimize/' + encodeURIComponent(name), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    });
  }

  async function postChat(name, message, sid) {
    const body = { message: message };
    if (sid) body.session_id = sid;
    return fetchJson(C.API_BASE + '/api/chat/' + encodeURIComponent(name), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    }, C.CHAT_TIMEOUT_MS);
  }

  function lsKey(name) { return 'dash.sessions.v1.' + name; }
  function lsLoad(name) {
    try { return JSON.parse(localStorage.getItem(lsKey(name)) || '[]') || []; }
    catch (e) { return []; }
  }
  function lsSave(name, list) {
    try { localStorage.setItem(lsKey(name), JSON.stringify(list)); } catch (e) {}
  }
  function localCreate(name) {
    const list = lsLoad(name);
    const id = 'sess_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 6);
    const sess = { id, title: null, source: 'dashboard', message_count: 0, last_message_at: null };
    list.unshift(sess);
    lsSave(name, list);
    return sess;
  }
  function localRename(name, id, title) {
    const list = lsLoad(name);
    const s = list.find(x => x.id === id);
    if (s) s.title = title;
    lsSave(name, list);
  }
  function localDelete(name, id) {
    const list = lsLoad(name).filter(x => x.id !== id);
    lsSave(name, list);
  }
  function localList(name) { return lsLoad(name); }

  async function listSessions(name) {
    if (!D.sessionsApiAvailable) return localList(name);
    try {
      const r = await fetchJson(C.API_BASE + '/api/profiles/' + encodeURIComponent(name) + '/sessions');
      return (r && r.sessions) || [];
    } catch (e) {
      D.sessionsApiAvailable = false;
      return localList(name);
    }
  }
  async function createSession(name) {
    if (!D.sessionsApiAvailable) return localCreate(name);
    try {
      return await fetchJson(C.API_BASE + '/api/profiles/' + encodeURIComponent(name) + '/sessions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      });
    } catch (e) {
      D.sessionsApiAvailable = false;
      return localCreate(name);
    }
  }
  async function renameSession(name, id, title) {
    if (!D.sessionsApiAvailable) return localRename(name, id, title);
    try {
      return await fetchJson(C.API_BASE + '/api/profiles/' + encodeURIComponent(name) + '/sessions/' + encodeURIComponent(id), {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title: title }),
      });
    } catch (e) {
      D.sessionsApiAvailable = false;
      return localRename(name, id, title);
    }
  }
  async function deleteSession(name, id) {
    if (!D.sessionsApiAvailable) return localDelete(name, id);
    try {
      return await fetchJson(C.API_BASE + '/api/profiles/' + encodeURIComponent(name) + '/sessions/' + encodeURIComponent(id), {
        method: 'DELETE',
      });
    } catch (e) {
      D.sessionsApiAvailable = false;
      return localDelete(name, id);
    }
  }

  async function loadSessionMessages(name, sid) {
    if (!sid) return;
    if (D.loadedSessions[name] === sid && D.chatLog[name] && D.chatLog[name].length > 0) return;
    D.loadedSessions[name] = sid;
    try {
      const r = await fetchJson(C.API_BASE + '/api/profiles/' + encodeURIComponent(name) + '/sessions/' + encodeURIComponent(sid) + '/messages');
      const msgs = (r && r.messages) || [];
      D.chatLog[name] = [];
      for (const m of msgs) {
        if (m.role === 'user' || m.role === 'assistant') {
          const text = m.content || '';
          if (text) {
            D.chatLog[name].push({ role: m.role === 'user' ? 'you' : 'bot', text, ts: (m.timestamp || 0) * 1000 });
          }
        }
      }
      if (D.chatLog[name].length > 100) D.chatLog[name] = D.chatLog[name].slice(-100);
    } catch (e) {
      console.warn('load messages error', e);
    }
  }

  window.Dashboard.API = {
    fetchJson,
    loadUserRole,
    saveUserRole,
    loadProfiles,
    postOptimize,
    postChat,
    listSessions,
    createSession,
    renameSession,
    deleteSession,
    loadSessionMessages,
  };
})();
(function () {
  'use strict';

  const C = window.Dashboard.Config;
  const D = window.Dashboard.Data;
  const U = window.Dashboard.Utils;

  function sessionDisplayName(s) {
    if (s && s.title && s.title.trim()) return s.title.trim();
    if (s && s.last_message_at) {
      const d = new Date(s.last_message_at);
      const date = d.toLocaleDateString('ru-RU', { day: '2-digit', month: '2-digit' });
      return 'Сессия от ' + date;
    }
    if (s && s.id) {
      const m = String(s.id).match(/^sess_([a-z0-9]+)_/);
      if (m) {
        const ts = parseInt(m[1], 36);
        if (isFinite(ts)) {
          const d = new Date(ts);
          const date = d.toLocaleDateString('ru-RU', { day: '2-digit', month: '2-digit' });
          return 'Сессия от ' + date;
        }
      }
      const m2 = String(s.id).match(/^(\d{4})(\d{2})(\d{2})_(\d{2})(\d{2})(\d{2})_/);
      if (m2) {
        const d = new Date(+m2[1], +m2[2] - 1, +m2[3], +m2[4], +m2[5], +m2[6]);
        const date = d.toLocaleDateString('ru-RU', { day: '2-digit', month: '2-digit' });
        return 'Сессия от ' + date;
      }
    }
    return 'Сессия';
  }

  function renderSessionList(name) {
    const list = D.sessionsMap[name] || [];
    const activeId = D.activeSessionMap[name] || null;
    const items = list.map(s => {
      const isActive = s.id === activeId;
      const display = sessionDisplayName(s);
      const source = s.source ? `<span class="sess-source">${U.esc(s.source)}</span>` : '';
      const count = (s.message_count != null && s.message_count > 0) ? `<span class="sess-msg-count">${s.message_count}</span>` : '';
      return `<div class="session-item ${isActive ? 'active' : ''}" data-action="sess-select" data-name="${U.esc(name)}" data-sid="${U.esc(s.id)}" title="${U.esc(s.id)}">
        <span class="sess-name">${U.esc(display)}</span>
        ${count}
        ${source}
        <button type="button" data-action="sess-rename" data-name="${U.esc(name)}" data-sid="${U.esc(s.id)}" title="переименовать">✎</button>
        <button type="button" class="sess-delete" data-action="sess-delete" data-name="${U.esc(name)}" data-sid="${U.esc(s.id)}" title="удалить">✕</button>
      </div>`;
    }).join('');
    return `<div class="session-list" data-session-list="${U.esc(name)}">${items}</div>
      <button class="sess-new" data-action="sess-new" data-name="${U.esc(name)}">+ Новая сессия</button>`;
  }

  function renderCardBody(p) {
    const status = p.task_status || 'idle';
    const isRunning = status === 'running';
    const isBlocked = status === 'blocked';
    const dotClass = isRunning ? 'running' : (isBlocked ? 'blocked' : 'idle');
    const model = p.model || '—';
    const task = (p.task_id || p.task_title) ? `
      <div class="task">
        <div class="task-id">${U.esc(p.task_id || '—')}</div>
        <div class="task-title">${U.esc(p.task_title || '')}</div>
      </div>` : `
      <div class="task idle-task">— нет активной задачи —</div>`;
    const uptimeSec = U.getEffectiveUptime(p);
    const timerCls = isRunning || isBlocked ? '' : 'idle-timer';
    const timer = `<div class="timer ${timerCls}" data-started="${p.started_at_ms || 0}" data-base="${isRunning || isBlocked ? Math.floor(uptimeSec) : 0}">${U.fmtUptime(uptimeSec)}</div>`;
    const tasks = p.tasks || [];
    const activeTaskId = p.task_id;
    const queueHtml = tasks.length > 1
      ? `<div class="task-queue">${tasks.map(t => `
        <div class="task-queue-item${t.id === activeTaskId ? ' active' : ''}" title="[${U.esc(t.board || '?')}] ${U.esc(t.title || '')}">
          <span class="tq-board">${U.esc((t.board || '?').substring(0, 10))}</span>
          <span class="tq-id">${U.esc(t.id)}</span>
          <span class="tq-status ${U.esc(t.status)}"></span>
        </div>`).join('')}</div>`
      : '';
    const usageStr = U.fmtUsageStr(p);
    const modelLine = model ? `${model} │ ${usageStr}` : usageStr;
    return `
      <div class="head">
        <div class="name">${U.esc(p.name)}</div>
        <div class="status-dot ${dotClass}" title="${U.esc(status)}"></div>
      </div>
      <div class="model">${U.esc(modelLine)}</div>
      ${task}
      ${timer}
      ${queueHtml}
      <div class="actions">
        <button class="btn optimize" data-action="optimize" data-name="${U.esc(p.name)}" ${D.optimizing.has(p.name) ? 'disabled' : ''}>
          ${D.optimizing.has(p.name) ? '⏳ …' : 'Оптимизировать контекст'}
        </button>
      </div>
    `;
  }

  function renderTop() {
    const frag = [];
    let filled = 0;
    D.leaders.forEach((name, idx) => {
      if (!name) return;
      filled++;
      const p = D.profilesByName[name];
      if (!p) {
        frag.push(`
          <div class="card" data-name="${U.esc(name)}" data-slot="${idx}">
            <div class="head">
              <div class="name">${U.esc(name)}</div>
              <div class="status-dot idle" title="unknown"></div>
            </div>
            <div class="model">— нет данных —</div>
            <div class="task idle-task">профиль не отвечает</div>
            <div class="timer idle-timer">00м 00с</div>
            <div class="actions">
              <button class="btn optimize" disabled>Оптимизировать контекст</button>
            </div>
          </div>
        `);
        return;
      }
      const log = D.chatLog[name] || [];
      const logHtml = log.length === 0
        ? '<div class="empty">диалог пуст</div>'
        : log.slice(-20).map(m => `<div class="msg-${m.role}">${m.role === 'you' ? '›' : '‹'} ${U.esc(m.text)}</div>`).join('');
      const sessionList = renderSessionList(name);
      const activeSid = D.activeSessionMap[name];
      const activeLabel = activeSid
        ? sessionDisplayName((D.sessionsMap[name] || []).find(x => x.id === activeSid) || { id: activeSid })
        : 'новая сессия';
      const isCollapsed = D.chatCollapsed[name];
      frag.push(`
        <div class="card" data-name="${U.esc(name)}" data-slot="${idx}" draggable="true">
          <button type="button" class="remove-leader-btn" data-action="remove-leader" data-name="${U.esc(name)}" title="Удалить лидера">✕</button>
          <div class="drag-handle" data-action="drag-handle" title="Перетащить для смены порядка">⠿</div>
          <button type="button" class="collapse-chat-btn" data-action="toggle-chat" data-name="${U.esc(name)}" title="${isCollapsed ? 'Развернуть чат' : 'Свернуть чат'}">${isCollapsed ? '▸' : '▾'}</button>
          ${renderCardBody(p)}
          <div class="chat"${isCollapsed ? ' style="display:none"' : ''}>
            <div style="font-size:9px; color: rgba(224,224,224,0.4); margin-bottom:2px; letter-spacing:0.5px; text-transform:uppercase;">Сессии</div>
            ${sessionList}
            <div style="font-size:9px; color: rgba(224,224,224,0.4); margin: 4px 0 2px; letter-spacing:0.5px; text-transform:uppercase;">Чат · ${U.esc(activeLabel)}</div>
            <div class="log" data-chat-log="${U.esc(name)}">${logHtml}</div>
            <div class="row">
              <input type="text" data-chat-input="${U.esc(name)}" placeholder="сообщение…${activeSid ? '' : ' (новая сессия)'}" autocomplete="off">
              <button data-action="send" data-name="${U.esc(name)}">Отправить</button>
            </div>
          </div>
        </div>
      `);
    });
    const gridCols = filled === 0 ? 1 : (filled <= 2 ? filled : 4);
    if (filled === 0) {
      D.els.topGrid.style.gridTemplateRows = '1fr';
      frag.push(`<div class="card empty-slot" style="grid-column: 1 / -1; grid-row: 1 / -1; height: 100%;"><button class="assign-btn" data-action="pick">Назначить</button></div>`);
    } else {
      D.els.topGrid.style.gridTemplateRows = '';
    }
    D.els.topGrid.style.gridTemplateColumns = 'repeat(' + gridCols + ', 1fr)';
    D.els.topGrid.innerHTML = frag.join('');
    D.els.leadersCount.textContent = filled + '/' + C.LEADER_SLOTS;
  }

  function renderBottom() {
    const allNames = Object.keys(D.profilesByName).sort();
    const leaderSet = new Set(D.leaders.filter(Boolean));
    let list = allNames.filter(n => !leaderSet.has(n));
    if (D.filterText) {
      list = list.filter(n => n.toLowerCase().includes(D.filterText));
    }
    D.els.allCount.textContent = allNames.length;
    D.els.filterMeta.textContent = D.filterText
      ? `фильтр: ${list.length}/${allNames.length - leaderSet.size}`
      : '';
    if (list.length === 0) {
      D.els.bottomGrid.innerHTML = `<div class="card" style="grid-column: 1/-1; cursor: default; min-height: 80px; align-items: center; justify-content: center; color: rgba(224,224,224,0.4);">
        ${D.filterText ? 'ничего не найдено по фильтру' : 'нет профилей вне лидеров'}
      </div>`;
      return;
    }
    D.els.bottomGrid.innerHTML = list.map(name => {
      const p = D.profilesByName[name];
      return `<div class="card" data-name="${U.esc(name)}" data-action="promote" data-name="${U.esc(name)}">
        ${renderCardBody(p)}
      </div>`;
    }).join('');
  }

  function renderAddDropdown() {
    if (!D.els.addLeaderDropdown) return;
    if (!D.addDropdownOpen) {
      D.els.addLeaderDropdown.classList.remove('open');
      return;
    }
    const allNames = Object.keys(D.profilesByName).sort();
    const leaderSet = new Set(D.leaders.filter(Boolean));
    const candidates = allNames.filter(n => !leaderSet.has(n));
    if (candidates.length === 0) {
      D.els.addLeaderDropdown.innerHTML = '<div class="dd-empty">все профили уже назначены</div>';
    } else {
      D.els.addLeaderDropdown.innerHTML = candidates.map(n =>
        `<div class="dd-item" data-action="add-leader" data-name="${U.esc(n)}">${U.esc(n)}</div>`
      ).join('');
    }
    D.els.addLeaderDropdown.classList.add('open');
  }

  function appendChat(name, role, text) {
    if (!D.chatLog[name]) D.chatLog[name] = [];
    D.chatLog[name].push({ role, text, ts: Date.now() });
    if (D.chatLog[name].length > 100) D.chatLog[name] = D.chatLog[name].slice(-100);
    const logEl = D.els.topGrid.querySelector(`[data-chat-log="${CSS.escape(name)}"]`);
    if (logEl) {
      const empty = logEl.querySelector('.empty');
      if (empty) empty.remove();
      const div = document.createElement('div');
      div.className = 'msg-' + role;
      div.textContent = (role === 'you' ? '› ' : '‹ ') + text;
      logEl.appendChild(div);
      logEl.scrollTop = logEl.scrollHeight;
    }
  }

  function renderLog(name) {
    const log = D.chatLog[name] || [];
    const logEl = D.els.topGrid.querySelector(`[data-chat-log="${CSS.escape(name)}"]`);
    if (logEl) {
      logEl.innerHTML = log.length === 0
        ? '<div class="empty">диалог пуст</div>'
        : log.map(m => `<div class="msg-${m.role}">${m.role === 'you' ? '›' : '‹'} ${U.esc(m.text)}</div>`).join('');
      logEl.scrollTop = logEl.scrollHeight;
    }
  }

  function renderAll() {
    renderTop();
    renderBottom();
    renderAddDropdown();
  }

  function setConn(state, text) {
    D.connState = state;
    D.els.conn.classList.remove('demo', 'error');
    if (state === 'demo') D.els.conn.classList.add('demo');
    if (state === 'error') D.els.conn.classList.add('error');
    D.els.connText.textContent = text;
  }

  function updateProfileData() {
    document.querySelectorAll('.card[data-name]').forEach(card => {
      const name = card.dataset.name;
      const p = D.profilesByName[name];
      if (!p) return;

      const modelEl = card.querySelector('.model');
      if (modelEl) {
        const usageStr = U.fmtUsageStr(p);
        modelEl.textContent = p.model ? `${p.model} │ ${usageStr}` : usageStr;
      }

      const dot = card.querySelector('.status-dot');
      if (dot) {
        const status = p.task_status || 'idle';
        dot.className = 'status-dot ' + status;
        dot.title = status;
      }

      const taskEl = card.querySelector('.task');
      if (taskEl) {
        const taskId = taskEl.querySelector('.task-id');
        const taskTitle = taskEl.querySelector('.task-title');
        if (taskId && p.task_id) taskId.textContent = p.task_id;
        if (taskTitle && p.task_title) taskTitle.textContent = p.task_title;
        if (p.task_id || p.task_title) {
          taskEl.classList.remove('idle-task');
          if (taskId) taskId.style.display = '';
          if (taskTitle) taskTitle.style.display = '';
        } else {
          taskEl.classList.add('idle-task');
          if (taskId) taskId.textContent = '—';
          if (taskTitle) taskTitle.textContent = 'нет активной задачи';
        }
      }

      const timer = card.querySelector('.timer');
      if (timer) {
        const sec = p.started_at_ms ? Math.max(0, Math.floor((Date.now() - p.started_at_ms) / 1000)) : 0;
        timer.dataset.base = String(sec);
        timer.dataset.started = String(p.started_at_ms || 0);
        timer.className = 'timer' + (p.task_status === 'idle' ? ' idle-timer' : '');
      }

      const queueEl = card.querySelector('.task-queue');
      const tasks = p.tasks || [];
      const activeTaskId = p.task_id;
      if (tasks.length > 1 && queueEl) {
        const items = queueEl.querySelectorAll('.task-queue-item');
        tasks.forEach((t, i) => {
          const item = items[i];
          if (item) {
            const idEl = item.querySelector('.tq-id');
            const boardEl = item.querySelector('.tq-board');
            const statusEl = item.querySelector('.tq-status');
            if (idEl) idEl.textContent = t.id;
            if (boardEl) boardEl.textContent = (t.board || '?').substring(0, 10);
            if (statusEl) { statusEl.className = 'tq-status ' + t.status; }
            item.className = 'task-queue-item' + (t.id === activeTaskId ? ' active' : '');
            item.title = '[' + (t.board || '?') + '] ' + (t.title || '');
          }
        });
      } else if (tasks.length <= 1 && queueEl) {
        queueEl.remove();
      }
    });

    const filled = D.leaders.filter(Boolean).length;
    D.els.leadersCount.textContent = filled + '/' + C.LEADER_SLOTS;
    D.els.allCount.textContent = Object.keys(D.profilesByName).length;
  }

  window.Dashboard.Render = {
    renderAll,
    renderTop,
    renderBottom,
    renderAddDropdown,
    appendChat,
    renderLog,
    setConn,
    updateProfileData,
    sessionDisplayName,
  };
})();
(function () {
  'use strict';

  const D = window.Dashboard.Data;
  const A = window.Dashboard.API;
  const R = window.Dashboard.Render;

  function handleDragStart(e) {
    const card = e.target.closest('.card[data-name][data-slot]');
    if (!card) return;
    const name = card.dataset.name;
    const slot = Number(card.dataset.slot);
    D.dragSource = { name, slot };
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', name);
    card.classList.add('dragging');
  }

  function handleDragOver(e) {
    const card = e.target.closest('.card[data-name][data-slot]');
    if (!card) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    const slot = Number(card.dataset.slot);
    if (D.dragOverSlot !== null && D.dragOverSlot !== slot) {
      const prev = D.els.topGrid.querySelector(`.card[data-slot="${D.dragOverSlot}"]`);
      if (prev) prev.classList.remove('drag-over');
    }
    D.dragOverSlot = slot;
    card.classList.add('drag-over');
  }

  function handleDragEnd(e) {
    const card = e.target.closest('.card[data-name][data-slot]');
    if (card) card.classList.remove('dragging');
    if (D.dragOverSlot !== null) {
      const prev = D.els.topGrid.querySelector(`.card[data-slot="${D.dragOverSlot}"]`);
      if (prev) prev.classList.remove('drag-over');
    }
    D.dragSource = null;
    D.dragOverSlot = null;
  }

  function handleDrop(e) {
    const targetCard = e.target.closest('.card[data-name][data-slot]');
    if (!targetCard || !D.dragSource) return;
    e.preventDefault();
    const targetSlot = Number(targetCard.dataset.slot);
    const fromSlot = D.dragSource.slot;
    if (fromSlot === targetSlot) return;

    const fromName = D.leaders[fromSlot];
    const toName = D.leaders[targetSlot];
    D.leaders[fromSlot] = toName;
    D.leaders[targetSlot] = fromName;

    targetCard.classList.remove('drag-over');
    const fromCard = D.els.topGrid.querySelector(`.card[data-slot="${fromSlot}"]`);
    if (fromCard) fromCard.classList.remove('dragging');

    D.dragSource = null;
    D.dragOverSlot = null;
    A.saveUserRole().then(() => R.renderAll());
  }

  function attachListeners() {
    D.els.topGrid.addEventListener('dragstart', handleDragStart);
    D.els.topGrid.addEventListener('dragover', handleDragOver);
    D.els.topGrid.addEventListener('dragend', handleDragEnd);
    D.els.topGrid.addEventListener('drop', handleDrop);
  }

  window.Dashboard.DragDrop = { attachListeners };
})();
(function () {
  'use strict';

  const C = window.Dashboard.Config;
  const D = window.Dashboard.Data;
  const U = window.Dashboard.Utils;
  const A = window.Dashboard.API;
  const R = window.Dashboard.Render;

  function renderProfileModal() {
    if (!D.profileModalOpen) return;
    const allNames = Object.keys(D.profilesByName).sort();
    const leaderSet = new Set(D.leaders.filter(Boolean));
    const candidates = allNames.filter(n => !leaderSet.has(n));
    const filtered = D.profileModalFilter
      ? candidates.filter(n => n.toLowerCase().includes(D.profileModalFilter.toLowerCase()))
      : candidates;

    const remaining = C.LEADER_SLOTS - D.leaders.filter(Boolean).length;
    const selectedCount = D.profileModalSelected.length;

    const listHtml = filtered.length === 0
      ? '<div class="profile-modal-empty">' + (D.profileModalFilter ? 'ничего не найдено' : 'все профили уже назначены') + '</div>'
      : filtered.map(n => {
          const p = D.profilesByName[n] || {};
          const status = p.task_status || 'idle';
          const model = p.model || '';
          const isSelected = D.profileModalSelected.includes(n);
          return `<div class="profile-modal-item ${isSelected ? 'selected' : ''}" data-action="pm-toggle" data-pm-name="${U.esc(n)}">
            <span class="pm-check">${isSelected ? '✓' : ''}</span>
            <span class="pm-dot ${U.esc(status)}"></span>
            <span class="pm-name">${U.esc(n)}</span>
            ${model ? `<span class="pm-model">${U.esc(model)}</span>` : ''}
          </div>`;
        }).join('');

    const old = document.querySelector('.profile-modal-overlay');
    if (old) old.remove();

    const overlay = document.createElement('div');
    overlay.className = 'profile-modal-overlay';
    overlay.innerHTML = `<div class="profile-modal">
      <div class="profile-modal-header">
        <h3>Выберите профили · <span class="pm-counter">${selectedCount}/${remaining}</span></h3>
        <div class="profile-modal-header-btns">
          <button class="profile-modal-close-btn" data-action="pm-close-text">Закрыть</button>
          <button class="profile-modal-close" data-action="pm-close">&times;</button>
        </div>
      </div>
      <div class="profile-modal-search">
        <input type="text" id="pmSearchInput" placeholder="Поиск профиля…" autocomplete="off">
      </div>
      <div class="profile-modal-list">${listHtml}</div>
    </div>`;

    document.body.appendChild(overlay);

    const searchInput = document.getElementById('pmSearchInput');
    if (searchInput) {
      searchInput.focus();
      searchInput.addEventListener('input', (e) => {
        D.profileModalFilter = e.target.value;
        renderProfileModal();
      });
    }

    overlay.addEventListener('click', (e) => {
      if (e.target === overlay) {
        closeProfileModal();
        return;
      }
      const t = e.target.dataset.action ? e.target : e.target.closest('[data-action]');
      if (!t) return;
      const action = t.dataset.action;
      if (action === 'pm-close-text' || action === 'pm-close') {
        closeProfileModal();
      } else if (action === 'pm-toggle') {
        const name = t.dataset.pmName;
        if (!name) return;
        const idx = D.profileModalSelected.indexOf(name);
        if (idx >= 0) {
          D.profileModalSelected.splice(idx, 1);
          renderProfileModal();
        } else {
          if (D.profileModalSelected.length >= remaining) return;
          D.profileModalSelected.push(name);
          if (D.profileModalSelected.length >= remaining) {
            closeProfileModal();
          } else {
            renderProfileModal();
          }
        }
      }
    });
  }

  function showProfileModal() {
    D.profileModalOpen = true;
    D.profileModalFilter = '';
    D.profileModalSelected = [];
    renderProfileModal();
  }

  function closeProfileModal() {
    if (D.profileModalSelected.length > 0) {
      let selIdx = 0;
      for (let i = 0; i < C.LEADER_SLOTS && selIdx < D.profileModalSelected.length; i++) {
        if (D.leaders[i] === null) {
          D.leaders[i] = D.profileModalSelected[selIdx];
          A.loadSessionsFor(D.profileModalSelected[selIdx]);
          selIdx++;
        }
      }
      A.saveUserRole().then(() => R.renderAll());
    }
    D.profileModalOpen = false;
    D.profileModalFilter = '';
    D.profileModalSelected = [];
    const overlay = document.querySelector('.profile-modal-overlay');
    if (overlay) overlay.remove();
  }

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && D.profileModalOpen) {
      closeProfileModal();
    }
  });

  window.Dashboard.Modal = {
    showProfileModal,
    closeProfileModal,
    renderProfileModal,
  };
})();
(function () {
  'use strict';

  const C = window.Dashboard.Config;
  const D = window.Dashboard.Data;
  const A = window.Dashboard.API;
  const R = window.Dashboard.Render;
  const Drag = window.Dashboard.DragDrop;
  const Modal = window.Dashboard.Modal;

  // ---- Filter + Dropdown wiring ----
  D.els.filterInput.addEventListener('input', (e) => {
    D.filterText = (e.target.value || '').toLowerCase().trim();
    R.renderAll();
  });

  document.addEventListener('click', (e) => {
    if (D.addDropdownOpen && !e.target.closest('#addLeaderBtn') && !e.target.closest('#addLeaderDropdown')) {
      D.addDropdownOpen = false;
      D.pendingPickSlot = null;
      D.els.addLeaderDropdown.classList.remove('open');
    }
  });

  if (D.els.addLeaderBtn) {
    D.els.addLeaderBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      Modal.showProfileModal();
    });
  }

  // ---- Chat optimization actions ----
  async function doOptimize(name) {
    if (D.optimizing.has(name)) return;
    D.optimizing.add(name);
    R.renderAll();
    try {
      await A.postOptimize(name);
      R.appendChat(name, 'bot', '✓ контекст оптимизирован');
    } catch (e) {
      R.appendChat(name, 'bot', '⚠ optimize error: ' + e.message);
    } finally {
      D.optimizing.delete(name);
      R.renderAll();
    }
  }

  async function doSend(name, input) {
    const text = (input.value || '').trim();
    if (!text) return;
    input.value = '';
    R.appendChat(name, 'you', text);
    try {
      const sid = D.activeSessionMap[name];
      const r = await A.postChat(name, text, sid);
      const reply = (r && (r.reply || r.message || r.response)) || JSON.stringify(r);
      R.appendChat(name, 'bot', String(reply));
      const newSid = r && r.session_id;
      if (!sid && newSid) {
        D.activeSessionMap[name] = newSid;
        D.sessionsMap[name] = D.sessionsMap[name] || [];
        const existing = D.sessionsMap[name].find(s => s.id === newSid);
        if (!existing) {
          D.sessionsMap[name].unshift({ id: newSid, title: null, source: 'chat', message_count: 1, last_message_at: new Date().toISOString() });
        } else {
          existing.message_count = (existing.message_count || 0) + 1;
          existing.last_message_at = new Date().toISOString();
        }
        R.renderAll();
      } else if (sid) {
        const list = D.sessionsMap[name] || [];
        const s = list.find(x => x.id === sid);
        if (s) {
          s.message_count = (s.message_count || 0) + 1;
          s.last_message_at = new Date().toISOString();
          R.renderAll();
        }
      }
    } catch (e) {
      R.appendChat(name, 'bot', '⚠ chat error: ' + e.message);
    }
  }

  async function doRenameSession(name, sid, title) {
    try {
      await A.renameSession(name, sid, title);
      const list = D.sessionsMap[name] || [];
      const s = list.find(x => x.id === sid);
      if (s) s.title = title || null;
      R.renderAll();
    } catch (e) {
      R.appendChat(name, 'bot', '⚠ rename error: ' + e.message);
    }
  }

  async function doDeleteSession(name, sid) {
    try {
      await A.deleteSession(name, sid);
      const list = D.sessionsMap[name] || [];
      const idx = list.findIndex(x => x.id === sid);
      if (idx >= 0) list.splice(idx, 1);
      if (D.activeSessionMap[name] === sid) D.activeSessionMap[name] = null;
      R.renderAll();
    } catch (e) {
      R.appendChat(name, 'bot', '⚠ delete error: ' + e.message);
    }
  }

  async function loadSessionsFor(name) {
    try {
      const list = await A.listSessions(name);
      D.sessionsMap[name] = list;
      if (D.activeSessionMap[name] === undefined && list.length > 0) {
        D.activeSessionMap[name] = list[0].id;
      }
      const activeId = D.activeSessionMap[name];
      if (activeId) {
        await A.loadSessionMessages(name, activeId);
      }
    } catch (e) {
      D.sessionsMap[name] = [];
    }
  }

  function promoteToTop(name) {
    if (!D.profilesByName[name]) return;
    if (D.leaders.includes(name)) return;
    const nullIdx = D.leaders.indexOf(null);
    if (nullIdx !== -1) {
      D.leaders[nullIdx] = name;
    } else {
      D.leaders.shift();
      D.leaders.push(name);
    }
    A.saveUserRole().then(() => R.renderAll());
  }

  function demoteFromTop(name) {
    const idx = D.leaders.indexOf(name);
    if (idx === -1) return;
    D.leaders[idx] = null;
    A.saveUserRole().then(() => R.renderAll());
  }

  function toggleChatCollapse(name) {
    D.chatCollapsed[name] = !D.chatCollapsed[name];
    R.renderAll();
  }

  // ---- Delegated click handler ----
  document.addEventListener('click', (e) => {
    const t = e.target.dataset.action ? e.target : e.target.closest('[data-action]');
    if (!t) return;
    const action = t.dataset.action;

    if (action === 'optimize') {
      e.stopPropagation();
      doOptimize(t.dataset.name);
    } else if (action === 'send') {
      e.stopPropagation();
      const name = t.dataset.name;
      const input = D.els.topGrid.querySelector(`[data-chat-input="${CSS.escape(name)}"]`);
      if (input) doSend(name, input);
    } else if (action === 'promote') {
      promoteToTop(t.dataset.name);
    } else if (action === 'pick') {
      Modal.showProfileModal();
    } else if (action === 'demote') {
      demoteFromTop(t.dataset.name);
    } else if (action === 'sess-select') {
      e.stopPropagation();
      const name = t.dataset.name;
      const sid = t.dataset.sid;
      D.activeSessionMap[name] = sid;
      A.loadSessionMessages(name, sid).then(() => R.renderLog(name));
      R.renderAll();
    } else if (action === 'sess-rename') {
      e.stopPropagation();
      const name = t.dataset.name;
      const sid = t.dataset.sid;
      const list = D.sessionsMap[name] || [];
      const s = list.find(x => x.id === sid);
      const current = s ? (s.title || '') : '';
      const next = window.prompt('Новое название сессии:', current);
      if (next === null) return;
      doRenameSession(name, sid, next.trim());
    } else if (action === 'sess-delete') {
      e.stopPropagation();
      const name = t.dataset.name;
      const sid = t.dataset.sid;
      if (!window.confirm('Удалить сессию?')) return;
      doDeleteSession(name, sid);
    } else if (action === 'sess-new') {
      e.stopPropagation();
      const name = t.dataset.name;
      if (D.sessionsApiAvailable) {
        A.createSession(name).then(sess => {
          if (sess && sess.id) {
            D.sessionsMap[name] = D.sessionsMap[name] || [];
            const existing = D.sessionsMap[name].find(s => s.id === sess.id);
            if (!existing) D.sessionsMap[name].unshift(sess);
            D.activeSessionMap[name] = sess.id;
            R.appendChat(name, 'bot', '✦ новая сессия создана');
            R.renderAll();
          } else {
            D.activeSessionMap[name] = null;
            R.appendChat(name, 'bot', '✦ новая сессия — следующее сообщение начнёт её');
            R.renderAll();
          }
        }).catch(() => {
          D.activeSessionMap[name] = null;
          R.appendChat(name, 'bot', '✦ новая сессия — следующее сообщение начнёт её');
          R.renderAll();
        });
      } else {
        const sess = A.localCreate ? A.localCreate(name) : null;
        // Note: local helpers are used inside API; exported alias below
        if (sess) {
          D.sessionsMap[name] = A.localList ? A.localList(name) : [];
          D.activeSessionMap[name] = sess.id;
          R.appendChat(name, 'bot', '✦ новая сессия создана (локально)');
          R.renderAll();
        }
      }
    } else if (action === 'add-leader') {
      e.stopPropagation();
      const name = t.dataset.name;
      D.addDropdownOpen = false;
      D.els.addLeaderDropdown.classList.remove('open');
      if (D.pendingPickSlot !== null) {
        D.leaders[D.pendingPickSlot] = name;
        D.pendingPickSlot = null;
      } else {
        const nullIdx = D.leaders.indexOf(null);
        if (nullIdx !== -1) {
          D.leaders[nullIdx] = name;
        } else {
          D.leaders.shift();
          D.leaders.push(name);
        }
      }
      loadSessionsFor(name);
      A.saveUserRole().then(() => R.renderAll());
    } else if (action === 'remove-leader') {
      e.stopPropagation();
      const name = t.dataset.name;
      const idx = D.leaders.indexOf(name);
      if (idx !== -1) {
        D.leaders[idx] = null;
        A.saveUserRole().then(() => R.renderAll());
      }
    } else if (action === 'toggle-chat') {
      e.stopPropagation();
      toggleChatCollapse(t.dataset.name);
    }
  });

  // Header clicks promote/demote
  D.els.topGrid.addEventListener('click', (e) => {
    const head = e.target.closest('.head');
    if (!head) return;
    const card = head.closest('.card[data-name]');
    if (!card) return;
    demoteFromTop(card.dataset.name);
  });
  D.els.bottomGrid.addEventListener('click', (e) => {
    const head = e.target.closest('.head');
    if (!head) return;
    const card = head.closest('.card[data-name]');
    if (!card) return;
    promoteToTop(card.dataset.name);
  });

  // Enter in chat input
  D.els.topGrid.addEventListener('keydown', (e) => {
    if (e.key !== 'Enter') return;
    const inp = e.target.closest('[data-chat-input]');
    if (!inp) return;
    e.preventDefault();
    const name = inp.dataset.chatInput;
    doSend(name, inp);
  });

  // Polling
  async function tick() {
    try {
      const map = await A.loadProfiles();
      const oldNames = Object.keys(D.profilesByName).sort().join(',');
      const newNames = Object.keys(map).sort().join(',');

      const oldLeaders = D.leaders.join(',');
      D.profilesByName = map;
      const known = new Set(Object.keys(map));
      D.leaders = D.leaders.map(n => (n && known.has(n)) ? n : null);
      const newLeaders = D.leaders.join(',');

      if (oldNames !== newNames || oldLeaders !== newLeaders) {
        const curLeaders = D.leaders.filter(Boolean);
        if (curLeaders.length > 0) {
          await Promise.all(curLeaders.map(n => loadSessionsFor(n)));
        }
        R.renderAll();
      } else {
        R.updateProfileData();
      }

      const filled = D.leaders.filter(Boolean).length;
      D.els.leadersCount.textContent = filled + '/' + C.LEADER_SLOTS;
      D.els.allCount.textContent = Object.keys(D.profilesByName).length;
      R.setConn('live', 'live · API · ' + Object.keys(map).length);
      D.lastError = '';
    } catch (e) {
      D.lastError = e.message || String(e);
      R.setConn('error', 'error · ' + D.lastError);
    }
  }

  setInterval(() => {
    document.querySelectorAll('.timer[data-base]').forEach(t => {
      const base = Number(t.dataset.base || 0);
      const started = Number(t.dataset.started || 0);
      if (!started) {
        t.textContent = U.fmtUptime(base);
        return;
      }
      const sec = Math.max(0, Math.floor((Date.now() - started) / 1000));
      t.textContent = U.fmtUptime(sec);
    });
  }, 1000);

  document.addEventListener('keydown', (e) => {
    if (e.key === 'r' || e.key === 'R') {
      if (document.activeElement && /input|textarea/i.test(document.activeElement.tagName)) return;
      tick();
    }
  });

  // Boot
  A.loadUserRole().then(() => {
    Drag.attachListeners();
    tick();
    setInterval(tick, C.POLL_MS);
  });

  // Expose helpers used by Actions
  window.Dashboard.Actions = {
    loadSessionsFor,
    promoteToTop,
    demoteFromTop,
    toggleChatCollapse,
    doOptimize,
    doSend,
    doRenameSession,
    doDeleteSession,
  };
})();
