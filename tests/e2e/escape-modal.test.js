// E2E: escape-modal.test.js
// Verifies that pressing Escape closes an open modal (profile picker / task modal).
// REGRESSION TEST FOR R2 P1 FIX: profile modal Escape handler.

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

    // Open the profile modal
    await page.click('#addLeaderBtn');
    await setup.sleep(300);

    // Verify it's open
    const isOpenBefore = await page.evaluate(() => {
      return document.querySelector('.profile-modal-overlay') !== null;
    });
    assert.ok(isOpenBefore, 'Profile modal should be open after clicking +');

    // Press Escape
    await page.keyboard.press('Escape');
    await setup.sleep(300);

    // Verify it's closed
    const isOpenAfter = await page.evaluate(() => {
      return document.querySelector('.profile-modal-overlay') !== null;
    });
    assert.ok(!isOpenAfter, 'Profile modal should be closed after pressing Escape');

    console.log('  ✓ Escape closes the profile modal');

    await setup.screenshot(page, 'escape-modal');
    console.log('PASS: escape-modal');
    process.exit(0);
  } catch (e) {
    console.error('FAIL: escape-modal —', e.message);
    if (browser) {
      const page = (await browser.pages())[0];
      if (page) await setup.screenshot(page, 'escape-modal-fail').catch(() => {});
    }
    process.exit(1);
  } finally {
    if (browser) await setup.closeBrowser(browser);
  }
})();
