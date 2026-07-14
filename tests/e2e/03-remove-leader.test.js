// E2E: remove leader flow — real click on ✕ button
const { strict: assert } = require('assert');
const setup = require('./setup');

(async () => {
  let browser;
  try {
    browser = await setup.launchBrowser();
    const page = await setup.openPage(browser);
    await setup.gotoDashboard(page);

    // Pick the first leader
    const firstLeader = await page.$eval('.top-grid .card[data-name]', (el) => el.getAttribute('data-name'));
    console.log('  [01] Removing leader:', firstLeader);
    const beforeCount = await page.$$eval('.top-grid .card[data-name]', (els) => els.length);

    await setup.removeLeader(page, firstLeader);

    const afterCount = await page.$$eval('.top-grid .card[data-name]', (els) => els.length);
    assert.equal(afterCount, beforeCount - 1, 'Leader count should decrease by 1');

    // Verify the card is gone
    const stillThere = await page.$(`.top-grid .card[data-name="${firstLeader}"]`);
    assert.ok(!stillThere, 'Card should be removed from topGrid');

    await setup.screenshot(page, '03-remove-leader');
    console.log('PASS: 03-remove-leader');
    process.exit(0);
  } catch (e) {
    console.error('FAIL: 03-remove-leader —', e.message);
    if (browser) {
      const page = (await browser.pages())[0];
      if (page) await setup.screenshot(page, '03-remove-leader-fail').catch(() => {});
    }
    process.exit(1);
  } finally {
    if (browser) await setup.closeBrowser(browser);
  }
})();
