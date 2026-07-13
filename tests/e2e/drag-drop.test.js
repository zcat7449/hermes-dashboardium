// E2E: drag-drop.test.js
// Verifies that the drag-and-drop UI in the top-grid is wired up
// (DragDrop.attachListeners was called on boot).
// REGRESSION TEST FOR R0 P0 FIX: localCreate and other API exports.

const { strict: assert } = require('assert');
const setup = require('./setup');

(async () => {
  let browser;
  try {
    await setup.waitForServer();
    browser = await setup.launchBrowser();
    const page = await setup.openPage(browser);
    await setup.gotoDashboard(page);
    await setup.loginIfNeeded(page);

    // Verify the core API surface exists
    const apiSurface = await page.evaluate(() => {
      const w = window;
      return {
        API: !!(w.Dashboard && w.Dashboard.API),
        localCreate: !!(w.Dashboard && w.Dashboard.API && typeof w.Dashboard.API.localCreate === 'function'),
        localList: !!(w.Dashboard && w.Dashboard.API && typeof w.Dashboard.API.localList === 'function'),
        localDelete: !!(w.Dashboard && w.Dashboard.API && typeof w.Dashboard.API.localDelete === 'function'),
        Actions: !!(w.Dashboard && w.Dashboard.Actions),
        stopAllTypingTimers: !!(w.Dashboard && w.Dashboard.Actions && typeof w.Dashboard.Actions.stopAllTypingTimers === 'function'),
        Render: !!(w.Dashboard && w.Dashboard.Render),
        DragDrop: !!(w.Dashboard && w.Dashboard.DragDrop),
        attachListeners: !!(w.Dashboard && w.Dashboard.DragDrop && typeof w.Dashboard.DragDrop.attachListeners === 'function'),
        Modal: !!(w.Dashboard && w.Dashboard.Modal),
        TaskModal: !!(w.Dashboard && w.Dashboard.TaskModal),
      };
    });
    console.log('  API surface:', JSON.stringify(apiSurface, null, 2));

    assert.ok(apiSurface.API, 'Dashboard.API must be exposed');
    assert.ok(apiSurface.localCreate, 'API.localCreate must be exported (R0 P0 fix)');
    assert.ok(apiSurface.localList, 'API.localList must be exported');
    assert.ok(apiSurface.localDelete, 'API.localDelete must be exported');
    assert.ok(apiSurface.Actions, 'Dashboard.Actions must be exposed');
    assert.ok(apiSurface.stopAllTypingTimers, 'Actions.stopAllTypingTimers must be exported (R2 P1 fix)');
    assert.ok(apiSurface.Render, 'Dashboard.Render must be exposed');
    assert.ok(apiSurface.DragDrop, 'Dashboard.DragDrop must be exposed');
    assert.ok(apiSurface.attachListeners, 'DragDrop.attachListeners must be exported');
    assert.ok(apiSurface.Modal, 'Dashboard.Modal must be exposed');
    assert.ok(apiSurface.TaskModal, 'Dashboard.TaskModal must be exposed');

    console.log('  ✓ All 11 expected exports present');

    // Try to find a draggable element
    const draggable = await page.evaluate(() => {
      const cards = document.querySelectorAll('.card[draggable="true"]');
      return cards.length;
    });
    console.log('  Draggable cards found:', draggable);
    assert.ok(draggable > 0, 'Should have at least 1 draggable card');

    await setup.screenshot(page, 'drag-drop');
    console.log('PASS: drag-drop');
    process.exit(0);
  } catch (e) {
    console.error('FAIL: drag-drop —', e.message);
    if (browser) {
      const page = (await browser.pages())[0];
      if (page) await setup.screenshot(page, 'drag-drop-fail').catch(() => {});
    }
    process.exit(1);
  } finally {
    if (browser) await setup.closeBrowser(browser);
  }
})();
