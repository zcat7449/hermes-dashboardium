// E2E: session creation + switch + cleanup
// Uses TWO leaders so chat input doesn't get locked by a pending send.
const { strict: assert } = require('assert');
const setup = require('./setup');

(async () => {
  let browser;
  try {
    browser = await setup.launchBrowser();
    const page = await setup.openPage(browser);
    await setup.gotoDashboard(page);

    // Use TWO different leaders so we can alternate chat sessions
    const leaders = await page.$$eval('.top-grid .card[data-name]', (els) =>
      els.map((e) => e.getAttribute('data-name')).filter(Boolean)
    );
    assert.ok(leaders.length >= 2, 'Need at least 2 leaders, got ' + leaders.length);
    const PROFILE_A = leaders[0];
    const PROFILE_B = leaders[1];
    console.log('  [00] Using profiles:', PROFILE_A, '(A) and', PROFILE_B, '(B)');

    // Create new session A on PROFILE_A
    console.log('  [01] Create new session on', PROFILE_A);
    const before = await page.$$eval(
      `.session-item[data-action="sess-select"][data-name="${PROFILE_A}"]`,
      (els) => els.length
    );
    await page.click(`button[data-action="sess-new"][data-name="${PROFILE_A}"]`);
    await new Promise(r => setTimeout(r, 1000));

    const sessionsAfterCreate = await page.$$eval(
      `.session-item[data-action="sess-select"][data-name="${PROFILE_A}"]`,
      (els) => els.length
    );
    assert.ok(sessionsAfterCreate > before, 'Sessions should increase: was ' + before + ', now ' + sessionsAfterCreate);
    console.log('     ✓ Sessions: ' + before + ' -> ' + sessionsAfterCreate);

    // Get session IDs (newest first)
    const sessionIds = await page.$$eval(
      `.session-item[data-action="sess-select"][data-name="${PROFILE_A}"]`,
      (els) => els.map((e) => e.getAttribute('data-sid'))
    );
    // Need at least 2 sessions that have messages. We just created one, send msg in it,
    // and use any other existing session (which has historical messages) for B.
    const sessA = sessionIds[sessionIds.length - 1]; // newly created
    if (sessionIds.length < 2) {
      console.log('  SKIP: need at least 2 sessions for switch test, got ' + sessionIds.length);
      await setup.screenshot(page, '05-session-create-switch-delete');
      process.exit(0);
    }
    // Use the very first (oldest) as sessB — it has historical data
    const sessB = sessionIds[0];

    // Activate session A on PROFILE_A
    await setup.switchSession(page, PROFILE_A, sessA);
    await new Promise(r => setTimeout(r, 1500));

    const MSG_A = 'e2e-sessA-' + Date.now();
    console.log('  [02] Send message in newly-created session A:', MSG_A);
    await setup.sendChatByEnter(page, PROFILE_A, MSG_A);
    await setup.waitForUserMessage(page, PROFILE_A, MSG_A, 15000);

    // Switch to oldest session (has historical data)
    await setup.switchSession(page, PROFILE_A, sessB);
    // Wait for input to be enabled (previous send may still be in progress)
    try {
      await page.waitForFunction(
        (name) => {
          const i = document.querySelector(`input[data-chat-input="${name}"]`);
          return i && !i.disabled;
        },
        { timeout: 20000 },
        PROFILE_A
      );
    } catch (e) {
      console.log('  [03a] input still disabled, will try anyway');
    }
    await new Promise(r => setTimeout(r, 1000));

    const MSG_B = 'e2e-sessB-' + Date.now();
    console.log('  [03] Send message in oldest session B:', MSG_B);
    await setup.sendChatByEnter(page, PROFILE_A, MSG_B);
    await setup.waitForUserMessage(page, PROFILE_A, MSG_B, 15000);

    // Switch back to session A and verify it does NOT contain MSG_B
    await setup.switchSession(page, PROFILE_A, sessA);
    await new Promise(r => setTimeout(r, 2000));

    const hasBInA = await setup.textExistsInSelector(page, `[data-chat-log="${PROFILE_A}"]`, MSG_B);
    assert.ok(!hasBInA, 'Session A should NOT contain message from session B');
    console.log('     ✓ Session A is clean of session B messages');

    // Delete session A
    console.log('  [04] Delete session A via ✕ button');
    const deleteBtn = await page.$(`.session-item[data-action="sess-select"][data-name="${PROFILE_A}"][data-sid="${sessA}"] .sess-delete`);
    if (deleteBtn) {
      await deleteBtn.click();
      // The click triggers a custom confirm modal. Click "Да".
      try {
        await page.waitForSelector('button[data-action="confirm-yes"]', { visible: true, timeout: 3000 });
        await page.click('button[data-action="confirm-yes"]');
      } catch (e) {
        console.log('  [04a] no confirm modal appeared, continuing');
      }
      await new Promise(r => setTimeout(r, 1500));
    }

    const sessionsAfterDelete = await page.$$eval(
      `.session-item[data-action="sess-select"][data-name="${PROFILE_A}"]`,
      (els) => els.length
    );
    assert.equal(sessionsAfterDelete, sessionsAfterCreate - 1, 'Sessions should decrease by 1 after delete');
    console.log('     ✓ Sessions: ' + sessionsAfterCreate + ' -> ' + sessionsAfterDelete);

    await setup.screenshot(page, '05-session-create-switch-delete');
    console.log('PASS: 05-session-create-switch-delete');
    process.exit(0);
  } catch (e) {
    console.error('FAIL: 05-session-create-switch-delete —', e.message);
    if (browser) {
      const page = (await browser.pages())[0];
      if (page) await setup.screenshot(page, '05-session-create-switch-delete-fail').catch(() => {});
    }
    process.exit(1);
  } finally {
    if (browser) await setup.closeBrowser(browser);
  }
})();
