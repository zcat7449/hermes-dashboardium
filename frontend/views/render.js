(function () {
  'use strict';

  const C = window.Dashboard.Config;
  const D = window.Dashboard.Data;
  const U = window.Dashboard.Utils;
  const I18n = window.Dashboard.I18n;
  const t = I18n.t;

  function sessionDisplayName(s) {
    if (s && s.title && s.title.trim()) return s.title.trim();
    if (s && s.last_message_at) {
      const d = new Date(s.last_message_at);
      const date = d.toLocaleDateString('ru-RU', { day: '2-digit', month: '2-digit' });
      return t('session_from') + ' ' + date;
    }
    if (s && s.id) {
      const m = String(s.id).match(/^sess_([a-z0-9]+)_/);
      if (m) {
        const ts = parseInt(m[1], 36);
        if (isFinite(ts)) {
          const d = new Date(ts);
          const date = d.toLocaleDateString('ru-RU', { day: '2-digit', month: '2-digit' });
          return t('session_from') + ' ' + date;
        }
      }
      const m2 = String(s.id).match(/^(\d{4})(\d{2})(\d{2})_(\d{2})(\d{2})(\d{2})_/);
      if (m2) {
        const d = new Date(+m2[1], +m2[2] - 1, +m2[3], +m2[4], +m2[5], +m2[6]);
        const date = d.toLocaleDateString('ru-RU', { day: '2-digit', month: '2-digit' });
        return t('session_from') + ' ' + date;
      }
    }
    return t('session_label');
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
        <button type="button" data-action="sess-rename" data-name="${U.esc(name)}" data-sid="${U.esc(s.id)}" title="${t('rename')}">✎</button>
        <button type="button" class="sess-delete" data-action="sess-delete" data-name="${U.esc(name)}" data-sid="${U.esc(s.id)}" title="${t('delete')}">✕</button>
      </div>`;
    }).join('');
    return `<div class="session-list" data-session-list="${U.esc(name)}">${items}</div>
      <button class="sess-new" data-action="sess-new" data-name="${U.esc(name)}">${t('new_session')}</button>`;
  }

  function renderCardBody(p) {
    const status = p.task_status || 'idle';
    const isRunning = status === 'running';
    const isBlocked = status === 'blocked';
    const dotClass = isRunning ? 'running' : (isBlocked ? 'blocked' : 'idle');
    const model = p.model || t('no_data');
    const task = (p.task_id || p.task_title) ? `
      <div class="task">
        <div class="task-id">
          <span class="task-id-text">${U.esc(p.task_id || t('no_data'))}</span>
          <button type="button" class="task-view-btn" data-action="task-view" data-board="${U.esc(p.kanban_board || '')}" data-task="${U.esc(p.task_id || '')}" title="${t('task_view')}">🔍</button>
        </div>
        <div class="task-title">${U.esc(p.task_title || '')}</div>
      </div>` : `
      <div class="task idle-task">${t('no_active_task')}</div>`;
    const uptimeSec = U.getEffectiveUptime(p);
    const timerCls = isRunning || isBlocked ? '' : 'idle-timer';
    const timer = `<div class="timer ${timerCls}" data-started="${p.started_at_ms || 0}" data-base="${isRunning || isBlocked ? Math.floor(uptimeSec) : 0}">${U.fmtUptime(uptimeSec)}</div>`;
    const tasks = p.tasks || [];
    const activeTaskId = p.task_id;
    const queueHtml = tasks.length > 1
      ? `<div class="task-queue">${tasks.map(task => `
        <div class="task-queue-item${task.id === activeTaskId ? ' active' : ''}" title="[${U.esc(task.board || '?')}] ${U.esc(task.title || '')}">
          <span class="tq-board">${U.esc((task.board || '?').substring(0, 10))}</span>
          <span class="tq-id">${U.esc(task.id)}</span>
          <button type="button" class="task-view-btn tq-view" data-action="task-view" data-board="${U.esc(task.board || '')}" data-task="${U.esc(task.id)}" title="${t('task_view')}">🔍</button>
          <span class="tq-status ${U.esc(task.status)}"></span>
        </div>`).join('')}</div>`
      : '';
    const usageStr = U.fmtUsageStr(p);
    const modelLine = model ? `${model} │ ${usageStr}` : usageStr;
    return `
      <div class="head">
        <span class="drag-handle" data-action="drag-handle" title="${t('drag_handle')}">⠿</span>
        <div class="name">${U.esc(p.name)}</div>
        <div class="status-dot ${dotClass}" title="${U.esc(status)}"></div>
        <div class="head-spacer"></div>
        <button type="button" class="collapse-chat-btn" data-action="toggle-chat" data-name="${U.esc(p.name)}" title="${t('collapse_chat')}">▾</button>
        <button type="button" class="remove-leader-btn" data-action="remove-leader" data-name="${U.esc(p.name)}" title="${t('remove_leader')}">✕</button>
      </div>
      <div class="model">${U.esc(modelLine)}</div>
      ${task}
      ${timer}
      ${queueHtml}
      <div class="actions">
        <button class="btn optimize" data-action="optimize" data-name="${U.esc(p.name)}" ${D.optimizing.has(p.name) ? 'disabled' : ''}>
          ${D.optimizing.has(p.name) ? t('optimizing') : t('optimize')}
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
            <div class="model">${t('profile_no_data')}</div>
            <div class="task idle-task">${t('profile_unreachable')}</div>
            <div class="timer idle-timer">00м 00с</div>
            <div class="actions">
              <button class="btn optimize" disabled>${t('optimize')}</button>
            </div>
          </div>
        `);
        return;
      }
      const log = D.chatLog[name] || [];
      const logHtml = log.length === 0
        ? '<div class="empty">' + t('dialog_empty') + '</div>'
        : log.slice(-20).map(m => `<div class="msg-${m.role}">${m.role === 'you' ? t('msg_you') : t('msg_bot')} ${U.esc(m.text)}</div>`).join('');
      const sessionList = renderSessionList(name);
      const activeSid = D.activeSessionMap[name];
      const activeLabel = activeSid
        ? sessionDisplayName((D.sessionsMap[name] || []).find(x => x.id === activeSid) || { id: activeSid })
        : t('new_session_label');
      const isCollapsed = D.chatCollapsed[name];
      frag.push(`
        <div class="card" data-name="${U.esc(name)}" data-slot="${idx}">
          ${renderCardBody(p)}
          <div class="chat"${isCollapsed ? ' style="display:none"' : ''}>
            <div style="font-size:9px; color: rgba(224,224,224,0.4); margin-bottom:2px; letter-spacing:0.5px; text-transform:uppercase;">${t('sessions')}</div>
            ${sessionList}
            <div style="font-size:9px; color: rgba(224,224,224,0.4); margin: 4px 0 2px; letter-spacing:0.5px; text-transform:uppercase;">${t('chat')} · ${U.esc(activeLabel)}</div>
            <div class="log" data-chat-log="${U.esc(name)}">${logHtml}</div>
            <div class="row">
              <input type="text" data-chat-input="${U.esc(name)}" placeholder="${activeSid ? t('message_placeholder') : t('message_placeholder_new')}" autocomplete="off">
              <button data-action="send" data-name="${U.esc(name)}">${t('send')}</button>
            </div>
          </div>
        </div>
      `);
    });
    const gridCols = filled === 0 ? 1 : filled;
    if (filled === 0) {
      D.els.topGrid.style.gridTemplateRows = '1fr';
      frag.push(`<div class="card empty-slot" style="grid-column: 1 / -1; grid-row: 1 / -1; height: 100%;"><button class="assign-btn" data-action="pick">${t('assign_btn')}</button></div>`);
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
      ? t('filter_meta') + ': ' + list.length + '/' + (allNames.length - leaderSet.size)
      : '';
    if (list.length === 0) {
      D.els.bottomGrid.innerHTML = `<div class="card" style="grid-column: 1/-1; cursor: default; min-height: 80px; align-items: center; justify-content: center; color: rgba(224,224,224,0.4);">
        ${D.filterText ? t('no_profiles_filter') : t('no_profiles_outside')}
      </div>`;
      return;
    }
    D.els.bottomGrid.innerHTML = list.map(name => {
      const p = D.profilesByName[name];
      return `<div class="card" data-name="${U.esc(name)}">
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
      D.els.addLeaderDropdown.innerHTML = '<div class="dd-empty">' + t('all_assigned') + '</div>';
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
      div.textContent = (role === 'you' ? t('msg_you') + ' ' : role === 'typing' ? '' : t('msg_bot') + ' ') + text;
      logEl.appendChild(div);
      logEl.scrollTop = logEl.scrollHeight;
    }
  }

  function removeLastChat(name, role) {
    const log = D.chatLog[name];
    if (!log) return;
    for (let i = log.length - 1; i >= 0; i--) {
      if (log[i].role === role) {
        log.splice(i, 1);
        break;
      }
    }
    const logEl = D.els.topGrid.querySelector(`[data-chat-log="${CSS.escape(name)}"]`);
    if (logEl) {
      const msgs = logEl.querySelectorAll('.msg-' + role);
      if (msgs.length > 0) msgs[msgs.length - 1].remove();
    }
  }

  function renderLog(name) {
    const log = D.chatLog[name] || [];
    const logEl = D.els.topGrid.querySelector(`[data-chat-log="${CSS.escape(name)}"]`);
    if (logEl) {
      logEl.innerHTML = log.length === 0
        ? '<div class="empty">' + t('dialog_empty') + '</div>'
        : log.map(m => `<div class="msg-${m.role}">${m.role === 'you' ? t('msg_you') : t('msg_bot')} ${U.esc(m.text)}</div>`).join('');
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
        const taskId = taskEl.querySelector('.task-id-text');
        const taskTitle = taskEl.querySelector('.task-title');
        if (taskId && p.task_id) taskId.textContent = p.task_id;
        if (taskTitle && p.task_title) taskTitle.textContent = p.task_title;
        if (p.task_id || p.task_title) {
          taskEl.classList.remove('idle-task');
          if (taskId) taskId.style.display = '';
          if (taskTitle) taskTitle.style.display = '';
        } else {
          taskEl.classList.add('idle-task');
          if (taskId) taskId.textContent = t('no_data');
          if (taskTitle) taskTitle.textContent = t('no_active_task');
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
