// E2E: collapse/expand chat for a leader
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

    // Initial state: chat log is visible
    let logVisible = await setup.isElementVisible(page, `[data-chat-log="${PROFILE}"]`);
    console.log('  [01] Chat log initially visible:', logVisible);
    if (!logVisible) {
      // Send a message first so there's something to show after collapse
      await setup.clickLeaderCard(page, PROFILE);
      await page.type(`input[data-chat-input="${PROFILE}"]`, 'init', { delay: 5 });
      await page.keyboard.press('Enter');
      await new Promise(r => setTimeout(r, 1000));
      logVisible = await setup.isElementVisible(page, `[data-chat-log="${PROFILE}"]`);
    }

    // Click collapse button
    console.log('  [02] Click collapse button');
    const collapseBtn = await page.$(`button[data-action="toggle-chat"][data-name="${PROFILE}"]`);
    if (!collapseBtn) throw new Error('Collapse button not found for ' + PROFILE);
    await collapseBtn.click();
    await new Promise(r => setTimeout(r, 500));

    // Verify log is now hidden
    const afterCollapse = await setup.isElementVisible(page, `[data-chat-log="${PROFILE}"]`);
    console.log('     After collapse, log visible:', afterCollapse);
    assert.ok(!afterCollapse, 'Chat log should be hidden after collapse');
    console.log('     ✓ Chat log collapsed');

    // Click again to expand
    console.log('  [03] Click toggle again to expand');
    const collapseBtn2 = await page.$(`button[data-action="toggle-chat"][data-name="${PROFILE}"]`);
    if (!collapseBtn2) throw new Error('Collapse button disappeared after collapse');
    await collapseBtn2.click();
    await new Promise(r => setTimeout(r, 500));

    const afterExpand = await setup.isElementVisible(page, `[data-chat-log="${PROFILE}"]`);
    console.log('     After expand, log visible:', afterExpand);
    assert.ok(afterExpand, 'Chat log should be visible after expand');
    console.log('     ✓ Chat log expanded');

    await setup.screenshot(page, '08-collapse-expand-chat');
    console.log('PASS: 08-collapse-expand-chat');
    process.exit(0);
  } catch (e) {
    console.error('FAIL: 08-collapse-expand-chat —', e.message);
    if (browser) {
      const page = (await browser.pages())[0];
      if (page) await setup.screenshot(page, '08-collapse-expand-chat-fail').catch(() => {});
    }
    process.exit(1);
  } finally {
    if (browser) await setup.closeBrowser(browser);
  }
})();
