const express = require('express');
const path = require('path');
const fs = require('fs');
const http = require('http');
const { PORT, HOST, FRONTEND_DIR, PG_IMPORT_FROM_SQLITE, PROFILES_DIR } = require('./config');
const { initPostgres, isPgAvailable, query, getPool } = require('./db');
const { closeDbs } = require('./services/sqlite');
const { importSessionsFromSqlite } = require('./services/pg-import');
const { initWebSocket, closeWebSocket } = require('./services/websocket');

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
app.set('trust proxy', 1);

// Middleware stack
app.use(corsMiddleware);
app.use(express.json({ limit: '8kb' }));
app.use(globalRateLimitMiddleware);

// Frontend static routes — public (no auth), so browser can load the UI
app.use('/public', express.static(path.join(FRONTEND_DIR, 'public')));
app.get('/', (req, res) => res.sendFile(path.join(FRONTEND_DIR, 'views', 'index.html')));
app.use(express.static(FRONTEND_DIR));

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
  console.error('unhandled error', err && err.stack ? err.stack : String(err));
  res.status(500).json({ error: 'internal server error' });
});

// Main entry
if (require.main === module) {
  (async () => {
    await initPostgres();
    startRateLimitSweeper();
    const importResult = await importSessionsFromSqlite();
    if (importResult.imported > 0) {
      console.log(`imported ${importResult.imported} sessions from ${importResult.files.length} sqlite files`);
    }
    const server = http.createServer(app);
    initWebSocket(server);
    server.listen(PORT, HOST, () => {
      console.log(`Dashboardium backend listening on http://${HOST}:${PORT}`);
      console.log(`WebSocket available on ws://${HOST}:${PORT}/ws`);
      console.log(`PROFILES_DIR=${PROFILES_DIR}`);
      console.log(`POSTGRES=${isPgAvailable()}`);
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
