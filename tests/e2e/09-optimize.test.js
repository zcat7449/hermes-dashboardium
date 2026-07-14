// E2E: optimize button click
const { strict: assert } = require('assert');
const setup = require('./setup');

(async () => {
  let browser;
  try {
    browser = await setup.launchBrowser();
    const page = await setup.openPage(browser);
    await setup.gotoDashboard(page);

    // Use any available leader
    const leaders = await page.$$eval('.top-grid .card[data-name]', (els) =>
      els.map((e) => e.getAttribute('data-name')).filter(Boolean)
    );
    assert.ok(leaders.length > 0, 'No leaders available');
    const PROFILE = leaders[0];
    console.log('  [00] Using profile:', PROFILE);

    // Verify optimize button is enabled
    const btnSel = `button[data-action="optimize"][data-name="${PROFILE}"]`;
    const isDisabled = await page.$eval(btnSel, (el) => el.disabled);
    assert.ok(!isDisabled, 'Optimize button should be enabled');

    console.log('  [01] Click optimize button');
    await setup.optimize(page, PROFILE);

    // Wait for the button to be disabled (optimization in progress)
    await page.waitForFunction(
      (sel) => {
        const b = document.querySelector(sel);
        return b && b.disabled;
      },
      { timeout: 5000 },
      btnSel
    );
    console.log('     ✓ Button is now disabled (optimization in progress)');

    // Wait for either: button re-enabled (success) or error message
    console.log('  [02] Wait for optimization to complete (or fail with message)');
    const result = await page.waitForFunction(
      (sel) => {
        const b = document.querySelector(sel);
        if (!b) return 'no button';
        if (!b.disabled) return 're-enabled';
        return null;
      },
      { timeout: 60000 },
      btnSel
    ).then((h) => h.jsonValue());

    console.log('     ✓ Optimize finished, result:', result);

    await setup.screenshot(page, '09-optimize');
    console.log('PASS: 09-optimize');
    process.exit(0);
  } catch (e) {
    console.error('FAIL: 09-optimize —', e.message);
    if (browser) {
      const page = (await browser.pages())[0];
      if (page) await setup.screenshot(page, '09-optimize-fail').catch(() => {});
    }
    process.exit(1);
  } finally {
    if (browser) await setup.closeBrowser(browser);
  }
})();
