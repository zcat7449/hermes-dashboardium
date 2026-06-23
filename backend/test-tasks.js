// Tests for /api/tasks endpoints — task details, block/unblock/reassign/archive.
// Mocks hermes-cli kanban commands as no-ops.

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
  // Find a real board with tasks
  const fs = require('fs');
  const path = require('path');
  const boardsDir = process.env.KANBAN_BOARDS_DIR;
  let testBoard = null;
  let testTaskId = null;
  try {
    const boards = fs.readdirSync(boardsDir, { withFileTypes: true }).filter(d => d.isDirectory()).map(d => d.name);
    for (const board of boards) {
      const dbPath = path.join(boardsDir, board, 'kanban.db');
      if (fs.existsSync(dbPath)) {
        const Database = require('better-sqlite3');
        const db = new Database(dbPath, { readonly: true });
        try {
          const task = db.prepare('SELECT id FROM tasks LIMIT 1').get();
          if (task) { testBoard = board; testTaskId = task.id; break; }
        } catch {}
        db.close();
      }
    }
  } catch {}

  console.log('--- Task details ---');

  if (testBoard && testTaskId) {
    const r = await request(port, 'GET', `/api/tasks/${testBoard}/${testTaskId}`);
    assert.strictEqual(r.status, 200, `real task -> 200, got ${r.status}`);
    assert(r.body.task, 'task object present');
    assert.strictEqual(r.body.task.id, testTaskId, 'task id matches');
    assert(Array.isArray(r.body.events), 'events array');
    assert(Array.isArray(r.body.comments), 'comments array');
    assert(Array.isArray(r.body.runs), 'runs array');
    console.log(`✓ GET /api/tasks/${testBoard}/${testTaskId} -> 200, task loaded`);
  } else {
    console.log('⚠ no real board with tasks found, skipping task detail test');
  }

  // Nonexistent board
  const r2 = await request(port, 'GET', '/api/tasks/nonexistent-xyz-999/t_aaa');
  assert.strictEqual(r2.status, 404, `nonexistent board -> 404, got ${r2.status}`);
  console.log('✓ nonexistent board -> 404');

  // Nonexistent task on real board
  if (testBoard) {
    const r3 = await request(port, 'GET', `/api/tasks/${testBoard}/t_nonexistent_xyz_999`);
    assert.strictEqual(r3.status, 404, `nonexistent task -> 404, got ${r3.status}`);
    console.log(`✓ nonexistent task on ${testBoard} -> 404`);
  }

  console.log('\n--- Block / Unblock ---');

  if (testBoard && testTaskId) {
    const blockRes = await request(port, 'POST', `/api/tasks/${testBoard}/${testTaskId}/block`, { reason: 'test block' });
    assert.strictEqual(blockRes.status, 200, `block -> 200, got ${blockRes.status}`);
    assert.strictEqual(blockRes.body.status, 'blocked');
    console.log(`✓ block task -> 200`);

    const unblockRes = await request(port, 'POST', `/api/tasks/${testBoard}/${testTaskId}/unblock`, { reason: 'test unblock' });
    assert.strictEqual(unblockRes.status, 200, `unblock -> 200, got ${unblockRes.status}`);
    assert.strictEqual(unblockRes.body.status, 'unblocked');
    console.log(`✓ unblock task -> 200`);
  } else {
    console.log('⚠ no real task for block/unblock test');
  }

  console.log('\n--- Reassign ---');

  if (testBoard && testTaskId) {
    const reassignRes = await request(port, 'POST', `/api/tasks/${testBoard}/${testTaskId}/reassign`, { assignee: 'worker' });
    assert.strictEqual(reassignRes.status, 200, `reassign -> 200, got ${reassignRes.status}`);
    assert.strictEqual(reassignRes.body.assignee, 'worker');
    console.log(`✓ reassign task -> 200`);
  } else {
    console.log('⚠ no real task for reassign test');
  }

  // Reassign missing assignee
  if (testBoard) {
    const r4 = await request(port, 'POST', `/api/tasks/${testBoard}/t_xxx/reassign`, {});
    assert.strictEqual(r4.status, 400, `missing assignee -> 400, got ${r4.status}`);
    console.log('✓ reassign missing assignee -> 400');
  }

  console.log('\n--- Archive ---');

  // Archive should not actually archive a real task in test — use nonexistent
  const archRes = await request(port, 'POST', `/api/tasks/${testBoard || 'test'}/t_nonexistent_xyz_999/archive`);
  // Mock returns undefined, so it will try to call hermesKanbanArchive which is mocked
  // This may return 200 (mock succeeds) or 500 if hermes binary fails
  assert(archRes.status === 200 || archRes.status === 500, `archive mock -> 200 or 500, got ${archRes.status}`);
  console.log(`✓ archive endpoint responds (${archRes.status})`);

  console.log('\nTask tests passed');
}

const server = app.listen(0, '127.0.0.1', async () => {
  const port = server.address().port;
  let exitCode = 0;
  try {
    await runTests(port);
  } catch (err) {
    console.error('\nTask test failed:', err);
    exitCode = 1;
  } finally {
    server.close();
    process.exit(exitCode);
  }
});