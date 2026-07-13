// E2E: chat-realtime.test.js
// Verifies that sending a chat message in the dashboard causes the bot response
// to appear in real-time (no manual reload).
// REGRESSION TEST FOR P0 BUG: "if (added > 0) ReferenceError" caused chat to
// silently fail in the same-session case.

const { strict: assert } = require('assert');
const setup = require('./setup');

const TEST_PROFILE = 'rechelok'; // A known leader profile
const TEST_MESSAGE = 'e2e-realtime-' + Date.now();

(async () => {
  let browser;
  try {
    await setup.waitForServer();
    browser = await setup.launchBrowser();
    const page = await setup.openPage(browser);
    await setup.gotoDashboard(page);
    await setup.loginIfNeeded(page);

    // Select a leader
    await setup.selectLeader(page, TEST_PROFILE);

    // Type and send message
    await setup.sendChat(page, TEST_MESSAGE);

    // Verify message appears as user message
    await page.waitForFunction(
      (name, msg) => {
        const log = document.querySelector(`[data-chat-log="${name}"]`);
        if (!log) return false;
        const userMsgs = log.querySelectorAll('.msg-user, .msg-user-msg, [data-role="user"]');
        for (const m of userMsgs) {
          if (m.textContent && m.textContent.includes(msg)) return true;
        }
        // Fallback: any .msg whose text contains our marker
        const all = log.querySelectorAll('.msg');
        for (const m of all) {
          if (m.textContent && m.textContent.includes(msg)) return true;
        }
        return false;
      },
      { timeout: 5000 },
      TEST_PROFILE,
      TEST_MESSAGE
    );

    console.log('  ✓ User message appeared in chat log');

    // Wait for bot response
    const response = await setup.waitForChatResponse(page, TEST_PROFILE, 90000);
    console.log('  ✓ Bot response received:', response.slice(0, 80) + '...');
    assert.ok(response.length > 0, 'Bot response should not be empty');

    await setup.screenshot(page, 'chat-realtime');
    console.log('PASS: chat-realtime');
    process.exit(0);
  } catch (e) {
    console.error('FAIL: chat-realtime —', e.message);
    if (browser) {
      const page = (await browser.pages())[0];
      if (page) await setup.screenshot(page, 'chat-realtime-fail').catch(() => {});
    }
    process.exit(1);
  } finally {
    if (browser) await setup.closeBrowser(browser);
  }
})();
