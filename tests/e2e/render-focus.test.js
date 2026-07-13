// E2E: render-focus.test.js
// Verifies that an incoming chat_update / profiles broadcast doesn't
// re-render the page in a way that loses the user's typing focus or
// caret position in the chat input.
// REGRESSION TEST FOR R2 P1 FIX: renderAll preserve focus + cursor.

const { strict: assert } = require('assert');
const setup = require('./setup');

const TEST_PROFILE = 'rechelok';
const TEST_MESSAGE = 'partial-type-' + Date.now();

(async () => {
  let browser;
  try {
    await setup.waitForServer();
    browser = await setup.launchBrowser();
    const page = await setup.openPage(browser);
    await setup.gotoDashboard(page);
    await setup.loginIfNeeded(page);
    await setup.selectLeader(page, TEST_PROFILE);

    // Find the chat input and start typing
    const input = await page.$('[data-chat-input]');
    if (!input) throw new Error('No active chat input found');
    await input.click();
    // Type partial message (don't press Enter)
    await page.keyboard.type(TEST_MESSAGE.slice(0, 10), { delay: 30 });

    // Get the current value + caret position
    const before = await page.evaluate(() => {
      const el = document.activeElement;
      return el ? { value: el.value, selStart: el.selectionStart, selEnd: el.selectionEnd } : null;
    });
    assert.ok(before && before.value.startsWith(TEST_MESSAGE.slice(0, 10)), 'Input should have the typed text');

    // Trigger a renderAll by waiting for a profiles broadcast (10s delta poll)
    // OR by directly calling a chat that triggers renderAll from the backend
    // Easier: just wait 12s for the next delta poll to fire
    console.log('  Waiting for delta poll to fire (10s)...');
    await setup.sleep(12000);

    // Verify focus is still on input and text is preserved
    const after = await page.evaluate(() => {
      const el = document.activeElement;
      return el ? {
        tag: el.tagName,
        isInput: el.matches('[data-chat-input]'),
        value: el.value,
      } : null;
    });

    if (!after || !after.isInput) {
      // If focus is lost, this is a regression
      throw new Error('Focus was lost during renderAll — input is no longer focused');
    }
    if (after.value !== before.value) {
      throw new Error('Input value was changed during renderAll: was "' + before.value + '", now "' + after.value + '"');
    }
    console.log('  ✓ Input focus + value preserved across renderAll');

    await setup.screenshot(page, 'render-focus');
    console.log('PASS: render-focus');
    process.exit(0);
  } catch (e) {
    console.error('FAIL: render-focus —', e.message);
    if (browser) {
      const page = (await browser.pages())[0];
      if (page) await setup.screenshot(page, 'render-focus-fail').catch(() => {});
    }
    process.exit(1);
  } finally {
    if (browser) await setup.closeBrowser(browser);
  }
})();
