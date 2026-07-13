(function () {
  'use strict';

  const C = window.Dashboard.Config;
  const D = window.Dashboard.Data;
  const A = window.Dashboard.API;
  const R = window.Dashboard.Render;
  const Drag = window.Dashboard.DragDrop;
  const Modal = window.Dashboard.Modal;
  const U = window.Dashboard.Utils;

  // ---- Filter + Dropdown wiring ----
  let filterDebounceTimer = null;
  D.els.filterInput.addEventListener('input', (e) => {
    clearTimeout(filterDebounceTimer);
    filterDebounceTimer = setTimeout(() => {
      D.filterText = (e.target.value || '').toLowerCase().trim();
      R.renderAll();
    }, 300);
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

  const addWatchedBtn = document.getElementById('addWatchedBtn');
  if (addWatchedBtn) {
    addWatchedBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      Modal.showWatchedModal();
    });
  }

  // ---- Chat optimization actions ----
  async function doOptimize(name) {
    if (D.optimizing.has(name)) return;
    D.optimizing.add(name);
    R.renderAll();
    // Try WebSocket first
    if (A.wsSend({ type: 'optimize', profile: name })) {
      // Response will come via WS onmessage → handleWsMessage
      return;
    }
    // Fallback to REST
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

  // Track in-flight sends per profile to prevent double-clicks / duplicate sends.
  D._sending = D._sending || new Set();
  D._typingTimers = D._typingTimers || {};

  function startTypingTimer(name) {
    stopTypingTimer(name);
    const update = () => {
      const logEl = D.els.topGrid.querySelector(`[data-chat-log="${CSS.escape(name)}"]`);
      if (!logEl) { stopTypingTimer(name); return; }
      const typingEl = logEl.querySelector('.msg-typing');
      if (!typingEl) { stopTypingTimer(name); return; }
      const elapsed = Math.floor((Date.now() - (typingEl._startTime || Date.now())) / 1000);
      const timerEl = typingEl.querySelector('.timer');
      if (timerEl) {
        if (elapsed < 60) timerEl.textContent = elapsed + 'с';
        else timerEl.textContent = Math.floor(elapsed / 60) + 'м ' + (elapsed % 60) + 'с';
      }
      const textEl = typingEl.querySelector('.typing-text');
      if (textEl && elapsed >= 30) textEl.textContent = 'модель думает (долго)';
      if (elapsed >= 120) {
        R.removeLastChat(name, 'typing');
        R.appendChat(name, 'bot', '⚠ модель не ответила за 2 минуты — возможно профиль занят. Попробуйте ещё раз.');
        stopTypingTimer(name);
      }
    };
    D._typingTimers[name] = setInterval(update, 1000);
  }

  function stopTypingTimer(name) {
    if (D._typingTimers[name]) {
      clearInterval(D._typingTimers[name]);
      delete D._typingTimers[name];
    }
  }

  // P1 fix: stop ALL typing timers (called from ws.onclose / ws.onerror).
  // Without this, a WS disconnect during pending chat leaves timers ticking
  // for 120s and eventually appends a false "model didn't answer" warning
  // to the chat even though the connection is dead.
  function stopAllTypingTimers() {
    if (D._typingTimers) {
      for (const k of Object.keys(D._typingTimers)) {
        clearInterval(D._typingTimers[k]);
        delete D._typingTimers[k];
        // Also remove the typing indicator from the chat so the UI reflects reality
        if (typeof R !== 'undefined' && R.removeLastChat) {
          try { R.removeLastChat(k, 'typing'); } catch {}
        }
      }
    }
  }

  async function doSend(name, input) {
    if (D._sending.has(name)) return;
    const text = (input.value || '').trim();
    if (!text) return;
    D._sending.add(name);
    input.disabled = true;
    input.value = '';
    R.appendChat(name, 'you', text);
    // Show typing indicator with live timer
    R.appendChat(name, 'typing', '…');
    startTypingTimer(name);
    const sid = D.activeSessionMap[name];
    // Try WebSocket first
    let wsOk = false;
    try {
      wsOk = A.wsSend({ type: 'chat', profile: name, message: text, session_id: sid || undefined });
    } catch (e) {
      console.warn('wsSend error', e);
    }
    if (wsOk) {
      // Response will come via WS onmessage → handleWsMessage
      // Keep typing indicator + timer running until WS response arrives
      D._sending.delete(name);
      input.disabled = false;
      return;
    }
    // Fallback to REST
    try {
      const r = await A.postChat(name, text, sid);
      // Remove typing indicator
      R.removeLastChat(name, 'typing');
      stopTypingTimer(name);
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
      R.removeLastChat(name, 'typing');
      stopTypingTimer(name);
      R.appendChat(name, 'bot', '⚠ chat error: ' + e.message);
    } finally {
      D._sending.delete(name);
      input.disabled = false;
      input.focus();
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
  document.addEventListener('click', async (e) => {
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
    } else if (action === 'pick') {
      Modal.showProfileModal();
    } else if (action === 'demote') {
      demoteFromTop(t.dataset.name);
    } else if (action === 'sess-select') {
      e.stopPropagation();
      const name = t.dataset.name;
      const sid = t.dataset.sid;
      D.activeSessionMap[name] = sid;
      // loadSessionMessages now calls renderLog internally for a fresh session
      A.loadSessionMessages(name, sid);
      R.renderSessionPanel(name);
    } else if (action === 'sess-rename') {
      e.stopPropagation();
      const name = t.dataset.name;
      const sid = t.dataset.sid;
      const list = D.sessionsMap[name] || [];
      const s = list.find(x => x.id === sid);
      const current = s ? (s.title || '') : '';
      const next = await window.Dashboard.Modal.prompt('Новое название сессии:', current);
      if (next === null) return;
      doRenameSession(name, sid, next.trim());
    } else if (action === 'sess-delete') {
      e.stopPropagation();
      const name = t.dataset.name;
      const sid = t.dataset.sid;
      const confirmed = await window.Dashboard.Modal.confirm('Удалить сессию?');
      if (!confirmed) return;
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
      A.loadSessionsFor(name);
      A.saveUserRole().then(() => R.renderAll());
    } else if (action === 'remove-leader') {
      e.stopPropagation();
      const name = t.dataset.name;
      const idx = D.leaders.indexOf(name);
      if (idx !== -1) {
        D.leaders[idx] = null;
        A.saveUserRole().then(() => R.renderAll());
      }
    } else if (action === 'add-watched') {
      e.stopPropagation();
      Modal.showWatchedModal();
    } else if (action === 'remove-watched') {
      e.stopPropagation();
      const name = t.dataset.wname;
      const idx = D.watched.indexOf(name);
      if (idx !== -1) {
        D.watched.splice(idx, 1);
        A.saveUserRole().then(() => R.renderAll());
      }
    } else if (action === 'toggle-chat') {
      e.stopPropagation();
      toggleChatCollapse(t.dataset.name);
    } else if (action === 'task-view') {
      e.stopPropagation();
      const board = t.dataset.board;
      const taskId = t.dataset.task;
      if (board && taskId) {
        window.Dashboard.TaskModal.showTaskModal(board, taskId);
      }
    }
  });

  // Header clicks promote/demote — DISABLED: clicking anywhere on .head was too aggressive
  // Use ✕ button (data-action='remove-leader') instead

  // Enter in chat input
  D.els.topGrid.addEventListener('keydown', (e) => {
    if (e.key !== 'Enter') return;
    const inp = e.target.closest('[data-chat-input]');
    if (!inp) return;
    e.preventDefault();
    const name = inp.dataset.chatInput;
    doSend(name, inp);
  });

  // Polling / WebSocket
  // Polling / WebSocket
  let firstTick = true;
  // tick() is kept for manual refresh (R key) and as REST fallback
  async function tick() {
    // If WebSocket is connected, server pushes updates — no need to poll.
    // Manual refresh (R key) still does a REST poll for instant feedback.
    try {
      const map = await A.loadProfiles();
      const oldNames = Object.keys(D.profilesByName).sort().join(',');
      const newNames = Object.keys(map).sort().join(',');
      const oldLeaders = D.leaders.join(',');
      D.profilesByName = map;
      const known = new Set(Object.keys(map));
      D.leaders = D.leaders.map(n => (n && known.has(n)) ? n : null);
      const newLeaders = D.leaders.join(',');

      if (firstTick || oldNames !== newNames || oldLeaders !== newLeaders) {
        firstTick = false;
        const curLeaders = D.leaders.filter(Boolean);
        if (curLeaders.length > 0) {
          await Promise.all(curLeaders.map(n => A.loadSessionsFor(n)));
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

  // Boot — only if auth is configured
  if (C.AUTH) {
    A.loadUserRole().catch(() => {}).then(() => {
      Drag.attachListeners();
      tick().then(() => {
        A.wsConnect();
      });
    });
  }

  // Expose helpers used by other modules
  window.Dashboard.Actions = {
    promoteToTop,
    demoteFromTop,
    toggleChatCollapse,
    doOptimize,
    doSend,
    doRenameSession,
    doDeleteSession,
    stopAllTypingTimers,
  };
})();
