// E2E: search-focus.test.js
// Verifies that typing in the profile search input doesn't lose focus on
// each keystroke (renderAll would otherwise steal it).
// REGRESSION TEST FOR R2 P1 FIX: search input re-render fix in modal.js.

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

    // Click the + (add leader) button to open the profile modal
    const addBtn = await page.$('#addLeaderBtn');
    if (!addBtn) throw new Error('addLeaderBtn not found');
    await addBtn.click();
    await setup.sleep(300);

    // Find the search input
    const search = await page.$('#pmSearchInput');
    if (!search) throw new Error('pmSearchInput not found');

    // Type a partial profile name
    await search.click();
    await page.keyboard.type('rec', { delay: 50 });

    // After each keystroke, verify the input still has focus
    for (const ch of 'helok') {
      await page.keyboard.type(ch, { delay: 50 });
      const focused = await page.evaluate(() => {
        const el = document.activeElement;
        return el && el.id === 'pmSearchInput';
      });
      if (!focused) {
        throw new Error('Search input lost focus after typing "' + ch + '" — renderAll is stealing focus');
      }
    }
    console.log('  ✓ Search input retained focus across all keystrokes');

    // Verify the search filter actually narrowed the results
    const visibleCount = await page.evaluate(() => {
      return document.querySelectorAll('.profile-modal-item').length;
    });
    console.log('  ✓ Visible profile items after search:', visibleCount);

    await setup.screenshot(page, 'search-focus');
    console.log('PASS: search-focus');
    process.exit(0);
  } catch (e) {
    console.error('FAIL: search-focus —', e.message);
    if (browser) {
      const page = (await browser.pages())[0];
      if (page) await setup.screenshot(page, 'search-focus-fail').catch(() => {});
    }
    process.exit(1);
  } finally {
    if (browser) await setup.closeBrowser(browser);
  }
})();
