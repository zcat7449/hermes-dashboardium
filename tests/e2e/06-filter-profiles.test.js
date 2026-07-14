// E2E: filter profiles — real typing in #filterInput
const { strict: assert } = require('assert');
const setup = require('./setup');

(async () => {
  let browser;
  try {
    browser = await setup.launchBrowser();
    const page = await setup.openPage(browser);
    await setup.gotoDashboard(page);

    const allWatched = await page.$$eval('.bottom-grid .card[data-name]', (els) => els.length);
    console.log('  [01] Initial watched cards:', allWatched);

    if (allWatched === 0) {
      console.log('  SKIP: no watched cards to filter');
      process.exit(0);
    }

    // Type a filter query
    const firstName = await page.$eval('.bottom-grid .card[data-name]', (el) => el.getAttribute('data-name'));
    const filterQuery = firstName.substring(0, 3);
    console.log('  [02] Typing filter:', filterQuery);
    await setup.filterProfiles(page, filterQuery);

    // Verify input retains value
    const inputValue = await page.$eval('#filterInput', (el) => el.value);
    assert.equal(inputValue, filterQuery, 'Filter input must retain value (regression: renderAll focus loss)');

    // Verify the focus is still on the filter input
    const focused = await page.evaluate(() => document.activeElement && document.activeElement.id === 'filterInput');
    assert.ok(focused, 'Filter input must retain focus (regression: renderAll focus loss)');

    // Verify the visible cards match the filter
    const visibleAfter = await page.$$eval('.bottom-grid .card[data-name]', (els) =>
      els.map((e) => e.getAttribute('data-name'))
    );
    console.log('  [03] Cards after filter:', visibleAfter);

    // Each visible name should contain the filter query (case-insensitive)
    for (const n of visibleAfter) {
      if (!n.toLowerCase().includes(filterQuery.toLowerCase())) {
        throw new Error('Card "' + n + '" does not match filter "' + filterQuery + '"');
      }
    }

    // Clear filter
    console.log('  [04] Clear filter (Backspace 3x)');
    for (let i = 0; i < 10; i++) await page.keyboard.press('Backspace');
    await new Promise(r => setTimeout(r, 200));
    const visibleAfterClear = await page.$$eval('.bottom-grid .card[data-name]', (els) => els.length);
    assert.equal(visibleAfterClear, allWatched, 'All cards should be visible after clear');

    await setup.screenshot(page, '06-filter-profiles');
    console.log('PASS: 06-filter-profiles');
    process.exit(0);
  } catch (e) {
    console.error('FAIL: 06-filter-profiles —', e.message);
    if (browser) {
      const page = (await browser.pages())[0];
      if (page) await setup.screenshot(page, '06-filter-profiles-fail').catch(() => {});
    }
    process.exit(1);
  } finally {
    if (browser) await setup.closeBrowser(browser);
  }
})();
