(function () {
  'use strict';

  const D = window.Dashboard.Data;
  const A = window.Dashboard.API;
  const R = window.Dashboard.Render;

  function handleDragStart(e) {
    // Only allow drag from the drag-handle element, not from anywhere on the card
    const handle = e.target.closest('.drag-handle');
    if (!handle) return;
    const card = handle.closest('.card[data-name][data-slot]');
    if (!card) return;
    const name = card.dataset.name;
    const slot = Number(card.dataset.slot);
    D.dragSource = { name, slot };
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', name);
    card.classList.add('dragging');
  }

  function handleDragOver(e) {
    const card = e.target.closest('.card[data-name][data-slot]');
    if (!card) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    const slot = Number(card.dataset.slot);
    if (D.dragOverSlot !== null && D.dragOverSlot !== slot) {
      const prev = D.els.topGrid.querySelector(`.card[data-slot="${D.dragOverSlot}"]`);
      if (prev) prev.classList.remove('drag-over');
    }
    D.dragOverSlot = slot;
    card.classList.add('drag-over');
  }

  function handleDragEnd(e) {
    const card = e.target.closest('.card[data-name][data-slot]');
    if (card) card.classList.remove('dragging');
    if (D.dragOverSlot !== null) {
      const prev = D.els.topGrid.querySelector(`.card[data-slot="${D.dragOverSlot}"]`);
      if (prev) prev.classList.remove('drag-over');
    }
    D.dragSource = null;
    D.dragOverSlot = null;
  }

  function handleDrop(e) {
    const targetCard = e.target.closest('.card[data-name][data-slot]');
    if (!targetCard || !D.dragSource) return;
    e.preventDefault();
    const targetSlot = Number(targetCard.dataset.slot);
    const fromSlot = D.dragSource.slot;
    if (fromSlot === targetSlot) return;

    const fromName = D.leaders[fromSlot];
    const toName = D.leaders[targetSlot];
    D.leaders[fromSlot] = toName;
    D.leaders[targetSlot] = fromName;

    targetCard.classList.remove('drag-over');
    const fromCard = D.els.topGrid.querySelector(`.card[data-slot="${fromSlot}"]`);
    if (fromCard) fromCard.classList.remove('dragging');

    D.dragSource = null;
    D.dragOverSlot = null;
    A.saveUserRole().then(() => R.renderAll());
  }

  function attachListeners() {
    D.els.topGrid.addEventListener('dragstart', handleDragStart);
    D.els.topGrid.addEventListener('dragover', handleDragOver);
    D.els.topGrid.addEventListener('dragend', handleDragEnd);
    D.els.topGrid.addEventListener('drop', handleDrop);

    // Touch DnD for mobile
    let touchDragCard = null;
    let touchClone = null;
    let touchStartX = 0, touchStartY = 0;
    let touchMoved = false;

    D.els.topGrid.addEventListener('touchstart', (e) => {
      const handle = e.target.closest('.drag-handle');
      if (!handle) return;
      const card = handle.closest('.card[data-name][data-slot]');
      if (!card) return;
      const touch = e.touches[0];
      touchStartX = touch.clientX;
      touchStartY = touch.clientY;
      touchMoved = false;
      touchDragCard = card;
      D.dragSource = { name: card.dataset.name, slot: Number(card.dataset.slot) };
      card.classList.add('dragging');
    }, { passive: false });

    D.els.topGrid.addEventListener('touchmove', (e) => {
      if (!touchDragCard) return;
      const touch = e.touches[0];
      const dx = touch.clientX - touchStartX;
      const dy = touch.clientY - touchStartY;
      if (!touchMoved && Math.abs(dx) < 5 && Math.abs(dy) < 5) return;
      touchMoved = true;
      e.preventDefault();
      if (!touchClone) {
        touchClone = touchDragCard.cloneNode(true);
        touchClone.style.position = 'fixed';
        touchClone.style.zIndex = '9999';
        touchClone.style.opacity = '0.85';
        touchClone.style.pointerEvents = 'none';
        touchClone.style.width = touchDragCard.offsetWidth + 'px';
        document.body.appendChild(touchClone);
      }
      touchClone.style.left = (touch.clientX - touchDragCard.offsetWidth / 2) + 'px';
      touchClone.style.top = (touch.clientY - touchDragCard.offsetHeight / 2) + 'px';
      const target = document.elementFromPoint(touch.clientX, touch.clientY);
      if (target) {
        const targetCard = target.closest('.card[data-name][data-slot]');
        if (D.dragOverSlot !== null) {
          const prev = D.els.topGrid.querySelector(`.card[data-slot="${D.dragOverSlot}"]`);
          if (prev) prev.classList.remove('drag-over');
        }
        if (targetCard && targetCard !== touchDragCard) {
          D.dragOverSlot = Number(targetCard.dataset.slot);
          targetCard.classList.add('drag-over');
        } else {
          D.dragOverSlot = null;
        }
      }
    }, { passive: false });

    D.els.topGrid.addEventListener('touchend', () => {
      if (touchDragCard) touchDragCard.classList.remove('dragging');
      if (touchClone) { touchClone.remove(); touchClone = null; }
      if (D.dragOverSlot !== null) {
        const prev = D.els.topGrid.querySelector(`.card[data-slot="${D.dragOverSlot}"]`);
        if (prev) prev.classList.remove('drag-over');
        if (D.dragSource && D.dragSource.slot !== D.dragOverSlot) {
          const fromSlot = D.dragSource.slot;
          const targetSlot = D.dragOverSlot;
          const fromName = D.leaders[fromSlot];
          const toName = D.leaders[targetSlot];
          D.leaders[fromSlot] = toName;
          D.leaders[targetSlot] = fromName;
          A.saveUserRole().then(() => R.renderAll());
        }
      }
      D.dragSource = null;
      D.dragOverSlot = null;
      touchDragCard = null;
      touchMoved = false;
    });
  }

  window.Dashboard.DragDrop = { attachListeners };
})();
