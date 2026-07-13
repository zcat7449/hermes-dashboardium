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
const SERVER_VERSION = process.env.DASHBOARDIUM_VERSION ||
  (() => {
    // Auto-derive from mtime of server.js — every deploy touches this file.
    try {
      const st = fs.statSync(__filename);
      return st.mtime.getTime().toString(36);
    } catch {
      return Date.now().toString(36);
    }
  })();
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
  const indexPath = path.join(FRONTEND_DIR, 'views', 'index.html');
  let html;
  try {
    html = fs.readFileSync(indexPath, 'utf8');
  } catch (e) {
    return res.status(500).send('index.html not found');
  }
  const metaTag = `<meta name="server-version" content="${SERVER_VERSION}">`;
  if (html.includes('name="server-version"')) {
    html = html.replace(/<meta name="server-version"[^>]*>/, metaTag);
  } else {
    html = html.replace('<meta charset="UTF-8">', `<meta charset="UTF-8">\n${metaTag}`);
  }
  // Replace __SERVER_VERSION__ placeholder in <script src="...v=__SERVER_VERSION__"> tags
  // so the browser always sees a version that changes on every deploy — no manual ?v= bump.
  html = html.replace(/__SERVER_VERSION__/g, SERVER_VERSION);
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
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
  res.setHeader('X-Server-Version', SERVER_VERSION);
  next();
});

// Version endpoint — frontend polls this to detect deploys and auto-reload.
app.get('/api/version', (req, res) => {
  res.json({ version: SERVER_VERSION, deployedAt: DEPLOYED_AT });
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

  process.on('SIGINT', () => {
    stopRateLimitSweeper();
    closeWebSocket();
    closeDbs();
    process.exit(0);
  });
  process.on('SIGTERM', () => {
    stopRateLimitSweeper();
    closeWebSocket();
    closeDbs();
    process.exit(0);
  });
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
