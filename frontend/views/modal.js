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
    const candidates = allNames.filter(n => !leaderSet.has(n));
    const filtered = D.profileModalFilter
      ? candidates.filter(n => n.toLowerCase().includes(D.profileModalFilter.toLowerCase()))
      : candidates;

    const remaining = C.LEADER_SLOTS - D.leaders.filter(Boolean).length;
    const selectedCount = D.profileModalSelected.length;

    const listHtml = filtered.length === 0
      ? '<div class="profile-modal-empty">' + (D.profileModalFilter ? 'ничего не найдено' : 'все профили уже назначены') + '</div>'
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
        <h3>Выберите профили · <span class="pm-counter">${selectedCount}/${remaining}</span></h3>
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
    D.profileModalOpen = true;
    D.profileModalFilter = '';
    D.profileModalSelected = [];
    renderProfileModal();
  }

  function closeProfileModal() {
    if (D.profileModalSelected.length > 0) {
      let selIdx = 0;
      for (let i = 0; i < C.LEADER_SLOTS && selIdx < D.profileModalSelected.length; i++) {
        if (D.leaders[i] === null) {
          D.leaders[i] = D.profileModalSelected[selIdx];
          A.loadSessionsFor(D.profileModalSelected[selIdx]);
          selIdx++;
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
    closeProfileModal,
    renderProfileModal,
  };
})();
