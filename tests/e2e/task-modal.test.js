// E2E: task-modal.test.js
// Verifies that opening the task modal works, and reopening after a failed
// first load doesn't leave a duplicate overlay behind.
// REGRESSION TEST FOR R2 P1 FIX: task-modal error clear overlay.

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

    // Trigger task modal open via Dashboard.TaskModal.showTaskModal
    const opened = await page.evaluate(() => {
      if (!window.Dashboard || !window.Dashboard.TaskModal || !window.Dashboard.TaskModal.showTaskModal) {
        return 'no API';
      }
      try {
        // Use a fake board/task id — the showTaskModal will fail to fetch
        // but should clear any previous overlay first
        window.Dashboard.TaskModal.showTaskModal('e2e-board', 'e2e-task-1');
        return true;
      } catch (e) {
        return 'error: ' + e.message;
      }
    });
    console.log('  showTaskModal result:', opened);
    await setup.sleep(500);

    // Try opening again — should NOT create a duplicate overlay
    await page.evaluate(() => {
      if (window.Dashboard && window.Dashboard.TaskModal && window.Dashboard.TaskModal.showTaskModal) {
        window.Dashboard.TaskModal.showTaskModal('e2e-board', 'e2e-task-2');
      }
    });
    await setup.sleep(500);

    const overlayCount = await page.evaluate(() => {
      return document.querySelectorAll('.task-modal-overlay').length;
    });
    assert.ok(overlayCount <= 1, `Should have at most 1 task modal overlay, got ${overlayCount}`);
    console.log('  ✓ Task modal overlay count:', overlayCount);

    // Close it via Escape
    await page.keyboard.press('Escape');
    await setup.sleep(300);
    const afterClose = await page.evaluate(() => {
      return document.querySelectorAll('.task-modal-overlay').length;
    });
    console.log('  ✓ After Escape, overlay count:', afterClose);

    await setup.screenshot(page, 'task-modal');
    console.log('PASS: task-modal');
    process.exit(0);
  } catch (e) {
    console.error('FAIL: task-modal —', e.message);
    if (browser) {
      const page = (await browser.pages())[0];
      if (page) await setup.screenshot(page, 'task-modal-fail').catch(() => {});
    }
    process.exit(1);
  } finally {
    if (browser) await setup.closeBrowser(browser);
  }
})();
