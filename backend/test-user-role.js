// Tests for /api/user-role endpoints — CRUD operations on user_role.json.
// Uses a temp file to avoid modifying real config.

process.env.PORT = '0';
process.env.HOST = '127.0.0.1';
process.env.DATABASE_URL = '';
process.env.PG_IMPORT_FROM_SQLITE = '0';
process.env.AUTH_USERNAME = '';
process.env.AUTH_PASSWORD = '';
process.env.GLOBAL_RATE_LIMIT_RPS = '10000';
process.env.GLOBAL_RATE_LIMIT_WINDOW_MS = '60000';
process.env.PROFILES_DIR = '/root/.hermes/profiles';
process.env.KANBAN_BOARDS_DIR = '/root/.hermes/kanban/boards';
process.env.HERMES_BIN = '/usr/local/bin/hermes';
process.env.FRONTEND_DIR = require('path').join(__dirname, '..', 'frontend');

const http = require('http');
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const os = require('os');

// Use temp file for user_role.json
const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'dashboardium-test-'));
const tmpRolePath = path.join(tmpDir, 'user_role.json');
process.env.HOME = tmpDir;
// Override USER_ROLE_PATH by setting HOME before config loads
// config.js reads: path.join(REAL_HOME, '.hermes', 'user_role.json')
fs.mkdirSync(path.join(tmpDir, '.hermes'), { recursive: true });
const rolePath = path.join(tmpDir, '.hermes', 'user_role.json');

// Mock hermes-cli
const hermesCliPath = require.resolve('./services/hermes-cli.js');
require.cache[hermesCliPath] = {
  id: hermesCliPath, filename: hermesCliPath, loaded: true,
  exports: {
    listHermesSessionsImpl: async () => [],
    parseHermesSessionsList: () => [],
    exportHermesSession: async () => null,
    deleteHermesSession: async () => true,
    renameHermesSession: async () => true,
    sanitizeChatMessage: (m) => String(m || '').trim(),
    hermesChat: async () => 'mock',
    parseHermesChatOutput: () => ({ session_id: 'mock', response: 'mock' }),
    hermesKanbanBlock: async () => undefined,
    hermesKanbanUnblock: async () => undefined,
    hermesKanbanReassign: async () => undefined,
    hermesKanbanArchive: async () => undefined,
    validateHermesArgs: (args) => args,
    runHermesSessions: async () => '',
  },
};

const { app } = require('./server.js');

function request(port, method, p, body) {
  return new Promise((resolve, reject) => {
    const data = body ? JSON.stringify(body) : null;
    const req = http.request({
      hostname: '127.0.0.1', port, path: p, method,
      headers: data ? { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(data) } : {},
    }, (res) => {
      let chunks = '';
      res.setEncoding('utf8');
      res.on('data', (c) => (chunks += c));
      res.on('end', () => {
        try { resolve({ status: res.statusCode, body: JSON.parse(chunks) }); }
        catch { resolve({ status: res.statusCode, body: chunks }); }
      });
    });
    req.on('error', reject);
    if (data) req.write(data);
    req.end();
  });
}

async function runTests(port) {
  console.log('--- GET /api/user-role (empty) ---');
  const r0 = await request(port, 'GET', '/api/user-role');
  assert.strictEqual(r0.status, 200, `GET -> 200, got ${r0.status}`);
  assert(Array.isArray(r0.body.entries), 'entries is array');
  assert.strictEqual(r0.body.entries.length, 0, 'empty initially');
  console.log('✓ GET user-role (empty) -> 200, 0 entries');

  console.log('\n--- POST /api/user-role (create) ---');
  const entries = [
    { userId: 'user1', role: 'leader', profile: 'orchestrator', order: 0 },
    { userId: 'user2', role: 'subordinate', profile: 'backend', order: 1 },
  ];
  const r1 = await request(port, 'POST', '/api/user-role', { entries });
  assert.strictEqual(r1.status, 200, `POST -> 200, got ${r1.status}`);
  assert.strictEqual(r1.body.entries.length, 2, '2 entries saved');
  console.log('✓ POST user-role -> 200, 2 entries');

  // Verify file written
  const fileContent = JSON.parse(fs.readFileSync(rolePath, 'utf8'));
  assert.strictEqual(fileContent.entries.length, 2, 'file has 2 entries');
  console.log('✓ user_role.json written to disk');

  console.log('\n--- GET /api/user-role (after create) ---');
  const r2 = await request(port, 'GET', '/api/user-role');
  assert.strictEqual(r2.body.entries.length, 2, '2 entries returned');
  assert.strictEqual(r2.body.entries[0].profile, 'orchestrator', 'first entry profile');
  console.log('✓ GET user-role (after create) -> 200, 2 entries');

  console.log('\n--- DELETE /api/user-role/:profile ---');
  const r3 = await request(port, 'DELETE', '/api/user-role/backend');
  assert.strictEqual(r3.status, 200, `DELETE -> 200, got ${r3.status}`);
  assert.strictEqual(r3.body.entries.length, 1, '1 entry after delete');
  console.log('✓ DELETE user-role/backend -> 200, 1 entry left');

  // Delete nonexistent
  const r4 = await request(port, 'DELETE', '/api/user-role/nonexistent-xyz');
  assert.strictEqual(r4.status, 404, `DELETE nonexistent -> 404, got ${r4.status}`);
  console.log('✓ DELETE nonexistent -> 404');

  console.log('\n--- POST validation ---');
  // Too many entries
  const r5 = await request(port, 'POST', '/api/user-role', {
    entries: Array.from({ length: 5 }, (_, i) => ({ userId: `u${i}`, role: 'leader', profile: `p${i}`, order: i })),
  });
  assert.strictEqual(r5.status, 400, `>4 entries -> 400, got ${r5.status}`);
  console.log('✓ >4 entries -> 400');

  // Invalid role
  const r6 = await request(port, 'POST', '/api/user-role', {
    entries: [{ userId: 'a', role: 'admin', profile: 'p', order: 0 }],
  });
  assert.strictEqual(r6.status, 400, `invalid role -> 400, got ${r6.status}`);
  console.log('✓ invalid role -> 400');

  console.log('\nUser-role tests passed');
}

const server = app.listen(0, '127.0.0.1', async () => {
  const port = server.address().port;
  let exitCode = 0;
  try {
    await runTests(port);
  } catch (err) {
    console.error('\nUser-role test failed:', err);
    exitCode = 1;
  } finally {
    server.close();
    // Cleanup temp
    try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch {}
    process.exit(exitCode);
  }
});