// E2E: add leader flow — real click on +, then click on profile in modal
const { strict: assert } = require('assert');
const setup = require('./setup');

(async () => {
  let browser;
  try {
    browser = await setup.launchBrowser();
    const page = await setup.openPage(browser);
    await setup.gotoDashboard(page);

    const leadersBefore = await page.$$eval('.top-grid .card[data-name]', (els) =>
      els.map((e) => e.getAttribute('data-name'))
    );
    const leadersCount = leadersBefore.filter(Boolean).length;
    console.log('  [00] Leaders before:', leadersCount, '(' + leadersBefore.filter(Boolean).join(', ') + ')');

    // Get MAX_LEADERS from page
    const maxLeaders = await page.evaluate(() => {
      return window.Dashboard && window.Dashboard.Config && window.Dashboard.Config.MAX_LEADERS;
    });
    console.log('  [00a] MAX_LEADERS =', maxLeaders);

    if (leadersCount >= maxLeaders) {
      console.log('  SKIP: already at max leaders (' + maxLeaders + ')');
      process.exit(0);
    }

    // Open modal
    await page.click('#addLeaderBtn');
    await page.waitForSelector('.profile-modal-overlay', { visible: true, timeout: 5000 });
    const allModalProfiles = await page.$$eval('.profile-modal-item', (els) =>
      els.map((e) => (e.textContent || '').trim().split('\n')[0].trim()).filter(Boolean)
    );
    const candidates = allModalProfiles.filter((p) => !leadersBefore.includes(p));
    if (candidates.length === 0) {
      await page.keyboard.press('Escape');
      console.log('  [01] No candidates, SKIP');
      process.exit(0);
    }
    const target = candidates[0];
    console.log('  [01] Selecting profile:', target);

    // Click the target profile in the modal (pm-toggle)
    const clicked = await page.evaluate((name) => {
      const items = document.querySelectorAll('.profile-modal-item');
      for (const it of items) {
        const firstLine = ((it.textContent || '').trim().split('\n')[0] || '').trim();
        if (firstLine === name) {
          it.click();
          return true;
        }
      }
      return false;
    }, target);
    if (!clicked) {
      throw new Error('Profile "' + target + '" not clickable in modal');
    }

    // Wait for the modal to either close (auto-close on limit) or stay open
    await new Promise(r => setTimeout(r, 500));

    // If modal is still open, close it via the X button to apply the selection
    const modalStillOpen = await page.$('.profile-modal-overlay');
    if (modalStillOpen) {
      // Check the modal is still visible
      const visible = await setup.isElementVisible(page, '.profile-modal-overlay');
      if (visible) {
        console.log('  [02] Modal still open, clicking X to apply');
        await page.click('button[data-action="pm-close"]');
        await new Promise(r => setTimeout(r, 500));
      }
    }

    // Wait for the card to appear in topGrid
    await page.waitForSelector(`.top-grid .card[data-name="${target}"]`, { timeout: 10000 });

    // Verify the leaders count increased
    const newCount = await page.$$eval('.top-grid .card[data-name]', (els) => els.length);
    assert.ok(newCount > leadersBefore.length, 'Leader count should increase: was ' + leadersBefore.length + ', now ' + newCount);
    console.log('     ✓ Leader added, count now:', newCount);

    await setup.screenshot(page, '02-add-leader');
    console.log('PASS: 02-add-leader');
    process.exit(0);
  } catch (e) {
    console.error('FAIL: 02-add-leader —', e.message);
    if (browser) {
      const page = (await browser.pages())[0];
      if (page) await setup.screenshot(page, '02-add-leader-fail').catch(() => {});
    }
    process.exit(1);
  } finally {
    if (browser) await setup.closeBrowser(browser);
  }
})();
