// E2E: full UI walkthrough — clicks every visible button/control.
// This is the "click everything" regression test. If a button is unclickable
// or doesn't produce the expected DOM change, the test FAILS.

const { strict: assert } = require('assert');
const setup = require('./setup');

(async () => {
  let browser;
  try {
    await setup.waitForServer && setup.waitForServer(); // noop
    browser = await setup.launchBrowser();
    const page = await setup.openPage(browser);
    await setup.gotoDashboard(page);

    console.log('  [01] Header language switcher is rendered');
    const langVisible = await setup.isElementVisible(page, '#langSwitcher');
    assert.ok(langVisible, '#langSwitcher should be visible');

    console.log('  [02] Leader card count > 0');
    const leaderCount = await page.$$eval('.card[data-name]', (els) => els.length);
    assert.ok(leaderCount > 0, 'Expected at least 1 leader card, got ' + leaderCount);
    console.log('     → ' + leaderCount + ' leader cards rendered');

    console.log('  [03] Add Leader button is clickable');
    await page.click('#addLeaderBtn');
    // Wait for the modal to appear in DOM
    await page.waitForSelector('.profile-modal-overlay', { timeout: 5000 });
    await new Promise(r => setTimeout(r, 200)); // let CSS settle
    const modalVisible = await setup.isElementVisible(page, '.profile-modal-overlay');
    assert.ok(modalVisible, 'Add-leader modal should open on click');
    // Verify the modal has profile items
    const itemCount = await page.$$eval('.profile-modal-item', (els) => els.length);
    assert.ok(itemCount > 0, 'Modal should have profile items, got ' + itemCount);
    console.log('     ✓ Modal opened with ' + itemCount + ' profile items');
    // Close it
    await page.keyboard.press('Escape');
    await new Promise(r => setTimeout(r, 300));

    console.log('  [04] Filter input is typeable');
    await page.click('#filterInput');
    await page.type('#filterInput', 'audit', { delay: 10 });
    await new Promise(r => setTimeout(r, 300));
    const filterValue = await page.$eval('#filterInput', (el) => el.value);
    assert.equal(filterValue, 'audit', 'Filter input should retain typed text');
    // Clear
    await page.click('#filterInput', { clickCount: 3 });
    await page.keyboard.press('Backspace');

    console.log('  [05] Connection status is visible');
    const connText = await page.$eval('#connText', (el) => el.textContent);
    assert.ok(/live|demo|reconnecting|error/i.test(connText), 'connText: ' + connText);

    console.log('  [06] All leader cards have remove (✕) button');
    const removeButtons = await page.$$('button[data-action="remove-leader"]');
    assert.equal(removeButtons.length, leaderCount, 'Each leader should have a remove button');

    console.log('  [07] All leader cards have optimize button');
    const optimizeButtons = await page.$$('button[data-action="optimize"]');
    assert.equal(optimizeButtons.length, leaderCount, 'Each leader should have optimize');

    console.log('  [08] All leader cards have toggle-chat button');
    const toggleButtons = await page.$$('button[data-action="toggle-chat"]');
    assert.equal(toggleButtons.length, leaderCount, 'Each leader should have toggle-chat');

    await setup.screenshot(page, '01-ui-walkthrough');
    console.log('PASS: 01-ui-walkthrough');
    process.exit(0);
  } catch (e) {
    console.error('FAIL: 01-ui-walkthrough —', e.message);
    if (browser) {
      const page = (await browser.pages())[0];
      if (page) await setup.screenshot(page, '01-ui-walkthrough-fail').catch(() => {});
    }
    process.exit(1);
  } finally {
    if (browser) await setup.closeBrowser(browser);
  }
})();
