# E2E Tests — Dashboardium

**Stack:** Puppeteer (headless Chromium), Node.js ≥ 18.

These tests verify the **real user experience** by performing **real user
actions** — `page.click()`, `page.type()`, `page.keyboard.press()`. No
`page.evaluate()` workarounds for things the user actually does. If a button
can't be clicked or doesn't produce the expected DOM change, the test **fails**.

## Quick start

```bash
# 1. Install Puppeteer (one-time, ~200MB for Chromium)
npm install --save-dev puppeteer

# 2. Make sure Dashboardium is running at http://localhost:3010
# (default: basic auth admin:dashboardium)

# 3. Run all E2E tests
npm run test:e2e

# 4. Or list available tests
npm run test:e2e:list

# 5. Or run a single test by name
npm run test:e2e:single ui-walkthrough
```

## Test catalog

Every test uses real user actions. No programmatic fallbacks.

| # | Test | What it actually clicks |
|---|------|------------------------|
| 01 | `ui-walkthrough` | Header lang switcher, all leader cards' ✕/optimize/toggle buttons, #addLeaderBtn, #filterInput |
| 02 | `add-leader` | Clicks #addLeaderBtn → clicks profile in dropdown → verifies card appears |
| 03 | `remove-leader` | Clicks ✕ on a leader → verifies card disappears |
| 04 | `chat-send` | Types in chat input → Enter, then again via Send button → waits for bot response |
| 05 | `session-create-switch-delete` | Clicks + new session, types in different sessions, switches, deletes one |
| 06 | `filter-profiles` | Types in #filterInput, verifies focus + value retained, filters cards |
| 07 | `chat-typing-preserved` | Types in chat, waits 15s for renderAll, verifies value + focus preserved |
| 08 | `collapse-expand-chat` | Clicks collapse ▾ → clicks again to expand |
| 09 | `optimize` | Clicks optimize button → waits for it to disable then re-enable |
| 10 | `escape-closes-dropdown` | Opens + dropdown → presses Escape → verifies closed |
| 11 | `language-switcher` | Selects different language → verifies html.lang updates |
| 12 | `stress-rapid-actions` | 50 rapid keystrokes, click jumps between inputs, rapid button mashing |

## Configuration

Environment variables (with defaults):

| Variable | Default | Purpose |
|----------|---------|---------|
| `DASHBOARDIUM_URL` | `http://localhost:3010` | Where the dashboard is running |
| `DASHBOARDIUM_USER` | `admin` | HTTP Basic Auth username |
| `DASHBOARDIUM_PASS` | `dashboardium` | HTTP Basic Auth password |

## What these tests catch

- **Buttons that don't work** — if `page.click('#addLeaderBtn')` doesn't open the
  dropdown, the test fails
- **Focus loss** — typing in an input and the cursor jumping away
- **State leaks** — switching sessions leaving stale messages
- **Missing data attributes** — `data-action`, `data-name`, `data-chat-input`
  must be on the right elements
- **Render bugs** — if `renderAll` blows away user input during typing
- **JS errors** — uncaught exceptions in any user-visible flow

## Adding a new test

1. Copy `01-ui-walkthrough.test.js` as a template
2. Use real `page.click()` / `page.type()` / `page.keyboard.press()` — no
   `page.evaluate()` workarounds
3. Use helpers from `setup.js` — `gotoDashboard`, `addLeader`, `sendChatByEnter`,
   `removeLeader`, `toggleChat`, etc.
4. Each step must verify visible state changed (selector, text, attribute)
5. Run with `node tests/e2e/your-test.test.js` for quick iteration
6. Add to test catalog table above

## Output

- Pass/fail per test
- On failure: full stack trace + screenshot in `tests/e2e/screenshots/<test>-fail.png`
- 3-minute timeout per test

## Troubleshooting

**`Could not find Chrome`** — Puppeteer expects v131 but only v149 is cached.
The setup.js auto-detects v149 from `/root/.cache/puppeteer/chrome/`. If
neither works, run `npx puppeteer browsers install chrome`.

**`net::ERR_CONNECTION_REFUSED`** — Dashboardium isn't running. Start it:
`cd backend && npm start`

**`401 Unauthorized`** — Wrong credentials. Set `DASHBOARDIUM_USER` /
`DASHBOARDIUM_PASS`.

**Test passes but the action "doesn't actually work"** — Look at the
screenshot. If the test does `page.click('#addLeaderBtn')` and the dropdown
opens, but the user sees nothing, then either the CSS is broken or the test
is using a stale cached version. Hard reload: `Ctrl+Shift+R`.
