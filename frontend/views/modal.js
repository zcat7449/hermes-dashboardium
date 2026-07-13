(function () {
  'use strict';

  const C = window.Dashboard.Config;
  const D = window.Dashboard.Data;
  const U = window.Dashboard.Utils;
  const A = window.Dashboard.API;
  const R = window.Dashboard.Render;

  function renderProfileModal() {
    if (!D.profileModalOpen) return;
    const allNames = Object.keys(D.profilesByName).sort();
    const leaderSet = new Set(D.leaders.filter(Boolean));
    const watchedSet = new Set(D.watched);
    const isWatched = D.profileModalTarget === 'watched';
    const candidates = isWatched
      ? allNames.filter(n => !leaderSet.has(n) && !watchedSet.has(n))
      : allNames.filter(n => !leaderSet.has(n));
    const filtered = D.profileModalFilter
      ? candidates.filter(n => n.toLowerCase().includes(D.profileModalFilter.toLowerCase()))
      : candidates;

    const remaining = isWatched
      ? D.MAX_WATCHED - D.watched.length
      : C.LEADER_SLOTS - D.leaders.filter(Boolean).length;
    const selectedCount = D.profileModalSelected.length;

    const title = isWatched ? 'Добавить профили для наблюдения' : 'Выберите профили';

    const listHtml = filtered.length === 0
      ? '<div class="profile-modal-empty">' + (D.profileModalFilter ? 'ничего не найдено' : 'все профили уже добавлены') + '</div>'
      : filtered.map(n => {
          const p = D.profilesByName[n] || {};
          const status = p.task_status || 'idle';
          const model = p.model || '';
          const isSelected = D.profileModalSelected.includes(n);
          return `<div class="profile-modal-item ${isSelected ? 'selected' : ''}" data-action="pm-toggle" data-pm-name="${U.esc(n)}">
            <span class="pm-check">${isSelected ? '✓' : ''}</span>
            <span class="pm-dot ${U.esc(status)}"></span>
            <span class="pm-name">${U.esc(n)}</span>
            ${model ? `<span class="pm-model">${U.esc(model)}</span>` : ''}
          </div>`;
        }).join('');

    const old = document.querySelector('.profile-modal-overlay');
    if (old) old.remove();

    const overlay = document.createElement('div');
    overlay.className = 'profile-modal-overlay';
    overlay.innerHTML = `<div class="profile-modal">
      <div class="profile-modal-header">
        <h3>${title} · <span class="pm-counter">${selectedCount}/${remaining}</span></h3>
        <div class="profile-modal-header-btns">
          <button class="profile-modal-close-btn" data-action="pm-close-text">Закрыть</button>
          <button class="profile-modal-close" data-action="pm-close">&times;</button>
        </div>
      </div>
      <div class="profile-modal-search">
        <input type="text" id="pmSearchInput" placeholder="Поиск профиля…" autocomplete="off">
      </div>
      <div class="profile-modal-list">${listHtml}</div>
    </div>`;

    document.body.appendChild(overlay);

    const searchInput = document.getElementById('pmSearchInput');
    if (searchInput) {
      searchInput.focus();
      searchInput.addEventListener('input', (e) => {
        D.profileModalFilter = e.target.value;
        renderProfileModal();
      });
    }

    overlay.addEventListener('click', (e) => {
      if (e.target === overlay) {
        closeProfileModal();
        return;
      }
      const t = e.target.dataset.action ? e.target : e.target.closest('[data-action]');
      if (!t) return;
      const action = t.dataset.action;
      if (action === 'pm-close-text' || action === 'pm-close') {
        closeProfileModal();
      } else if (action === 'pm-toggle') {
        const name = t.dataset.pmName;
        if (!name) return;
        const idx = D.profileModalSelected.indexOf(name);
        if (idx >= 0) {
          D.profileModalSelected.splice(idx, 1);
          renderProfileModal();
        } else {
          if (D.profileModalSelected.length >= remaining) return;
          D.profileModalSelected.push(name);
          if (D.profileModalSelected.length >= remaining) {
            closeProfileModal();
          } else {
            renderProfileModal();
          }
        }
      }
    });
  }

  function showProfileModal() {
    // Don't open if task modal is visible
    if (document.querySelector('.task-modal-overlay')) return;
    D.profileModalOpen = true;
    D.profileModalFilter = '';
    D.profileModalSelected = [];
    D.profileModalTarget = 'leaders'; // 'leaders' or 'watched'
    renderProfileModal();
  }

  function showWatchedModal() {
    // Don't open if task modal is visible
    if (document.querySelector('.task-modal-overlay')) return;
    D.profileModalOpen = true;
    D.profileModalFilter = '';
    D.profileModalSelected = [];
    D.profileModalTarget = 'watched';
    renderProfileModal();
  }

  function closeProfileModal() {
    if (D.profileModalSelected.length > 0) {
      if (D.profileModalTarget === 'watched') {
        for (const name of D.profileModalSelected) {
          if (D.watched.length < D.MAX_WATCHED && !D.watched.includes(name)) {
            D.watched.push(name);
          }
        }
      } else {
        let selIdx = 0;
        for (let i = 0; i < C.LEADER_SLOTS && selIdx < D.profileModalSelected.length; i++) {
          if (D.leaders[i] === null) {
            D.leaders[i] = D.profileModalSelected[selIdx];
            A.loadSessionsFor(D.profileModalSelected[selIdx]);
            selIdx++;
          }
        }
      }
      A.saveUserRole().then(() => R.renderAll());
    }
    D.profileModalOpen = false;
    D.profileModalFilter = '';
    D.profileModalSelected = [];
    const overlay = document.querySelector('.profile-modal-overlay');
    if (overlay) overlay.remove();
  }

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && D.profileModalOpen) {
      closeProfileModal();
    }
  });

  window.Dashboard.Modal = {
    showProfileModal,
    showWatchedModal,
    closeProfileModal,
    renderProfileModal,
    confirm: function(msg) {
      // Don't stack multiple overlays
      if (document.querySelector('.profile-modal-overlay')) return Promise.resolve(false);
      return new Promise((resolve) => {
        const overlay = document.createElement('div');
        overlay.className = 'profile-modal-overlay';
        overlay.innerHTML = `<div class="profile-modal" style="max-width:400px;text-align:center;">
          <div class="profile-modal-header">
            <h3>${U.esc(msg)}</h3>
          </div>
          <div style="padding:16px;display:flex;gap:12px;justify-content:center;">
            <button class="profile-modal-close-btn" data-action="confirm-yes" style="background:var(--green);color:var(--bg);font-weight:600;">Да</button>
            <button class="profile-modal-close-btn" data-action="confirm-no">Нет</button>
          </div>
        </div>`;
        document.body.appendChild(overlay);
        overlay.addEventListener('click', (e) => {
          const t = e.target.dataset.action ? e.target : e.target.closest('[data-action]');
          if (!t) return;
          if (t.dataset.action === 'confirm-yes') {
            overlay.remove();
            resolve(true);
          } else if (t.dataset.action === 'confirm-no') {
            overlay.remove();
            resolve(false);
          }
        });
      });
    },
    prompt: function(msg, defaultValue) {
      // Don't stack multiple overlays
      if (document.querySelector('.profile-modal-overlay')) return Promise.resolve(null);
      return new Promise((resolve) => {
        const overlay = document.createElement('div');
        overlay.className = 'profile-modal-overlay';
        overlay.innerHTML = `<div class="profile-modal" style="max-width:400px;">
          <div class="profile-modal-header">
            <h3>${U.esc(msg)}</h3>
          </div>
          <div style="padding:16px;">
            <input type="text" id="pmPromptInput" value="${U.esc(defaultValue || '')}" style="width:100%;padding:10px;border:1px solid var(--border);border-radius:6px;background:var(--bg);color:var(--text);font-size:14px;box-sizing:border-box;margin-bottom:12px;">
            <div style="display:flex;gap:12px;justify-content:flex-end;">
              <button class="profile-modal-close-btn" data-action="prompt-ok" style="background:var(--green);color:var(--bg);font-weight:600;">OK</button>
              <button class="profile-modal-close-btn" data-action="prompt-cancel">Отмена</button>
            </div>
          </div>
        </div>`;
        document.body.appendChild(overlay);
        const input = document.getElementById('pmPromptInput');
        if (input) {
          input.focus();
          input.select();
          input.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') {
              overlay.remove();
              resolve(input.value);
            }
            if (e.key === 'Escape') {
              overlay.remove();
              resolve(null);
            }
          });
        }
        overlay.addEventListener('click', (e) => {
          const t = e.target.dataset.action ? e.target : e.target.closest('[data-action]');
          if (!t) return;
          if (t.dataset.action === 'prompt-ok') {
            overlay.remove();
            resolve(input ? input.value : '');
          } else if (t.dataset.action === 'prompt-cancel') {
            overlay.remove();
            resolve(null);
          }
        });
      });
    },
  };
})();
