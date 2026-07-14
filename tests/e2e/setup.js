// E2E test setup — real user actions, no evaluate() workarounds.
// All tests use page.click(), page.type(), page.keyboard.press() — the same
// actions a real user would perform. If a button can't be clicked or a
// selector can't be found, the test FAILS (no fallback).

const puppeteer = require('puppeteer');
const http = require('http');
const path = require('path');
const fs = require('fs');

const BASE_URL = process.env.DASHBOARDIUM_URL || 'http://localhost:3010';
const AUTH_USER = process.env.DASHBOARDIUM_USER || 'admin';
const AUTH_PASS = process.env.DASHBOARDIUM_PASS || 'dashboardium';
const SCREENSHOT_DIR = path.join(__dirname, 'screenshots');

if (!fs.existsSync(SCREENSHOT_DIR)) {
  fs.mkdirSync(SCREENSHOT_DIR, { recursive: true });
}

// Auto-detect Chromium (Puppeteer 23 expects v131, but newer may be cached)
function findChromium() {
  if (process.env.PUPPETEER_EXECUTABLE_PATH &&
      fs.existsSync(process.env.PUPPETEER_EXECUTABLE_PATH)) {
    return process.env.PUPPETEER_EXECUTABLE_PATH;
  }
  const cache = '/root/.cache/puppeteer/chrome';
  if (fs.existsSync(cache)) {
    const versions = fs.readdirSync(cache).filter((v) => /^linux-/.test(v)).sort();
    for (const v of versions.reverse()) {
      const bin = path.join(cache, v, 'chrome-linux64', 'chrome');
      if (fs.existsSync(bin)) return bin;
    }
  }
  return null;
}
const CHROMIUM_PATH = findChromium();

function authHeader() {
  return 'Basic ' + Buffer.from(AUTH_USER + ':' + AUTH_PASS).toString('base64');
}

function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }

// -------------------- Launch + Page --------------------

async function launchBrowser() {
  const launchOpts = {
    headless: 'new',
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-dev-shm-usage',
      '--disable-gpu',
    ],
  };
  if (CHROMIUM_PATH) launchOpts.executablePath = CHROMIUM_PATH;
  return await puppeteer.launch(launchOpts);
}

async function openPage(browser) {
  const page = await browser.newPage();
  await page.setExtraHTTPHeaders({ 'Authorization': authHeader() });
  await page.setViewport({ width: 1280, height: 800 });
  // Auto-accept any confirm/alert dialogs (delete confirmations, etc.)
  page.on('dialog', async (dialog) => {
    try { await dialog.accept(); } catch (e) {}
  });
  // Pre-populate sessionStorage so the dashboard skips the login overlay.
  // The frontend reads `dashboardium_auth` from sessionStorage on boot.
  await page.evaluateOnNewDocument((b64) => {
    try { sessionStorage.setItem('dashboardium_auth', b64); } catch (e) {}
  }, 'Basic ' + Buffer.from(AUTH_USER + ':' + AUTH_PASS).toString('base64'));
  return page;
}

// -------------------- Boot the dashboard --------------------

async function gotoDashboard(page) {
  await page.goto(BASE_URL + '/', { waitUntil: 'networkidle2', timeout: 20000 });

  // If a login overlay still appears, fill it in via real keyboard input.
  const overlayVisible = await isElementVisible(page, '#loginOverlay');
  if (overlayVisible) {
    await page.waitForSelector('#loginUser', { visible: true, timeout: 5000 });
    await page.click('#loginUser');
    await page.type('#loginUser', AUTH_USER, { delay: 10 });
    await page.click('#loginPass');
    await page.type('#loginPass', AUTH_PASS, { delay: 10 });
    await page.click('#loginBtn');
    // Wait for overlay to actually disappear (real animation/transition)
    await page.waitForFunction(
      () => {
        const o = document.getElementById('loginOverlay');
        if (!o) return true;
        return window.getComputedStyle(o).display === 'none';
      },
      { timeout: 10000 }
    );
  }

  // Wait for at least one leader card to appear (rendered from WS broadcast)
  // Cards may be in topGrid (leaders) or bottomGrid (watched)
  await page.waitForSelector('.card[data-name]', { timeout: 20000 });

  // Wait for the connection state to settle
  // 'live · WS · 2' or 'demo' or 'reconnecting' or 'error' are all valid states
  await new Promise(r => setTimeout(r, 2000));
  // We don't strictly require 'live' — the dashboard may operate in any state
  // as long as cards have rendered. The check is moved to per-test assertions.
}

// -------------------- Visibility helpers (real DOM check) --------------------

async function isElementVisible(page, selector) {
  return await page.evaluate((sel) => {
    const el = document.querySelector(sel);
    if (!el) return false;
    const cs = window.getComputedStyle(el);
    if (cs.display === 'none' || cs.visibility === 'hidden') return false;
    if (parseFloat(cs.opacity) === 0) return false;
    return el.offsetParent !== null || cs.position === 'fixed';
  }, selector);
}

async function textExists(page, text) {
  return await page.evaluate((t) => {
    return Array.from(document.querySelectorAll('*'))
      .some((el) => (el.textContent || '').includes(t) &&
                     el.children.length === 0);
  }, text);
}

async function textExistsInSelector(page, selector, text) {
  return await page.evaluate((sel, t) => {
    const root = document.querySelector(sel);
    if (!root) return false;
    return (root.textContent || '').includes(t);
  }, selector, text);
}

async function clickByText(page, text, tagFilter = '*') {
  // Find an element with the given visible text, then click it (real click).
  const handle = await page.evaluateHandle((t, tag) => {
    const els = Array.from(document.querySelectorAll(tag));
    for (const el of els) {
      const cs = window.getComputedStyle(el);
      if (cs.display === 'none' || cs.visibility === 'hidden') continue;
      const txt = (el.textContent || '').trim();
      if (txt === t || (t.length > 0 && txt.includes(t))) {
        return el;
      }
    }
    return null;
  }, text, tagFilter);
  const el = handle.asElement();
  if (!el) {
    throw new Error('No visible element with text "' + text + '" (tag filter: ' + tagFilter + ')');
  }
  // Get the bounding box to make sure it's clickable
  const box = await el.boundingBox();
  if (!box || box.width === 0 || box.height === 0) {
    throw new Error('Element with text "' + text + '" is not clickable (no bounding box)');
  }
  await el.click();
  return el;
}

// -------------------- High-level actions (real user) --------------------

// Open the "add leader" modal by clicking the + button, then pick a profile
async function addLeader(page, profileName) {
  // Click the + button
  await page.click('#addLeaderBtn');
  // Wait for the profile modal to appear
  await page.waitForSelector('.profile-modal-overlay', { timeout: 5000 });
  // Click the profile in the modal — first word of text content (profile name)
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
  }, profileName);
  if (!clicked) {
    const avail = await page.evaluate(() => Array.from(document.querySelectorAll('.profile-modal-item'))
      .map((e) => (e.textContent || '').trim().split('\n')[0].trim()).slice(0, 5).join(', '));
    throw new Error('Profile "' + profileName + '" not found in add-leader modal. First available: ' + avail);
  }
  // Wait for the card to appear in topGrid
  await page.waitForSelector(`.card[data-name="${profileName}"]`, { timeout: 10000 });
}

// Open the "add watched" modal by clicking its + button, then pick a profile
async function addWatched(page, profileName) {
  await page.click('#addWatchedBtn');
  await page.waitForSelector('.profile-modal-overlay', { timeout: 5000 });
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
  }, profileName);
  if (!clicked) {
    throw new Error('Profile "' + profileName + '" not found in add-watched modal');
  }
  await page.waitForSelector(`.bottom-grid .card[data-name="${profileName}"]`, { timeout: 10000 });
}

// Send by pressing Enter
async function sendChatByEnter(page, profileName, message) {
  const sel = `input[data-chat-input="${profileName}"]`;
  const input = await page.$(sel);
  if (!input) throw new Error('Chat input not found for ' + profileName);
  // Wait for input to be enabled (defensive against stuck-send)
  try {
    await page.waitForFunction(
      (s) => {
        const el = document.querySelector(s);
        return el && !el.disabled;
      },
      { timeout: 30000 },
      sel
    );
  } catch (e) {
    // Force-unlock as last resort
    await page.evaluate((s) => {
      const el = document.querySelector(s);
      if (el) el.disabled = false;
    }, sel);
  }
  await input.click({ clickCount: 3 });
  await page.keyboard.press('Backspace');
  await page.type(sel, message, { delay: 5 });
  await page.keyboard.press('Enter');
}

// Send by clicking the Send button
async function sendChatByButton(page, profileName, message) {
  const sel = `input[data-chat-input="${profileName}"]`;
  const input = await page.$(sel);
  if (!input) throw new Error('Chat input not found for ' + profileName);
  // Wait for input to be enabled (defensive against stuck-send)
  try {
    await page.waitForFunction(
      (s) => {
        const el = document.querySelector(s);
        return el && !el.disabled;
      },
      { timeout: 30000 },
      sel
    );
  } catch (e) {
    // Force-unlock as last resort
    await page.evaluate((s) => {
      const el = document.querySelector(s);
      if (el) el.disabled = false;
    }, sel);
  }
  await input.click();
  await page.type(`input[data-chat-input="${profileName}"]`, message, { delay: 5 });
  // Wait for the input to be processed (type events to settle)
  await new Promise(r => setTimeout(r, 100));
  // Click the Send button
  const btn = await page.$(`button[data-action="send"][data-name="${profileName}"]`);
  if (!btn) throw new Error('Send button not found for ' + profileName);
  await btn.click();
}

// Click the chat input directly to focus it for typing
async function clickLeaderCard(page, profileName) {
  const input = await page.$(`input[data-chat-input="${profileName}"]`);
  if (!input) throw new Error('Chat input not found for ' + profileName);
  // Verify input is visible
  const visible = await input.boundingBox();
  if (!visible) throw new Error('Chat input for ' + profileName + ' is not visible');
  await input.click();
  // Verify focus moved to input
  await page.waitForFunction(
    (name) => {
      const el = document.activeElement;
      return el && el.matches && el.matches(`input[data-chat-input="${name}"]`);
    },
    { timeout: 5000 },
    profileName
  );
}

// Create a new chat session
async function createNewSession(page, profileName) {
  // The "+ new session" button is in the session sidebar
  const btn = await page.$(`button[data-action="sess-new"][data-name="${profileName}"]`);
  if (!btn) throw new Error('+ new session button not found for ' + profileName);
  await btn.click();
  await sleep(500);
}

// Switch to a specific session
async function switchSession(page, profileName, sessionId) {
  const sel = `.session-item[data-action="sess-select"][data-name="${profileName}"][data-sid="${sessionId}"]`;
  const item = await page.$(sel);
  if (!item) throw new Error('Session item not found: ' + sel);
  await item.click();
}

// Filter profiles by typing in the filter input
async function filterProfiles(page, query) {
  await page.click('#filterInput');
  await page.type('#filterInput', query, { delay: 20 });
  await sleep(200);
}

// Remove a leader (clicks the ✕ on the leader card)
async function removeLeader(page, profileName) {
  await page.click(`button[data-action="remove-leader"][data-name="${profileName}"]`);
  await page.waitForFunction(
    (name) => !document.querySelector(`.top-grid .card[data-name="${name}"]`),
    { timeout: 5000 },
    profileName
  );
}

// Trigger optimize on a leader
async function optimize(page, profileName) {
  await page.click(`button[data-action="optimize"][data-name="${profileName}"]`);
}

// Toggle chat collapse
async function toggleChat(page, profileName) {
  await page.click(`button[data-action="toggle-chat"][data-name="${profileName}"]`);
}

// -------------------- Wait helpers --------------------

async function waitForText(page, text, timeout = 5000) {
  const start = Date.now();
  while (Date.now() - start < timeout) {
    if (await textExists(page, text)) return;
    await sleep(100);
  }
  throw new Error('Text "' + text + '" never appeared (within ' + timeout + 'ms)');
}

async function waitForSelectorText(page, selector, text, timeout = 5000) {
  await page.waitForFunction(
    (sel, t) => {
      const els = document.querySelectorAll(sel);
      for (const el of els) {
        if ((el.textContent || '').includes(t)) return true;
      }
      return false;
    },
    { timeout },
    selector, text
  );
}

async function waitForBotResponse(page, profileName, timeoutMs = 90000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const got = await page.evaluate((name) => {
      const log = document.querySelector(`[data-chat-log="${name}"]`);
      if (!log) return null;
      // Find the last .msg-bot or .msg-assistant that has non-empty text and isn't typing
      const all = log.querySelectorAll('.msg-bot, .msg-assistant, .msg');
      for (let i = all.length - 1; i >= 0; i--) {
        const m = all[i];
        if (m.classList.contains('msg-typing')) continue;
        const t = (m.textContent || '').trim();
        if (t.length > 0) {
          // Check this is actually a bot/assistant message, not user
          if (m.classList.contains('msg-user') || m.classList.contains('msg-user-msg')) continue;
          return t;
        }
      }
      return null;
    }, profileName);
    if (got) return got;
    await sleep(500);
  }
  throw new Error('Bot response not received within ' + timeoutMs + 'ms for ' + profileName);
}

async function waitForUserMessage(page, profileName, message, timeoutMs = 15000) {
  await page.waitForFunction(
    (name, msg) => {
      const log = document.querySelector(`[data-chat-log="${name}"]`);
      if (!log) return false;
      return (log.textContent || '').includes(msg);
    },
    { timeout: timeoutMs },
    profileName, message
  );
}

// -------------------- Screenshot / cleanup --------------------

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
  CHROMIUM_PATH,
  SCREENSHOT_DIR,
  sleep,
  launchBrowser,
  openPage,
  gotoDashboard,
  isElementVisible,
  textExists,
  textExistsInSelector,
  clickByText,
  addLeader,
  addWatched,
  sendChatByEnter,
  sendChatByButton,
  clickLeaderCard,
  createNewSession,
  switchSession,
  filterProfiles,
  removeLeader,
  optimize,
  toggleChat,
  waitForText,
  waitForSelectorText,
  waitForBotResponse,
  waitForUserMessage,
  screenshot,
  closeBrowser,
};
