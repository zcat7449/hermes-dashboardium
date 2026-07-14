// E2E: Escape closes the add-leader modal
const { strict: assert } = require('assert');
const setup = require('./setup');

(async () => {
  let browser;
  try {
    browser = await setup.launchBrowser();
    const page = await setup.openPage(browser);
    await setup.gotoDashboard(page);

    console.log('  [01] Click + (add leader) — modal opens');
    await page.click('#addLeaderBtn');
    // Wait for the modal to appear in DOM
    await page.waitForSelector('.profile-modal-overlay', { timeout: 5000 });
    await new Promise(r => setTimeout(r, 200));

    // Verify modal is visible
    const visible = await setup.isElementVisible(page, '.profile-modal-overlay');
    assert.ok(visible, 'Modal should be visible after click');

    console.log('  [02] Press Escape — modal closes');
    await page.keyboard.press('Escape');
    await new Promise(r => setTimeout(r, 500));

    // Verify modal is hidden
    const afterEsc = await page.evaluate(() => {
      const m = document.querySelector('.profile-modal-overlay');
      if (!m) return 'no-element';
      const cs = window.getComputedStyle(m);
      return {
        display: cs.display,
        visible: cs.display !== 'none' && parseFloat(cs.opacity) > 0,
      };
    });
    console.log('     After Escape:', JSON.stringify(afterEsc));
    if (typeof afterEsc === 'object' && afterEsc.visible) {
      throw new Error('Modal should be hidden after Escape');
    }
    console.log('     ✓ Modal is hidden');

    await setup.screenshot(page, '10-escape-closes-modal');
    console.log('PASS: 10-escape-closes-modal');
    process.exit(0);
  } catch (e) {
    console.error('FAIL: 10-escape-closes-modal —', e.message);
    if (browser) {
      const page = (await browser.pages())[0];
      if (page) await setup.screenshot(page, '10-escape-closes-modal-fail').catch(() => {});
    }
    process.exit(1);
  } finally {
    if (browser) await setup.closeBrowser(browser);
  }
})();
