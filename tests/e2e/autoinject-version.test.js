// E2E: autoinject-version.test.js
// Verifies that script tags use the server-injected ?v=__SERVER_VERSION__
// (cache busting on deploy).
// REGRESSION TEST FOR R0 P0 FIX: ?v=__SERVER_VERSION__ auto-injection.

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

    // Inspect all script tags
    const scripts = await page.evaluate(() => {
      return Array.from(document.querySelectorAll('script[src]')).map(s => s.src);
    });
    console.log('  Script tags found:', scripts.length);

    // None should have a literal ?v=2 or ?v=5 (stale hardcoded)
    const stale = scripts.filter(s => /\?v=(2|3|4|5|6|7|8|9|10|11|12)$/.test(s));
    assert.ok(stale.length === 0, `Found stale ?v=N: ${stale.join(', ')}`);

    // All should have a real version hash (alphanumeric, length > 4)
    const withoutVersion = scripts.filter(s => !/\?v=[a-zA-Z0-9_-]{4,}/.test(s));
    assert.ok(withoutVersion.length === 0, `Found script without proper version: ${withoutVersion.join(', ')}`);

    console.log('  ✓ All', scripts.length, 'script tags have a real version hash');

    // Verify the version matches /api/version
    const apiVersion = await setup.fetchJson('/api/version');
    const expectedHash = apiVersion.body && apiVersion.body.version;
    const matchCount = scripts.filter(s => s.includes('?v=' + expectedHash)).length;
    assert.ok(matchCount > 0, `At least one script should have ?v=${expectedHash}, found ${matchCount}`);
    console.log('  ✓', matchCount, 'scripts have ?v=' + expectedHash);

    await setup.screenshot(page, 'autoinject-version');
    console.log('PASS: autoinject-version');
    process.exit(0);
  } catch (e) {
    console.error('FAIL: autoinject-version —', e.message);
    if (browser) {
      const page = (await browser.pages())[0];
      if (page) await setup.screenshot(page, 'autoinject-version-fail').catch(() => {});
    }
    process.exit(1);
  } finally {
    if (browser) await setup.closeBrowser(browser);
  }
})();
