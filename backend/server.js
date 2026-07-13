require('dotenv').config();

const express = require('express');
const path = require('path');
const fs = require('fs');
const http = require('http');
const crypto = require('crypto');
const log = require('./services/logger');
const { PORT, HOST, FRONTEND_DIR, PG_IMPORT_FROM_SQLITE, PROFILES_DIR, HERMES_BIN } = require('./config');
const { initPostgres, isPgAvailable, query, getPool } = require('./db');
const { closeDbs } = require('./services/sqlite');
const { importSessionsFromSqlite } = require('./services/pg-import');
const { initWebSocket, closeWebSocket } = require('./services/websocket');

// Server version — changes on every deploy. Frontend polls /api/version and reloads
// automatically when it changes. This eliminates the need for manual Ctrl+Shift+R.
//
// BUG 4 fix: previously SERVER_VERSION was a const evaluated once at module
// load. If the process ran for hours/days and the source file was edited
// (e.g. a re-deploy that updated server.js in place), the version string
// stayed pinned to the original mtime. The new design:
//   1) getServerVersion() recomputes on each call by re-statting the file
//      AND (optionally) re-running `git rev-parse` to pick up commit changes
//   2) results are cached for 5s — short enough that a deploy is visible
//      within a few seconds, long enough that the per-request cost is
//      amortized to ~zero
//   3) DASHBOARDIUM_VERSION env var still wins when set (operator override
//      for canary / blue-green deploys)
const SERVER_VERSION_CACHE_TTL_MS = 5000;
let _serverVersionCache = { value: null, expiresAt: 0 };

function getServerVersion() {
  const now = Date.now();
  if (_serverVersionCache.value !== null && _serverVersionCache.expiresAt > now) {
    return _serverVersionCache.value;
  }
  // 1) env override wins (operator-pinned)
  if (process.env.DASHBOARDIUM_VERSION) {
    _serverVersionCache = { value: process.env.DASHBOARDIUM_VERSION, expiresAt: now + SERVER_VERSION_CACHE_TTL_MS };
    return _serverVersionCache.value;
  }
  // 2) try to combine mtime + commit. Commit is preferred when available
  //    (it survives file rewrites that don't change the SHA), mtime
  //    catches uncommitted-but-deployed changes.
  let value = null;
  try {
    const st = fs.statSync(__filename);
    const mtimePart = st.mtime.getTime().toString(36);
    let commitPart = '';
    try {
      const { execFileSync } = require('child_process');
      const sha = execFileSync('git', ['-C', path.dirname(__filename), 'rev-parse', '--short', 'HEAD'], {
        timeout: 500,
        stdio: ['ignore', 'pipe', 'ignore'],
      }).toString().trim();
      if (sha) commitPart = '-' + sha;
    } catch { /* git not available or not a repo — fall back to mtime only */ }
    value = mtimePart + commitPart;
  } catch {
    value = Date.now().toString(36);
  }
  _serverVersionCache = { value, expiresAt: now + SERVER_VERSION_CACHE_TTL_MS };
  return value;
}

// Backward-compat: keep the original `SERVER_VERSION` symbol as a function
// call so existing references in this file (DEPLOYED_AT log, headers, etc.)
// still resolve. New code should call getServerVersion() directly.
const SERVER_VERSION = getServerVersion();
const DEPLOYED_AT = new Date().toISOString();
log.info('server version', { version: SERVER_VERSION, deployedAt: DEPLOYED_AT });

// Middleware
const corsMiddleware = require('./middleware/cors');
const basicAuthMiddleware = require('./middleware/auth');
const { globalRateLimitMiddleware, startRateLimitSweeper, stopRateLimitSweeper } = require('./middleware/rate-limit');
const pathGuardMiddleware = require('./middleware/path-guard');

// Routes
const { mountProfilesRoutes, buildProfilesResponse } = require('./routes/profiles');
const { mountSessionsRoutes, generateSessionId } = require('./routes/sessions');
const { mountChatRoutes } = require('./routes/chat');
const { mountTasksRoutes } = require('./routes/tasks');
const { mountUserRoleRoutes } = require('./routes/user-role');

// Re-exports for tests
const { checkGlobalIpRateLimit, checkChatRateLimit, chatRateLimits, globalIpLimits, sweepExpiredBuckets } = require('./middleware/rate-limit');
const { getSqliteResultWithParams } = require('./services/sqlite');
const {
  parseHermesSessionsList,
  listHermesSessionsImpl,
  exportHermesSession,
  deleteHermesSession,
  renameHermesSession,
  sanitizeChatMessage,
} = require('./services/hermes-cli');
const { getCachedSessions } = require('./services/cache');
const {
  listPgSessions,
  createPgSession,
  updatePgSessionTitle,
  archivePgSession,
  insertSessionMessage,
  getPgSession,
} = require('./db');

const app = express();
// Disable ETag globally — we want every response to be re-validated so deploys take effect.
app.set('etag', false);
// Disable X-Powered-By (minor security)
app.disable('x-powered-by');
app.set('trust proxy', 1);

// Middleware stack
app.use(corsMiddleware);
app.use(express.json({ limit: '8kb' }));
app.use(globalRateLimitMiddleware);

// Frontend static routes — public (no auth), so browser can load the UI
app.use('/public', express.static(path.join(FRONTEND_DIR, 'public'), { etag: false, lastModified: false, maxAge: 0 }));
app.get('/', (req, res) => {
  // Inject <meta name="server-version"> so the frontend knows which version is deployed
  // without a roundtrip. Combined with /api/version polling, this gives instant auto-reload.
  // BUG 4 fix: use the dynamic getServerVersion() (recomputes every 5s)
  // instead of the module-level constant. A long-running process that
  // gets a deploy will pick up the new version on the next request
  // after the cache TTL expires, without a server restart.
  const indexPath = path.join(FRONTEND_DIR, 'views', 'index.html');
  let html;
  try {
    html = fs.readFileSync(indexPath, 'utf8');
  } catch (e) {
    return res.status(500).send('index.html not found');
  }
  const liveVersion = getServerVersion();
  const metaTag = `<meta name="server-version" content="${liveVersion}">`;
  if (html.includes('name="server-version"')) {
    html = html.replace(/<meta name="server-version"[^>]*>/, metaTag);
  } else {
    html = html.replace('<meta charset="UTF-8">', `<meta charset="UTF-8">\n${metaTag}`);
  }
  // Replace __SERVER_VERSION__ placeholder in <script src="...v=__SERVER_VERSION__"> tags
  // so the browser always sees a version that changes on every deploy — no manual ?v= bump.
  html = html.replace(/__SERVER_VERSION__/g, liveVersion);
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.setHeader('X-Server-Version', liveVersion);
  res.send(html);
});
// views/* must always be fresh — cache-bust ?v= handles the rest
app.use('/views', express.static(path.join(FRONTEND_DIR, 'views'), { etag: false, lastModified: false, maxAge: 0, setHeaders: (res) => res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate') }));
app.use(express.static(FRONTEND_DIR, { etag: false, lastModified: false, maxAge: 0 }));

// Global no-cache for ALL responses (HTML, JS, CSS) — the browser must always re-validate
// so deploys take effect without manual refresh.
app.use((req, res, next) => {
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, max-age=0');
  res.setHeader('Pragma', 'no-cache');
  res.setHeader('Expires', '0');
  res.setHeader('X-Server-Version', getServerVersion());
  next();
});

// Version endpoint — frontend polls this to detect deploys and auto-reload.
// BUG 4 fix: serve the dynamic version so deploys are visible without
// a server restart.
app.get('/api/version', (req, res) => {
  res.json({ version: getServerVersion(), deployedAt: DEPLOYED_AT });
});

// API routes — behind auth
app.use('/api', pathGuardMiddleware);
app.use('/api', basicAuthMiddleware);

// Mount route groups
mountUserRoleRoutes(app);
mountProfilesRoutes(app);
mountSessionsRoutes(app);
mountChatRoutes(app);
mountTasksRoutes(app);

// Error handler
app.use((err, req, res, next) => {
  log.error('unhandled error', {stack: err && err.stack ? err.stack : String(err)});
  res.status(500).json({ error: 'internal server error' });
});

// Main entry
if (require.main === module) {
  (async () => {
    await initPostgres();
    startRateLimitSweeper();
    const importResult = await importSessionsFromSqlite();
    if (importResult.imported > 0) {
      log.info('sqlite import', {imported: importResult.imported, files: importResult.files.length});
    }
    // Verify hermes CLI is available
    try {
      require('child_process').execFileSync(HERMES_BIN, ['--version'], {timeout: 5000});
    } catch (e) {
      log.warn('hermes CLI not found or not executable', {bin: HERMES_BIN, error: e.message});
    }
    const server = http.createServer(app);
    server.on('error', (err) => {
      if (err.code === 'EADDRINUSE') {
        log.error('port already in use', {port: PORT, host: HOST});
        process.exit(1);
      }
      log.error('server error', {error: err.message || String(err), code: err.code});
      throw err;
    });
    initWebSocket(server);
    server.listen(PORT, HOST, () => {
      log.info('server started', {host: HOST, port: PORT});
      log.info('websocket available', {host: HOST, port: PORT});
      log.info('config', {PROFILES_DIR, POSTGRES: isPgAvailable()});
    });
  })();

  // BUG 4 fix: graceful shutdown. The previous handlers called closeDbs()
  // synchronously while in-flight requests were still finishing, which
  // could release the file lock mid-query and trigger SQLITE_BUSY on the
  // next start. The new flow is:
  //   1) stop accepting new connections (server.close)
  //   2) tear down WebSocket (which aborts in-flight chats)
  //   3) close SQLite handles in dbConnections
  //   4) exit 0 once everything is drained
  //   5) force-exit after 10s as a safety net (in case a child process is
  //      stuck or fsync is hanging)
  let shuttingDown = false;
  const gracefulShutdown = (signal) => {
    if (shuttingDown) {
      log.warn('shutdown: second signal received, forcing exit', {signal});
      process.exit(1);
    }
    shuttingDown = true;
    log.info('shutdown: signal received', {signal});
    const forceExit = setTimeout(() => {
      log.warn('shutdown: 10s grace period exceeded, forcing exit');
      process.exit(1);
    }, 10000);
    // Don't keep the event loop alive purely for this timer.
    if (typeof forceExit.unref === 'function') forceExit.unref();

    const done = () => {
      clearTimeout(forceExit);
      log.info('shutdown: clean exit');
      process.exit(0);
    };

    try {
      stopRateLimitSweeper();
    } catch (e) {
      log.warn('shutdown: stopRateLimitSweeper error', {error: e.message});
    }
    try {
      closeWebSocket();
    } catch (e) {
      log.warn('shutdown: closeWebSocket error', {error: e.message});
    }
    try {
      closeDbs();
    } catch (e) {
      log.warn('shutdown: closeDbs error', {error: e.message});
    }
    // Stop accepting new HTTP connections. Existing ones get a chance to
    // finish, then the callback fires.
    try {
      server.close(() => done());
    } catch (e) {
      log.warn('shutdown: server.close error', {error: e.message});
      done();
    }
  };

  process.on('SIGINT', () => gracefulShutdown('SIGINT'));
  process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
}

// Exports for tests
module.exports = {
  app,
  buildProfilesResponse,
  checkGlobalIpRateLimit,
  globalRateLimitMiddleware,
  getSqliteResultWithParams,
  parseHermesSessionsList,
  listHermesSessions: getCachedSessions,
  exportHermesSession,
  deleteHermesSession,
  renameHermesSession,
  listPgSessions,
  createPgSession,
  updatePgSessionTitle,
  archivePgSession,
  insertSessionMessage,
  getPgSession,
  generateSessionId,
  sanitizeChatMessage,
  importSessionsFromSqlite,
};
