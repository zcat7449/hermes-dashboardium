(function () {
  'use strict';

  // Module version marker for cache-busting verification.
  window.Dashboard = window.Dashboard || {};
  window.Dashboard._api_version = 3;

  const C = window.Dashboard.Config;
  const D = window.Dashboard.Data;
  const U = window.Dashboard.Utils;
  // Render is loaded before api.js in index.html; use lazy access inside handlers
  // to stay safe if module load order ever changes or cache serves stale ordering.
  const R = window.Dashboard.Render;

  function getRender() { return window.Dashboard.Render || R; }

  async function fetchJson(url, opts, timeoutMs) {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), timeoutMs || C.FETCH_TIMEOUT_MS);
    const headers = Object.assign({}, (opts && opts.headers) || {});
    if (C.AUTH) headers['Authorization'] = 'Basic ' + C.AUTH;
    try {
      const r = await fetch(url, Object.assign({}, opts || {}, { headers, signal: ctrl.signal }));
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
      const watchedEntries = entries
        .filter(e => e.role === 'watched')
        .sort((a, b) => a.order - b.order);
      D.watched = watchedEntries.map(e => e.profile).slice(0, D.MAX_WATCHED);
    } catch (e) {
      U.debugWarn('loadUserRole error, using defaults', e);
      D.leaders = ['orchestrator', 'rechelok', 'aitrainer', null];
      D.watched = [];
    }
  }

  async function saveUserRole() {
    const entries = [];
    D.leaders.forEach((name, idx) => {
      if (name) {
        entries.push({
          userId: 'default',
          role: 'leader',
          profile: name,
          order: idx,
        });
      }
    });
    D.watched.forEach((name, idx) => {
      entries.push({
        userId: 'default',
        role: 'watched',
        profile: name,
        order: idx,
      });
    });
    D.userRoleEntries = entries;
    // Show saving indicator
    const connEl = document.getElementById('connText');
    if (connEl) connEl.textContent = 'saving…';
    try {
      await fetchJson(C.API_BASE + '/api/user-role', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ entries }),
      });
    } catch (e) {
      U.debugWarn('saveUserRole error', e);
    } finally {
      if (connEl) connEl.textContent = 'live · API';
    }
  }

  // ---- Profiles / Chat / Optimize ----
  async function loadProfiles() {
    try {
      const data = await fetchJson(C.API_BASE + '/api/profiles');
      const list = (data && (data.profiles || data)) || [];
      if (!Array.isArray(list)) throw new Error('Bad payload');
      const map = {};
      for (const raw of list) {
        const p = U.normProfile(raw);
        if (p.name) map[p.name] = p;
      }
      return map;
    } catch (e) {
      U.debugWarn('loadProfiles error', e);
      // Return empty map on error — UI shows empty state, not crash
      return {};
    }
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
  // P2 fix: localStorage quota handling. If setItem throws QuotaExceededError
  // (e.g. profile has 10MB of session titles), evict OLDEST key for this profile
  // and retry. If still fails, fall back to in-memory Map so the UI keeps working.
  const _memFallback = new Map();
  function lsSave(name, list) {
    const key = lsKey(name);
    try {
      localStorage.setItem(key, JSON.stringify(list));
    } catch (e) {
      // Quota exceeded — try to evict some old sessions from this profile's key
      if (e && (e.name === 'QuotaExceededError' || e.code === 22)) {
        try {
          // Compact: keep only the 50 most recent items
          const trimmed = Array.isArray(list) ? list.slice(-50) : [];
          localStorage.setItem(key, JSON.stringify(trimmed));
        } catch (e2) {
          // Still failing — fall back to in-memory map
          _memFallback.set(key, list);
        }
      } else {
        _memFallback.set(key, list);
      }
    }
  }
  function lsLoad(name) {
    const key = lsKey(name);
    if (_memFallback.has(key)) return _memFallback.get(key);
    try { return JSON.parse(localStorage.getItem(key) || '[]') || []; }
    catch (e) { return []; }
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
    const prevLoaded = D.loadedSessions[name];
    D.loadedSessions[name] = sid;
    try {
      const r = await fetchJson(C.API_BASE + '/api/profiles/' + encodeURIComponent(name) + '/sessions/' + encodeURIComponent(sid) + '/messages');
      const msgs = (r && r.messages) || [];
      // If we're switching to a different session, REPLACE the chat log entirely.
      // Otherwise (same session, just a refresh) merge with dedup.
      if (prevLoaded !== sid) {
        const fresh = [];
        for (const m of msgs) {
          if (m.role === 'user' || m.role === 'assistant') {
            const text = m.content || '';
            if (text) {
              // P2 fix: tag each loaded message with its session id so that
              // session switching can filter the log per-session.
              fresh.push({ role: m.role === 'user' ? 'you' : 'bot', text, ts: (m.timestamp || 0) * 1000, sessionId: sid });
            }
          }
        }
        // P1 fix: cap switch-session chat log to last 100 entries (was unbounded).
        // Server may return 10k+ messages for ancient sessions.
        D.chatLog[name] = fresh.length > 100 ? fresh.slice(-100) : fresh;
        getRender().renderLog(name);
      } else {
        const existing = D.chatLog[name] || [];
        const existingSet = new Set(existing.map(m => (m.ts || 0) + '|' + m.text));
        for (const m of msgs) {
          if (m.role === 'user' || m.role === 'assistant') {
            const text = m.content || '';
            if (text) {
              const key = ((m.timestamp || 0) * 1000) + '|' + text;
              if (!existingSet.has(key)) {
                existing.push({ role: m.role === 'user' ? 'you' : 'bot', text, ts: (m.timestamp || 0) * 1000, sessionId: sid });
                existingSet.add(key);
              }
            }
          }
        }
        if (existing.length > 100) D.chatLog[name] = existing.slice(-100);
      }
    } catch (e) {
      U.debugWarn('load messages error', e);
    }
  }

  // ---- Task API ----
  async function fetchTaskDetails(board, taskId) {
    return fetchJson(C.API_BASE + '/api/tasks/' + encodeURIComponent(board) + '/' + encodeURIComponent(taskId));
  }
  async function blockTask(board, taskId, reason) {
    return fetchJson(C.API_BASE + '/api/tasks/' + encodeURIComponent(board) + '/' + encodeURIComponent(taskId) + '/block', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ reason: reason || 'Blocked from Dashboardium' }),
    });
  }
  async function unblockTask(board, taskId, reason) {
    return fetchJson(C.API_BASE + '/api/tasks/' + encodeURIComponent(board) + '/' + encodeURIComponent(taskId) + '/unblock', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ reason: reason || 'Unblocked from Dashboardium' }),
    });
  }
  async function reassignTask(board, taskId, assignee) {
    return fetchJson(C.API_BASE + '/api/tasks/' + encodeURIComponent(board) + '/' + encodeURIComponent(taskId) + '/reassign', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ assignee }),
    });
  }
  async function archiveTask(board, taskId) {
    return fetchJson(C.API_BASE + '/api/tasks/' + encodeURIComponent(board) + '/' + encodeURIComponent(taskId) + '/archive', {
      method: 'POST',
    });
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
    loadSessionsFor,
    fetchTaskDetails,
    blockTask,
    unblockTask,
    reassignTask,
    archiveTask,
    // Local storage fallbacks for offline / API-down scenarios.
    localCreate,
    localList,
    localDelete,
    // Internal reconnect is handled by wsScheduleReconnect().
    // wsReconnect is NOT exported — callers use wsConnect() directly.
    wsConnect,
    wsSend,
    wsClose,
  };

  // ---- Sessions loading (used by both WS handler and REST fallback) ----
  async function loadSessionsFor(name) {
    try {
      const list = await listSessions(name);
      D.sessionsMap[name] = list;
      if (D.activeSessionMap[name] === undefined && list.length > 0) {
        D.activeSessionMap[name] = list[0].id;
      }
      const activeId = D.activeSessionMap[name];
      if (activeId) {
        await loadSessionMessages(name, activeId);
      }
    } catch (e) {
      D.sessionsMap[name] = [];
    }
  }

  // ---- WebSocket (replaces polling) ----
  let ws = null;
  let wsReconnectAttempt = 0;
  let wsReconnectTimer = null;
  let wsPollFallbackTimer = null;

  function wsConnect() {
    if (ws && (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING)) return;

    try {
      // Build WS URL with auth token (server requires ?token=base64(user:pass))
      let wsUrl = C.WS_URL;
      if (C.AUTH) {
        wsUrl += (wsUrl.includes('?') ? '&' : '?') + 'token=' + encodeURIComponent(C.AUTH);
      }
      ws = new WebSocket(wsUrl);
    } catch (e) {
      U.debugWarn('ws: failed to create WebSocket, falling back to REST polling', e);
      getRender().setConn('error', 'reconnecting · WS failed · REST fallback');
      startRestPolling();
      return;
    }

    ws.onopen = () => {
      U.debugLog('ws: connected');
      wsReconnectAttempt = 0;
      D.connState = 'live';
      getRender().setConn('live', 'live · WS · ' + Object.keys(D.profilesByName).length);
      // Stop REST fallback if it was running
      stopRestPolling();
    };

    ws.onmessage = (event) => {
      let msg;
      try {
        msg = JSON.parse(event.data);
      } catch {
        return;
      }
      handleWsMessage(msg);
    };

    ws.onclose = (event) => {
      U.debugLog('ws: disconnected', event.code, event.reason);
      // P1 fix: stop ALL typing timers on WS disconnect so a 120s false
      // "model didn't answer" warning never appears for a connection that's dead.
      if (window.Dashboard && window.Dashboard.Actions && window.Dashboard.Actions.stopAllTypingTimers) {
        try { window.Dashboard.Actions.stopAllTypingTimers(); } catch {}
      }
      ws = null;
      getRender().setConn('error', 'reconnecting…');
      wsScheduleReconnect();
    };

    ws.onerror = (err) => {
      console.error('ws: error', err && err.message);
      err && err.preventDefault && err.preventDefault();
      // P1 fix: in some browsers (Firefox/Chromium) onerror fires WITHOUT
      // a subsequent onclose. Stop timers now too, and schedule reconnect
      // if onclose never comes.
      if (window.Dashboard && window.Dashboard.Actions && window.Dashboard.Actions.stopAllTypingTimers) {
        try { window.Dashboard.Actions.stopAllTypingTimers(); } catch {}
      }
      // Safety net: if onclose doesn't fire within 5s, force reconnect
      if (!ws._errorReconnectScheduled) {
        ws._errorReconnectScheduled = true;
        setTimeout(() => {
          if (ws && ws.readyState !== WebSocket.OPEN && ws.readyState !== WebSocket.CONNECTING) {
            try { ws.close(); } catch {}
            ws = null;
            wsScheduleReconnect();
          }
        }, 5000);
      }
    };
  }

  function wsSend(data) {
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify(data));
      return true;
    }
    return false;
  }

  function wsClose() {
    if (wsReconnectTimer) {
      clearTimeout(wsReconnectTimer);
      wsReconnectTimer = null;
    }
    stopRestPolling();
    if (ws) {
      ws.close();
      ws = null;
    }
  }

  function wsReconnect() {
    wsScheduleReconnect();
  }

  function wsScheduleReconnect() {
    if (wsReconnectTimer) clearTimeout(wsReconnectTimer);
    const delay = C.WS_RECONNECT_DELAYS[Math.min(wsReconnectAttempt, C.WS_RECONNECT_DELAYS.length - 1)];
    wsReconnectAttempt++;
    U.debugLog('ws: reconnecting in ' + delay + 'ms (attempt ' + wsReconnectAttempt + ')');
    getRender().setConn('error', 'reconnecting · ' + wsReconnectAttempt + ' · ' + delay + 'ms');
    wsReconnectTimer = setTimeout(() => {
      wsConnect();
    }, delay);
  }

  function startRestPolling() {
    if (wsPollFallbackTimer) return; // already running
    U.debugLog('ws: starting REST polling fallback');
    restPollTick(); // immediate first poll
    wsPollFallbackTimer = setInterval(restPollTick, C.POLL_MS);
  }

  function stopRestPolling() {
    if (wsPollFallbackTimer) {
      clearInterval(wsPollFallbackTimer);
      wsPollFallbackTimer = null;
    }
  }

  async function restPollTick() {
    try {
      const map = await loadProfiles();
      D.profilesByName = map;
      const known = new Set(Object.keys(map));
      D.leaders = D.leaders.map(n => (n && known.has(n)) ? n : null);

      getRender().updateProfileData();

      const filled = D.leaders.filter(Boolean).length;
      D.els.leadersCount.textContent = filled + '/' + C.LEADER_SLOTS;
      D.els.allCount.textContent = Object.keys(D.profilesByName).length;
      getRender().setConn('live', 'live · REST · ' + Object.keys(map).length);
      D.lastError = '';
    } catch (e) {
      D.lastError = e.message || String(e);
      getRender().setConn('error', 'error · ' + D.lastError);
    }
  }

  function handleWsMessage(msg) {
    switch (msg.type) {
      case 'profiles': {
        const list = (msg.profiles || []);
        if (!Array.isArray(list)) return;
        const map = {};
        for (const raw of list) {
          const p = U.normProfile(raw);
          if (p.name) map[p.name] = p;
        }

        D.profilesByName = map;
        const known = new Set(Object.keys(map));
        D.leaders = D.leaders.map(n => (n && known.has(n)) ? n : null);

        // Only update profile data (status, usage, timer) — don't re-render chat
        getRender().updateProfileData();

        // Refresh sessions list for leaders — THROTTLED (was: on every WS profiles push = 4 RPS)
        // Now: at most once every 5s, and only if not already in flight.
        if (!D._sessionsRefreshInFlight && (!D._lastSessionsRefresh || Date.now() - D._lastSessionsRefresh > 5000)) {
          D._sessionsRefreshInFlight = true;
          D._lastSessionsRefresh = Date.now();
          const curLeaders = D.leaders.filter(Boolean);
          Promise.all(curLeaders.map(name => listSessions(name).then(list => ({ name, list }))))
            .then(results => {
              for (const { name, list } of results) {
                D.sessionsMap[name] = list;
                if (D.activeSessionMap[name] === undefined && list.length > 0) {
                  D.activeSessionMap[name] = list[0].id;
                }
                // Check for new messages in active session
                const activeSid = D.activeSessionMap[name];
                if (!activeSid) continue;
                const activeSession = list.find(s => s.id === activeSid);
                if (!activeSession) continue;
                const prevCount = D._lastMsgCount[name + ':' + activeSid];
                const curCount = activeSession.message_count || 0;
                if (prevCount === undefined) {
                  // First push after connect/load — backfill the active session
                  loadSessionMessages(name, activeSid);
                } else if (curCount > prevCount) {
                  loadSessionMessages(name, activeSid);
                }
                D._lastMsgCount[name + ':' + activeSid] = curCount;
              }
              getRender().renderSessionPanelAll();
            })
            .catch(e => U.debugWarn('sessions refresh error', e))
            .finally(() => { D._sessionsRefreshInFlight = false; });
        }

        const filled = D.leaders.filter(Boolean).length;
        // P2 fix: null-check D.els.* — if a script load order issue or DOM
        // mutation removed the elements, this would throw and break the
        // entire profiles handler. Defensive defaults avoid the crash.
        if (D.els.leadersCount) D.els.leadersCount.textContent = filled + '/' + C.LEADER_SLOTS;
        if (D.els.allCount) D.els.allCount.textContent = Object.keys(D.profilesByName).length;
        getRender().setConn('live', 'live · WS · ' + Object.keys(map).length);
        D.lastError = '';
        break;
      }

      case 'chat_update': {
        const { profile, role, text, session_id } = msg;
        if (!profile || !text) break;
        // Ensure chat log exists
        if (!D.chatLog[profile]) D.chatLog[profile] = [];
        // Append via appendChat — no DOM re-render, scroll preserved
        // Pass session_id explicitly so the message is tagged with the correct
        // session even if the user switches sessions before the WS response arrives.
        getRender().appendChat(profile, role, text, session_id);
        // Update session message count if we have it
        if (session_id) {
          const list = D.sessionsMap[profile] || [];
          const s = list.find(x => x.id === session_id);
          if (s) {
            s.message_count = (s.message_count || 0) + 1;
            s.last_message_at = new Date().toISOString();
          }
        }
        break;
      }

      case 'chat_response': {
        const { profile, response, session_id, new_session } = msg;
        // Remove typing indicator + stop timer
        getRender().removeLastChat(profile, 'typing');
        if (D._typingTimers && D._typingTimers[profile]) {
          clearInterval(D._typingTimers[profile]);
          delete D._typingTimers[profile];
        }
        getRender().appendChat(profile, 'bot', String(response || ''), session_id);
        if (new_session && session_id) {
          D.activeSessionMap[profile] = session_id;
          D.sessionsMap[profile] = D.sessionsMap[profile] || [];
          const existing = D.sessionsMap[profile].find(s => s.id === session_id);
          if (!existing) {
            D.sessionsMap[profile].unshift({ id: session_id, title: null, source: 'chat', message_count: 1, last_message_at: new Date().toISOString() });
          } else {
            existing.message_count = (existing.message_count || 0) + 1;
            existing.last_message_at = new Date().toISOString();
          }
          getRender().renderAll();
        } else if (session_id) {
          const list = D.sessionsMap[profile] || [];
          const s = list.find(x => x.id === session_id);
          if (s) {
            s.message_count = (s.message_count || 0) + 1;
            s.last_message_at = new Date().toISOString();
            getRender().renderAll();
          }
        }
        break;
      }

      case 'chat_error': {
        // Remove typing indicator + stop timer
        getRender().removeLastChat(msg.profile, 'typing');
        if (D._typingTimers && D._typingTimers[msg.profile]) {
          clearInterval(D._typingTimers[msg.profile]);
          delete D._typingTimers[msg.profile];
        }
        getRender().appendChat(msg.profile, 'bot', '⚠ chat error: ' + (msg.error || 'unknown'));
        break;
      }

      case 'optimize_response': {
        getRender().appendChat(msg.profile, 'bot', '✓ контекст оптимизирован');
        D.optimizing.delete(msg.profile);
        getRender().renderAll();
        break;
      }

      case 'optimize_error': {
        getRender().appendChat(msg.profile, 'bot', '⚠ optimize error: ' + (msg.error || 'unknown'));
        D.optimizing.delete(msg.profile);
        getRender().renderAll();
        break;
      }

      case 'pong':
        // keepalive — nothing to do
        break;

      case 'error':
        U.debugWarn('ws: server error', msg.error);
        break;
    }
  }
})();
