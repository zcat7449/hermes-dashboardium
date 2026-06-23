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
  const WS_RECONNECT_DELAYS = [1000, 2000, 5000, 10000, 30000];

  window.Dashboard = window.Dashboard || {};
  const Config = window.Dashboard.Config = {
    API_BASE,
    WS_URL,
    POLL_MS,
    FETCH_TIMEOUT_MS,
    CHAT_TIMEOUT_MS,
    LEADER_SLOTS,
    WS_RECONNECT_DELAYS,
    AUTH: null,
  };

  // ---- Login overlay ----
  const overlay = document.getElementById('loginOverlay');
  const loginUser = document.getElementById('loginUser');
  const loginPass = document.getElementById('loginPass');
  const loginBtn = document.getElementById('loginBtn');
  const loginError = document.getElementById('loginError');

  function showLogin() {
    overlay.style.display = 'flex';
    loginUser.value = '';
    loginPass.value = '';
    loginError.style.display = 'none';
    loginUser.focus();
  }

  function hideLogin() {
    overlay.style.display = 'none';
  }

  async function tryLogin(user, pass) {
    const b64 = btoa(user + ':' + pass);
    try {
      const r = await fetch(API_BASE + '/api/profiles', {
        headers: { 'Authorization': 'Basic ' + b64 },
      });
      if (r.ok) {
        Config.AUTH = b64;
        sessionStorage.setItem('dashboardium_auth', b64);
        hideLogin();
        return true;
      }
    } catch (e) {
      // network error — retry
    }
    loginError.style.display = 'block';
    return false;
  }

  // Check stored auth first
  const stored = sessionStorage.getItem('dashboardium_auth');
  if (stored) {
    Config.AUTH = stored;
    // Verify it still works
    fetch(API_BASE + '/api/profiles', {
      headers: { 'Authorization': 'Basic ' + stored },
    }).then(r => {
      if (!r.ok) {
        sessionStorage.removeItem('dashboardium_auth');
        Config.AUTH = null;
        showLogin();
      }
    }).catch(() => {
      sessionStorage.removeItem('dashboardium_auth');
      Config.AUTH = null;
      showLogin();
    });
  } else {
    showLogin();
  }

  loginBtn.addEventListener('click', async () => {
    const u = loginUser.value.trim();
    const p = loginPass.value.trim();
    if (!u || !p) return;
    loginBtn.disabled = true;
    loginBtn.textContent = 'Проверка…';
    const ok = await tryLogin(u, p);
    loginBtn.disabled = false;
    loginBtn.textContent = 'Войти';
    if (ok) {
      // Boot the dashboard after successful login
      const A = window.Dashboard.API;
      const Drag = window.Dashboard.DragDrop;
      const R = window.Dashboard.Render;
      try {
        await A.loadUserRole();
        Drag.attachListeners();
        const map = await A.loadProfiles();
        window.Dashboard.Data.profilesByName = map;
        R.renderAll();
        A.wsConnect();
      } catch (e) {
        console.warn('boot after login error', e);
      }
    }
  });

  loginPass.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') loginBtn.click();
  });

  // ---- Language switcher ----
  const langSwitcher = document.getElementById('langSwitcher');
  if (langSwitcher) {
    const I18n = window.Dashboard.I18n;
    langSwitcher.value = I18n.getLang();
    langSwitcher.addEventListener('change', (e) => {
      I18n.setLang(e.target.value);
    });
  }
})();
