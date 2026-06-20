const { chromium } = require('playwright-core');
(async () => {
  const browser = await chromium.launch();
  const context = await browser.newContext();
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', err => errors.push({type:'pageerror', message: err.message, stack: err.stack}));
  page.on('console', msg => {
    if (msg.type() === 'error') errors.push({type:'console.error', text: msg.text()});
  });
  page.on('requestfailed', req => errors.push({type:'requestfailed', url: req.url(), failure: req.failure()}));
  await page.goto('http://192.168.219.105:3010/', { waitUntil: 'networkidle' });
  await page.waitForTimeout(3000);
  console.log(JSON.stringify(errors, null, 2));
  await browser.close();
})();
