# E2E Tests — Dashboardium

**Stack:** Puppeteer (headless Chromium), Node.js ≥ 18, no backend dependencies.

These tests verify the **real user experience** in a real browser — they catch
regressions that unit tests cannot: focus loss, real-time updates, WebSocket
lifecycle, localStorage quota, render-on-data race conditions.

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
npm run test:e2e:single chat-realtime
```

## Configuration

Environment variables (with defaults):

| Variable | Default | Purpose |
|----------|---------|---------|
| `DASHBOARDIUM_URL` | `http://localhost:3010` | Where the dashboard is running |
| `DASHBOARDIUM_USER` | `admin` | HTTP Basic Auth username |
| `DASHBOARDIUM_PASS` | `dashboardium` | HTTP Basic Auth password |

## Test catalog

Each test maps to a specific regression we introduced and then fixed.

| # | Test | Bug it guards against | Round |
|---|------|----------------------|-------|
| 1 | `leader-pick` | Dashboard renders, leader is selectable | baseline |
| 2 | `chat-realtime` | P0: `if (added > 0) ReferenceError` silenced chat | R1 |
| 3 | `session-switch` | P0: switching sessions kept old messages | R1 |
| 4 | `search-focus` | R2 P1: search input lost focus on each keystroke | R2 |
| 5 | `render-focus` | R2 P1: typing in chat input interrupted by renderAll | R2 |
| 6 | `ws-reconnect` | R2 P1: typing timer kept ticking after WS disconnect | R2 |
| 7 | `localstorage-quota` | R3 P2: dashboard crashed on QuotaExceededError | R3 |
| 8 | `new-session` | R1 P0: `localCreate` not exported, + button broken | R1 |
| 9 | `escape-modal` | R2 P1: Escape didn't close profile modal | R2 |
| 10 | `task-modal` | R2 P1: reopening task modal left duplicate overlay | R2 |
| 11 | `autoinject-version` | R1 P0: stale `?v=12` hardcoded → cache miss on deploy | R1 |
| 12 | `drag-drop` | Verifies all 11 expected `window.Dashboard.*` exports | R1+R2 |

## Output

- Pass/fail printed per test
- Total time, pass/fail count at the end
- On failure: full stdout/stderr dumped, plus a screenshot in
  `tests/e2e/screenshots/<test>-fail.png` for visual inspection

## What these tests catch that unit tests don't

- **Focus loss bugs**: typing in an input and the cursor jumping away
- **Real-time WebSocket flow**: server push → DOM update with no manual reload
- **Race conditions**: typing + broadcast delta poll + chat response interleaving
- **State leaks**: localStorage + WebSocket reconnect + page reload
- **User-visible regressions**: missing API exports, broken buttons, modal leaks

## CI integration

```yaml
# .github/workflows/e2e.yml
- name: Install Puppeteer
  run: npm install --save-dev puppeteer

- name: Start Dashboardium
  run: systemctl start dashboardium

- name: Wait for server
  run: until curl -sf http://localhost:3010/api/health; do sleep 1; done

- name: Run E2E tests
  run: npm run test:e2e
```

## Adding a new test

1. Copy `leader-pick.test.js` (simplest one) as a template
2. Use helpers from `setup.js` — `gotoDashboard`, `selectLeader`, `sendChat`,
   `waitForChatResponse`, `screenshot`
3. Run with `node tests/e2e/your-test.test.js` for quick iteration
4. Add to test catalog table above

## Troubleshooting

**`net::ERR_CONNECTION_REFUSED` at startup** — Dashboardium isn't running.
Start it: `cd backend && npm start`

**`net::ERR_INVALID_AUTH` or 401** — Wrong credentials. Set
`DASHBOARDIUM_USER` and `DASHBOARDIUM_PASS` env vars.

**Tests pass locally but fail in CI** — Check that the dev server has the
expected profiles (`rechelok`, `mlm` are typical). If not, the test will
warn "profile not in leaders" and skip the chat-related assertions.

**Screenshots are blank** — The Puppeteer `--disable-gpu` flag is required
in some headless environments. Already set in `setup.js`.
