(function () {
  'use strict';

  const C = window.Dashboard.Config;
  const D = window.Dashboard.Data;
  const A = window.Dashboard.API;
  const U = window.Dashboard.Utils;
  const t = window.Dashboard.I18n.t;

  let currentTask = null;

  function esc(s) {
    if (s == null) return '';
    return String(s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/\"/g, '&quot;').replace(/'/g, '&#39;');
  }

  function fmtDate(ts) {
    if (!ts) return t('no_data');
    const d = new Date(ts);
    return d.toLocaleString('ru-RU', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });
  }

  function renderTaskModal(data) {
    const old = document.querySelector('.task-modal-overlay');
    if (old) old.remove();

    const task = data.task;
    const events = data.events || [];
    const comments = data.comments || [];
    const runs = data.runs || [];

    const statusClass = task.status === 'blocked' ? 'blocked' : (task.status === 'running' ? 'running' : 'idle');

    const eventsHtml = events.length === 0
      ? '<div class="tm-empty">' + t('no_events') + '</div>'
      : events.map(e => `<div class="tm-event">
          <span class="tm-event-kind">${esc(e.kind)}</span>
          <span class="tm-event-time">${fmtDate(e.created_at)}</span>
          ${e.payload ? `<span class="tm-event-payload">${esc(JSON.stringify(e.payload))}</span>` : ''}
        </div>`).join('');

    const commentsHtml = comments.length === 0
      ? '<div class="tm-empty">' + t('no_comments') + '</div>'
      : comments.map(c => `<div class="tm-comment">
          <div class="tm-comment-header">
            <span class="tm-comment-author">${esc(c.author || t('no_data'))}</span>
            <span class="tm-comment-time">${fmtDate(c.created_at)}</span>
          </div>
          <div class="tm-comment-body">${esc(c.body || '')}</div>
        </div>`).join('');

    const runsHtml = runs.length === 0
      ? '<div class="tm-empty">' + t('no_runs') + '</div>'
      : runs.map(r => `<div class="tm-run">
          <span class="tm-run-status ${esc(r.status)}">${esc(r.status)}</span>
          <span class="tm-run-profile">${esc(r.profile || t('no_data'))}</span>
          <span class="tm-run-time">${fmtDate(r.started_at)}</span>
          ${r.summary ? `<div class="tm-run-summary">${esc(r.summary)}</div>` : ''}
          ${r.error ? `<div class="tm-run-error">${esc(r.error)}</div>` : ''}
        </div>`).join('');

    const overlay = document.createElement('div');
    overlay.className = 'task-modal-overlay';
    overlay.innerHTML = `<div class="task-modal">
      <div class="task-modal-header">
        <div class="tm-header-left">
          <span class="tm-status ${statusClass}">${esc(task.status)}</span>
          <span class="tm-id">${esc(task.id)}</span>
          <span class="tm-board">${esc(task.board)}</span>
          <span class="tm-priority">P${task.priority != null ? task.priority : '?'}</span>
        </div>
        <div class="tm-header-right">
          <button class="tm-btn tm-btn-block" data-action="tm-block" title="${t('block')}">${t('block')}</button>
          <button class="tm-btn tm-btn-unblock" data-action="tm-unblock" title="${t('unblock')}">${t('unblock')}</button>
          <button class="tm-btn tm-btn-archive" data-action="tm-archive" title="${t('archive')}">${t('archive')}</button>
          <button class="tm-close" data-action="tm-close">&times;</button>
        </div>
      </div>
      <div class="tm-title">${esc(task.title)}</div>
      <div class="tm-body">${esc(task.body || t('no_data'))}</div>
      <div class="tm-meta">
        <span>${t('assignee_label')}: <strong>${esc(task.assignee || t('no_data'))}</strong></span>
        <span>${t('created_label')}: ${fmtDate(task.created_at)}</span>
        ${task.started_at ? `<span>${t('started_label')}: ${fmtDate(task.started_at)}</span>` : ''}
        ${task.completed_at ? `<span>${t('completed_label')}: ${fmtDate(task.completed_at)}</span>` : ''}
      </div>
      <div class="tm-section">
        <h4>${t('task_events')} (${events.length})</h4>
        <div class="tm-events">${eventsHtml}</div>
      </div>
      <div class="tm-section">
        <h4>${t('task_runs')} (${runs.length})</h4>
        <div class="tm-runs">${runsHtml}</div>
      </div>
      <div class="tm-section">
        <h4>${t('task_comments')} (${comments.length})</h4>
        <div class="tm-comments">${commentsHtml}</div>
      </div>
    </div>`;

    document.body.appendChild(overlay);

    overlay.addEventListener('click', (e) => {
      if (e.target === overlay) {
        closeTaskModal();
        return;
      }
      const tgt = e.target.dataset.action ? e.target : e.target.closest('[data-action]');
      if (!tgt) return;
      const action = tgt.dataset.action;
      if (action === 'tm-close') {
        closeTaskModal();
      } else if (action === 'tm-block') {
        const reason = window.prompt(t('block_reason'), 'Blocked from Dashboardium');
        if (reason === null) return;
        doBlockTask(reason.trim() || 'Blocked from Dashboardium');
      } else if (action === 'tm-unblock') {
        const reason = window.prompt(t('unblock_reason'), 'Unblocked from Dashboardium');
        if (reason === null) return;
        doUnblockTask(reason.trim() || 'Unblocked from Dashboardium');
      } else if (action === 'tm-archive') {
        if (!window.confirm(t('archive_confirm') + ' ' + currentTask.taskId + '?')) return;
        doArchiveTask();
      }
    });
  }

  async function showTaskModal(board, taskId) {
    if (!board || !taskId) return;
    currentTask = { board, taskId };
    try {
      const data = await A.fetchTaskDetails(board, taskId);
      renderTaskModal(data);
    } catch (e) {
      console.warn('task modal error', e);
      const overlay = document.createElement('div');
      overlay.className = 'task-modal-overlay';
      overlay.innerHTML = `<div class="task-modal">
        <div class="task-modal-header">
          <span class="tm-id">${esc(taskId)}</span>
          <button class="tm-close" data-action="tm-close">&times;</button>
        </div>
        <div class="tm-body" style="color:var(--red);">${t('task_load_error')}: ${esc(e.message)}</div>
      </div>`;
      document.body.appendChild(overlay);
      overlay.addEventListener('click', (e) => {
        if (e.target === overlay || (e.target.dataset && e.target.dataset.action === 'tm-close')) {
          closeTaskModal();
        }
      });
    }
  }

  function closeTaskModal() {
    currentTask = null;
    const overlay = document.querySelector('.task-modal-overlay');
    if (overlay) overlay.remove();
  }

  async function doBlockTask(reason) {
    if (!currentTask) return;
    try {
      await A.blockTask(currentTask.board, currentTask.taskId, reason);
      closeTaskModal();
    } catch (e) {
      alert(t('block_error') + ': ' + e.message);
    }
  }

  async function doUnblockTask(reason) {
    if (!currentTask) return;
    try {
      await A.unblockTask(currentTask.board, currentTask.taskId, reason);
      closeTaskModal();
    } catch (e) {
      alert(t('unblock_error') + ': ' + e.message);
    }
  }

  async function doArchiveTask() {
    if (!currentTask) return;
    try {
      await A.archiveTask(currentTask.board, currentTask.taskId);
      closeTaskModal();
    } catch (e) {
      alert(t('archive_error') + ': ' + e.message);
    }
  }

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      const overlay = document.querySelector('.task-modal-overlay');
      if (overlay) closeTaskModal();
    }
  });

  window.Dashboard.TaskModal = {
    showTaskModal,
    closeTaskModal,
  };
})();
