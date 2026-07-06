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
      if (!isNaN(v)) {
        started_at_ms = v < 1e12 ? v * 1000 : v;
      } else {
        // Try parsing as ISO date string
        const d = new Date(raw.started_at);
        if (!isNaN(d.getTime())) started_at_ms = d.getTime();
      }
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
      kanban_board: raw.kanban_board || null,
      tasks: raw.tasks || [],
      usage_input: raw.usage_input || 0,
      usage_output: raw.usage_output || 0,
      usage_percent: typeof raw.usage_percent === 'number' ? raw.usage_percent : 0,
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
    if (p.usage_percent === -1) {
      const limit = p.context_limit || 1000000;
      const total = limit >= 1000000 ? (limit / 1000000).toFixed(0) + 'm' : limit >= 1000 ? (limit / 1000).toFixed(0) + 'k' : String(limit);
      return `N/A / ${total} │ ${'░'.repeat(10)} —`;
    }
    const totalTokens = p.usage_input + p.usage_output;
    const limit = p.context_limit || 1000000;
    const pct = typeof p.usage_percent === 'number' ? p.usage_percent : (limit > 0 ? Math.min(100, Math.round(totalTokens / limit * 100)) : 0);
    const used = totalTokens >= 1000000 ? (totalTokens / 1000000).toFixed(1) + 'M' : totalTokens >= 1000 ? (totalTokens / 1000).toFixed(1) + 'K' : String(totalTokens);
    const total = limit >= 1000000 ? (limit / 1000000).toFixed(0) + 'm' : limit >= 1000 ? (limit / 1000).toFixed(0) + 'k' : String(limit);
    const barLen = 10;
    const filled = Math.min(barLen, Math.round(pct / 100 * barLen));
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
