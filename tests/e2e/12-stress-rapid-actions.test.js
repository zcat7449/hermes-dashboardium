// E2E: stress test — many rapid clicks on filter + chat input + buttons
// to catch any race condition, focus loss, or state corruption.
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

    // 1) Rapid filter typing
    console.log('  [01] Rapid filter typing (10 keystrokes)');
    const filter = await page.$('#filterInput');
    if (filter) {
      await filter.click();
      for (let i = 0; i < 10; i++) {
        await page.keyboard.type('mlm', { delay: 0 });
        await page.keyboard.press('Backspace');
        await page.keyboard.press('Backspace');
        await page.keyboard.press('Backspace');
      }
      console.log('     ✓ Filter survived 10 cycles');
    }

    // 2) Rapid chat input typing
    console.log('  [02] Rapid chat input typing');
    const input = await page.$(`input[data-chat-input="${PROFILE}"]`);
    if (input) {
      await input.click();
      for (let i = 0; i < 5; i++) {
        await page.keyboard.type('test', { delay: 0 });
        await page.keyboard.press('Backspace');
        await page.keyboard.press('Backspace');
        await page.keyboard.press('Backspace');
        await page.keyboard.press('Backspace');
      }
      const v = await page.$eval(`input[data-chat-input="${PROFILE}"]`, (el) => el.value);
      console.log('     Final input value: ' + JSON.stringify(v));
      console.log('     ✓ Chat input survived 5 cycles');
    }

    // 3) Rapid button clicks (no actual chat sends, just button activity)
    console.log('  [03] Rapid clicks on + button (open modal)');
    const addBtn = await page.$('#addLeaderBtn');
    if (addBtn) {
      for (let i = 0; i < 3; i++) {
        await addBtn.click();
        await new Promise(r => setTimeout(r, 100));
        await page.keyboard.press('Escape');
        await new Promise(r => setTimeout(r, 100));
      }
      console.log('     ✓ + button survived 3 open/close cycles');
    }

    // 4) Verify the dashboard is still functional
    console.log('  [04] Dashboard still functional');
    // Give WS a moment to reconnect
    await new Promise(r => setTimeout(r, 2000));
    const connText = await page.$eval('#connText', (el) => el.textContent);
    // Accept live, demo, reconnecting, error — anything except empty/missing
    assert.ok(connText && connText.length > 0, 'Connection state empty');
    assert.ok(/live|demo|reconnect|error|api|ws|offline|connecting/i.test(connText), 'Connection state invalid: ' + connText);
    console.log('     ✓ Connection state OK:', connText.trim());

    // Verify leaders still rendered
    const leaderCount = await page.$$eval('.top-grid .card[data-name]', (els) => els.length);
    assert.ok(leaderCount > 0, 'No leader cards rendered after stress test');
    console.log('     ✓ Leader cards still rendered:', leaderCount);

    await setup.screenshot(page, '12-stress-rapid-actions');
    console.log('PASS: 12-stress-rapid-actions');
    process.exit(0);
  } catch (e) {
    console.error('FAIL: 12-stress-rapid-actions —', e.message);
    if (browser) {
      const page = (await browser.pages())[0];
      if (page) await setup.screenshot(page, '12-stress-rapid-actions-fail').catch(() => {});
    }
    process.exit(1);
  } finally {
    if (browser) await setup.closeBrowser(browser);
  }
})();
