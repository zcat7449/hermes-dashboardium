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
