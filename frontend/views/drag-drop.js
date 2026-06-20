(function () {
  'use strict';

  const D = window.Dashboard.Data;
  const A = window.Dashboard.API;
  const R = window.Dashboard.Render;

  function handleDragStart(e) {
    const card = e.target.closest('.card[data-name][data-slot]');
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
  }

  window.Dashboard.DragDrop = { attachListeners };
})();
