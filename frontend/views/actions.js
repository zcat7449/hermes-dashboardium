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
