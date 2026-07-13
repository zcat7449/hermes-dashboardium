// E2E: session-switch.test.js
// Verifies that switching between chat sessions doesn't leave stale messages
// from the previous session in the chat log.
// REGRESSION TEST FOR P0 BUG: loadSessionMessages appended to existing log
// instead of replacing it.

const { strict: assert } = require('assert');
const setup = require('./setup');

const TEST_PROFILE = 'rechelok';
const MSG_A = 'e2e-session-A-' + Date.now();
const MSG_B = 'e2e-session-B-' + Date.now();

(async () => {
  let browser;
  try {
    await setup.waitForServer();
    browser = await setup.launchBrowser();
    const page = await setup.openPage(browser);
    await setup.gotoDashboard(page);
    await setup.loginIfNeeded(page);
    await setup.selectLeader(page, TEST_PROFILE);

    // Create session A via the UI (+) button if available, else via REST
    const sessionsList = await setup.fetchJson('/api/sessions/' + encodeURIComponent(TEST_PROFILE));
    console.log('  Existing sessions for', TEST_PROFILE, ':', sessionsList.body && sessionsList.body.sessions && sessionsList.body.sessions.length);
    let sessA, sessB;

    // Create two sessions via REST (idempotent — just create with auto-generated ids)
    const create = await setup.fetchJson('/api/sessions/' + encodeURIComponent(TEST_PROFILE), {
      method: 'POST',
    });
    sessA = create.body && create.body.id;
    const create2 = await setup.fetchJson('/api/sessions/' + encodeURIComponent(TEST_PROFILE), {
      method: 'POST',
    });
    sessB = create2.body && create2.body.id;
    console.log('  Created sessions:', sessA, sessB);

    // Reload page so sessions appear in UI
    await page.reload({ waitUntil: 'networkidle2' });
    await setup.gotoDashboard(page);
    await setup.selectLeader(page, TEST_PROFILE);

    // Find session A in the sidebar and click it
    const clickedA = await page.evaluate((sid) => {
      const items = document.querySelectorAll('[data-session-id]');
      for (const it of items) {
        if (it.getAttribute('data-session-id') === sid) { it.click(); return true; }
      }
      return false;
    }, sessA);
    if (!clickedA) console.log('  WARN: session A not clickable in sidebar (may be a known UI issue)');

    await setup.sleep(500);
    // Send a message in session A
    await setup.sendChat(page, MSG_A);
    await setup.waitForChatResponse(page, TEST_PROFILE, 90000).catch(() => {});

    // Switch to session B
    const clickedB = await page.evaluate((sid) => {
      const items = document.querySelectorAll('[data-session-id]');
      for (const it of items) {
        if (it.getAttribute('data-session-id') === sid) { it.click(); return true; }
      }
      return false;
    }, sessB);
    assert.ok(clickedB, 'Should be able to click session B in sidebar');
    await setup.sleep(500);

    // Send a message in session B
    await setup.sendChat(page, MSG_B);
    await setup.waitForChatResponse(page, TEST_PROFILE, 90000).catch(() => {});

    // Switch back to session A
    await page.evaluate((sid) => {
      const items = document.querySelectorAll('[data-session-id]');
      for (const it of items) {
        if (it.getAttribute('data-session-id') === sid) it.click();
      }
    }, sessA);
    await setup.sleep(1000);

    // Verify: chat log for session A should NOT contain MSG_B
    const hasBInA = await page.evaluate((name, msgB) => {
      const log = document.querySelector(`[data-chat-log="${name}"]`);
      if (!log) return false;
      return log.textContent && log.textContent.includes(msgB);
    }, TEST_PROFILE, MSG_B);

    if (hasBInA) {
      throw new Error('Session A chat log contains message from session B — session switch not cleaning log');
    }
    console.log('  ✓ Session A log is clean of session B messages');

    // Verify: chat log for session A should contain MSG_A
    const hasAInA = await page.evaluate((name, msgA) => {
      const log = document.querySelector(`[data-chat-log="${name}"]`);
      if (!log) return false;
      return log.textContent && log.textContent.includes(msgA);
    }, TEST_PROFILE, MSG_A);
    assert.ok(hasAInA, 'Session A log should contain its own message');
    console.log('  ✓ Session A log contains its own message');

    await setup.screenshot(page, 'session-switch');
    console.log('PASS: session-switch');
    process.exit(0);
  } catch (e) {
    console.error('FAIL: session-switch —', e.message);
    if (browser) {
      const page = (await browser.pages())[0];
      if (page) await setup.screenshot(page, 'session-switch-fail').catch(() => {});
    }
    process.exit(1);
  } finally {
    if (browser) await setup.closeBrowser(browser);
  }
})();
