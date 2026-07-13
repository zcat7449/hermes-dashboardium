// E2E test setup — shared helpers for Puppeteer tests
// Boots Dashboardium, opens Chromium, logs in via HTTP Basic Auth.

const puppeteer = require('puppeteer');
const http = require('http');
const path = require('path');

const BASE_URL = process.env.DASHBOARDIUM_URL || 'http://localhost:3010';
const AUTH_USER = process.env.DASHBOARDIUM_USER || 'admin';
const AUTH_PASS = process.env.DASHBOARDIUM_PASS || 'dashboardium';
const SCREENSHOT_DIR = path.join(__dirname, 'screenshots');

const fs = require('fs');
if (!fs.existsSync(SCREENSHOT_DIR)) {
  fs.mkdirSync(SCREENSHOT_DIR, { recursive: true });
}

function authHeader() {
  return 'Basic ' + Buffer.from(AUTH_USER + ':' + AUTH_PASS).toString('base64');
}

function fetchJson(urlPath) {
  return new Promise((resolve, reject) => {
    const url = new URL(urlPath, BASE_URL);
    const req = http.get({
      hostname: url.hostname,
      port: url.port,
      path: url.pathname + url.search,
      headers: { 'Authorization': authHeader() },
    }, (res) => {
      let data = '';
      res.on('data', (chunk) => { data += chunk; });
      res.on('end', () => {
        try { resolve({ status: res.statusCode, body: data ? JSON.parse(data) : null }); }
        catch (e) { resolve({ status: res.statusCode, body: data }); }
      });
    });
    req.on('error', reject);
    req.setTimeout(5000, () => { req.destroy(new Error('fetchJson timeout')); });
  });
}

async function waitForServer(maxMs = 10000) {
  const start = Date.now();
  while (Date.now() - start < maxMs) {
    try {
      const r = await fetchJson('/api/health');
      if (r.status === 200 && r.body && r.body.status === 'ok') return true;
    } catch (e) { /* keep trying */ }
    await sleep(500);
  }
  throw new Error('Server not reachable at ' + BASE_URL);
}

function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }

async function launchBrowser() {
  const browser = await puppeteer.launch({
    headless: 'new',
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-dev-shm-usage',
      '--disable-gpu',
    ],
  });
  return browser;
}

async function openPage(browser, opts = {}) {
  const page = await browser.newPage();
  // HTTP Basic Auth via extra HTTP header
  await page.setExtraHTTPHeaders({ 'Authorization': authHeader() });
  await page.setViewport({ width: 1280, height: 800 });
  // Surface console errors for debugging
  const consoleErrors = [];
  page.on('console', (msg) => {
    if (msg.type() === 'error') consoleErrors.push(msg.text());
  });
  page.on('pageerror', (e) => consoleErrors.push('PAGEERROR: ' + e.message));
  page._consoleErrors = consoleErrors;
  return page;
}

async function gotoDashboard(page) {
  await page.goto(BASE_URL + '/', { waitUntil: 'networkidle2', timeout: 15000 });
  // Wait for topGrid to be populated
  await page.waitForSelector('#topGrid .card', { timeout: 10000 });
  // Wait for WS to be live
  await page.waitForFunction(
    () => document.getElementById('connText') &&
          document.getElementById('connText').textContent.startsWith('live'),
    { timeout: 10000 }
  );
}

async function loginIfNeeded(page) {
  // If login overlay is visible, fill it in
  const overlayVisible = await page.evaluate(() => {
    const o = document.getElementById('loginOverlay');
    return o && o.style.display !== 'none';
  });
  if (overlayVisible) {
    await page.type('#loginUser', AUTH_USER);
    await page.type('#loginPass', AUTH_PASS);
    await page.click('#loginBtn');
    await sleep(500);
  }
}

async function selectLeader(page, profileName) {
  // Click the first leader card to make it active for chat
  const ok = await page.evaluate((name) => {
    const cards = document.querySelectorAll('#topGrid .card');
    for (const c of cards) {
      const dn = c.getAttribute('data-name');
      if (dn === name) { c.click(); return true; }
    }
    return false;
  }, profileName);
  if (!ok) throw new Error('Leader not found: ' + profileName);
  await sleep(200);
}

async function sendChat(page, message) {
  // Find the active chat input
  const input = await page.$('[data-chat-input]');
  if (!input) throw new Error('No active chat input found');
  await input.click({ clickCount: 3 }); // select all
  await page.keyboard.press('Backspace');
  await input.type(message, { delay: 5 });
  // Press Enter to send
  await page.keyboard.press('Enter');
}

async function waitForChatResponse(page, profileName, maxMs = 60000) {
  const start = Date.now();
  while (Date.now() - start < maxMs) {
    const got = await page.evaluate((name) => {
      const log = document.querySelector(`[data-chat-log="${name}"]`);
      if (!log) return null;
      const msgs = log.querySelectorAll('.msg');
      // Look for last assistant message that contains non-empty text
      for (let i = msgs.length - 1; i >= 0; i--) {
        const m = msgs[i];
        if (m.classList.contains('msg-bot') || m.classList.contains('msg-assistant')) {
          const text = (m.textContent || '').trim();
          if (text && !m.classList.contains('msg-typing')) return text;
        }
      }
      return null;
    }, profileName);
    if (got) return got;
    await sleep(1000);
  }
  throw new Error('Chat response timeout for ' + profileName);
}

async function screenshot(page, name) {
  const file = path.join(SCREENSHOT_DIR, name + '.png');
  await page.screenshot({ path: file, fullPage: false });
  return file;
}

async function closeBrowser(browser) {
  if (browser) await browser.close();
}

module.exports = {
  BASE_URL,
  AUTH_USER,
  AUTH_PASS,
  SCREENSHOT_DIR,
  fetchJson,
  waitForServer,
  sleep,
  launchBrowser,
  openPage,
  gotoDashboard,
  loginIfNeeded,
  selectLeader,
  sendChat,
  waitForChatResponse,
  screenshot,
  closeBrowser,
};
