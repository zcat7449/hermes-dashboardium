(function () {
  'use strict';

  // ---- Config ----
  const API_BASE = (new URLSearchParams(location.search).get('api')) || '';
  const WS_URL = (() => {
    const u = new URL(API_BASE || location.origin);
    u.protocol = u.protocol === 'https:' ? 'wss:' : 'ws:';
    u.pathname = '/ws';
    return u.toString();
  })();
  const POLL_MS = 5000;
  const FETCH_TIMEOUT_MS = 15000;
  const CHAT_TIMEOUT_MS = 120000;
  const LEADER_SLOTS = 4;
  const WS_RECONNECT_DELAYS = [1000, 2000, 5000, 10000, 30000]; // backoff for WS reconnect

  window.Dashboard = window.Dashboard || {};
  const Config = window.Dashboard.Config = {
    API_BASE,
    WS_URL,
    POLL_MS,
    FETCH_TIMEOUT_MS,
    CHAT_TIMEOUT_MS,
    LEADER_SLOTS,
    WS_RECONNECT_DELAYS,
  };

  // Auth: prompt once, store in sessionStorage
  const stored = sessionStorage.getItem('dashboardium_auth');
  if (stored) {
    Config.AUTH = stored;
  } else {
    // First visit — prompt for credentials
    const u = window.prompt('Логин:');
    if (u) {
      const p = window.prompt('Пароль:');
      if (p) {
        const b64 = btoa(u + ':' + p);
        Config.AUTH = b64;
        sessionStorage.setItem('dashboardium_auth', b64);
      }
    }
  }
})();
