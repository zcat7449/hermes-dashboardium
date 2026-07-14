// E2E: chat send via Enter (profile A) and via button (profile B)
const { strict: assert } = require('assert');
const setup = require('./setup');

(async () => {
  let browser;
  try {
    browser = await setup.launchBrowser();
    const page = await setup.openPage(browser);
    await setup.gotoDashboard(page);

    // Find which profiles are leaders
    const leaders = await page.$$eval('.top-grid .card[data-name]', (els) =>
      els.map((e) => e.getAttribute('data-name'))
    );
    assert.ok(leaders.length >= 2, 'Need at least 2 leaders to test both methods. Got: ' + leaders.length);
    const [profileA, profileB] = leaders;
    console.log('  [00] Using profiles:', profileA, '(Enter) and', profileB, '(Button)');

    const MSG_ENTER = 'e2e-enter-' + Date.now();
    console.log('  [01] Send via Enter key on', profileA);
    await setup.sendChatByEnter(page, profileA, MSG_ENTER);
    await setup.waitForUserMessage(page, profileA, MSG_ENTER, 15000);
    console.log('     ✓ User message appeared');

    const MSG_BUTTON = 'e2e-button-' + Date.now();
    console.log('  [02] Send via button click on', profileB);
    await setup.sendChatByButton(page, profileB, MSG_BUTTON);
    await setup.waitForUserMessage(page, profileB, MSG_BUTTON, 15000);
    console.log('     ✓ User message appeared');

    await setup.screenshot(page, '04-chat-send');
    console.log('PASS: 04-chat-send');
    process.exit(0);
  } catch (e) {
    console.error('FAIL: 04-chat-send —', e.message);
    if (browser) {
      const page = (await browser.pages())[0];
      if (page) await setup.screenshot(page, '04-chat-send-fail').catch(() => {});
    }
    process.exit(1);
  } finally {
    if (browser) await setup.closeBrowser(browser);
  }
})();
