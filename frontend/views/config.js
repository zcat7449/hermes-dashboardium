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
  // SERVER_VERSION is injected by the server as a meta tag in index.html (X-Server-Version)
  const SERVER_VERSION_META = document.querySelector('meta[name="server-version"]');
  const SERVER_VERSION = (SERVER_VERSION_META && SERVER_VERSION_META.getAttribute('content')) || null;

  window.Dashboard = window.Dashboard || {};
  const Config = window.Dashboard.Config = {
    API_BASE,
    WS_URL,
    POLL_MS,
    FETCH_TIMEOUT_MS,
    CHAT_TIMEOUT_MS,
    LEADER_SLOTS,
    WS_RECONNECT_DELAYS,
    SERVER_VERSION,
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

  // Check stored auth first — trust it, no async verification
  const stored = sessionStorage.getItem('dashboardium_auth');
  if (stored) {
    Config.AUTH = stored;
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
      // Boot directly — no reload (sessionStorage race)
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
        // Fallback: reload
        location.reload();
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

  // ---- Scroll-to-top button ----
  const scrollTopBtn = document.getElementById('scrollTopBtn');
  if (scrollTopBtn) {
    window.addEventListener('scroll', () => {
      scrollTopBtn.style.display = window.scrollY > 300 ? 'block' : 'none';
    });
    scrollTopBtn.addEventListener('click', () => {
      window.scrollTo({ top: 0, behavior: 'smooth' });
    });
  }

  // ---- Escape key closes modals ----
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      const profileModal = document.querySelector('.profile-modal-overlay');
      const taskModal = document.querySelector('.task-modal-overlay');
      if (profileModal) {
        profileModal.remove();
        window.Dashboard.Data.profileModalOpen = false;
      }
      if (taskModal) {
        // P1 fix: route through closeTaskModal() so currentTask is reset
        // and any pending confirm()/prompt() in task-modal handler is resolved.
        if (window.Dashboard && window.Dashboard.TaskModal && window.Dashboard.TaskModal.closeTaskModal) {
          try { window.Dashboard.TaskModal.closeTaskModal(); } catch { taskModal.remove(); }
        } else {
          taskModal.remove();
        }
      }
    }
  });

  // ---- Auto-reload on deploy ----
  // Poll /api/version every 30s. When the version changes, reload the page automatically.
  // This makes deploys transparent — the user never has to refresh manually.
  (function autoReloadOnDeploy() {
    const initial = window.Dashboard.Config.SERVER_VERSION || null;
    let lastVersion = sessionStorage.getItem('dashboardium_version') || initial;
    if (initial) sessionStorage.setItem('dashboardium_version', initial);
    async function checkVersion() {
      try {
        const r = await fetch('/api/version', { cache: 'no-store', credentials: 'omit' });
        if (!r.ok) return;
        const data = await r.json();
        if (lastVersion && data.version && data.version !== lastVersion) {
          // Deploy detected — reload to pick up new code
          console.log('[auto-reload] new version detected:', data.version, '(was:', lastVersion + ')');
          sessionStorage.setItem('dashboardium_version', data.version);
          location.reload();
        } else if (data.version) {
          lastVersion = data.version;
          sessionStorage.setItem('dashboardium_version', data.version);
        }
      } catch {}
    }
    // First check after 5s, then every 30s
    setTimeout(() => {
      checkVersion();
      setInterval(checkVersion, 30000);
    }, 5000);
  })();
})();
