// E2E: chat input preserves value during typing (regression: renderAll blows away typing)
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

    // Focus the input and type partial message
    const input = await page.$(`input[data-chat-input="${PROFILE}"]`);
    assert.ok(input, 'Chat input not found for ' + PROFILE);
    await input.click();
    await page.type(`input[data-chat-input="${PROFILE}"]`, 'partial-msg-', { delay: 10 });

    // Wait a few seconds — broadcasts and re-renders happen every 2s
    console.log('  [01] Wait 5s with partial text in input');
    await new Promise(r => setTimeout(r, 5000));

    // Verify the value is still there
    const val = await page.$eval(`input[data-chat-input="${PROFILE}"]`, (el) => el.value);
    console.log('     Input value after 5s:', JSON.stringify(val));
    assert.ok(val.indexOf('partial-msg-') === 0, 'Input value should be preserved, got: ' + val);
    console.log('     ✓ Input value preserved during background re-renders');

    // Type more
    await page.type(`input[data-chat-input="${PROFILE}"]`, 'more-text', { delay: 10 });
    const val2 = await page.$eval(`input[data-chat-input="${PROFILE}"]`, (el) => el.value);
    assert.equal(val2, 'partial-msg-more-text', 'Continued typing should append');
    console.log('     ✓ Continued typing works correctly');

    // Clean up — clear input
    await page.click(`input[data-chat-input="${PROFILE}"]`, { clickCount: 3 });
    await page.keyboard.press('Backspace');

    await setup.screenshot(page, '07-chat-typing-preserved');
    console.log('PASS: 07-chat-typing-preserved');
    process.exit(0);
  } catch (e) {
    console.error('FAIL: 07-chat-typing-preserved —', e.message);
    if (browser) {
      const page = (await browser.pages())[0];
      if (page) await setup.screenshot(page, '07-chat-typing-preserved-fail').catch(() => {});
    }
    process.exit(1);
  } finally {
    if (browser) await setup.closeBrowser(browser);
  }
})();
