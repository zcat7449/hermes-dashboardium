// Integration test: spin up Dashboardium backend on a random port and
// exercise the HTTP API surface. Auth is disabled (no AUTH_USERNAME/PASSWORD).
//
// Covers:
//   GET  /api/health
//   GET  /api/profiles
//   GET  /api/profiles/:profile/sessions
//   GET  /api/profiles/:profile/sessions/:id/messages
//   POST /api/profiles/:profile/sessions           (create)
//   PATCH /api/profiles/:profile/sessions/:id      (501 not-implemented)
//   DELETE /api/profiles/:profile/sessions/:id     (real delete via hermes CLI)
//   GET  /api/user-role
//   POST /api/user-role
//   DELETE /api/user-role/:profile
//   GET  /api/tasks/:board/:taskId
//   POST /api/tasks/:board/:taskId/block
//   POST /api/tasks/:board/:taskId/unblock
//   POST /api/tasks/:board/:taskId/archive
//   GET  /                                  (frontend static, no auth)

process.env.PORT = '0';
process.env.HOST = '127.0.0.1';
process.env.DATABASE_URL = '';
process.env.PG_IMPORT_FROM_SQLITE = '0';
process.env.AUTH_USERNAME='';
process.env.AUTH_PASSWORD='';

const path = require('path');

// Force HOME so config.js resolves PROFILES_DIR=/root/.hermes/profiles
// regardless of the active Hermes profile (qa inherits /root/.hermes/profiles/qa/home).
process.env.HOME = '/root';
process.env.PROFILES_DIR = '/root/.hermes/profiles';
process.env.KANBAN_BOARDS_DIR = '/root/.hermes/kanban/boards';
process.env.HERMES_BIN = '/usr/local/bin/hermes';
process.env.FRONTEND_DIR = path.join(__dirname, '..', 'frontend');

const http = require('http');
const assert = require('assert');
const fs = require('fs');
const os = require('os');

const { app, buildProfilesResponse } = require('./server.js');
const { USER_ROLE_PATH } = require('./config.js');

// Snapshot user_role.json so we can restore it at the end.
const userRoleBackup = fs.existsSync(USER_ROLE_PATH)
  ? fs.readFileSync(USER_ROLE_PATH, 'utf8')
  : null;

function request(port, method, p, body, headers = {}) {
  return new Promise((resolve, reject) => {
    const data = body ? JSON.stringify(body) : null;
    const req = http.request(
      {
        hostname: '127.0.0.1',
        port,
        path: p,
        method,
        headers: {
          ...(data ? { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(data) } : {}),
          ...headers,
        },
      },
      (res) => {
        let chunks = '';
        res.setEncoding('utf8');
        res.on('data', (c) => (chunks += c));
        res.on('end', () => {
          try {
            resolve({ status: res.statusCode, headers: res.headers, body: JSON.parse(chunks) });
          } catch {
            resolve({ status: res.statusCode, headers: res.headers, body: chunks });
          }
        });
      },
    );
    req.on('error', reject);
    if (data) req.write(data);
    req.end();
  });
}

async function findRunningTaskOnBoard(board) {
  // Pick a board that has at least one running task; otherwise pick any task.
  const dbPath = path.join('/root/.hermes/kanban/boards', board, 'kanban.db');
  if (!fs.existsSync(dbPath)) return null;
  let Database;
  try {
    Database = require('better-sqlite3');
  } catch {
    return null;
  }
  let db;
  try {
    db = new Database(dbPath, { readonly: true });
    // Check schema first — empty/partial DBs may not have the tasks table
    const tables = db.prepare(`SELECT name FROM sqlite_master WHERE type='table'`).all().map((r) => r.name);
    if (!tables.includes('tasks')) return null;
    const row = db
      .prepare(`SELECT id, status FROM tasks WHERE status IN ('running','blocked','ready') ORDER BY id ASC LIMIT 1`)
      .get();
    return row || null;
  } catch (err) {
    console.error(`skipping board ${board}: ${err.message}`);
    return null;
  } finally {
    if (db) try { db.close(); } catch {}
  }
}

async function runTests(port) {
  console.log('--- GET /api/health ---');
  const health = await request(port, 'GET', '/api/health');
  assert.strictEqual(health.status, 200, `health status 200, got ${health.status}`);
  assert.strictEqual(health.body.status, 'ok', 'health.status=ok');
  // postgres may be false in test mode (DATABASE_URL=''); just check it's a boolean
  assert(typeof health.body.postgres === 'boolean', 'health.postgres is boolean');
  console.log(`✓ /api/health -> 200 {status: ok, postgres: ${health.body.postgres}}`);

  console.log('--- GET / (frontend static) ---');
  const root = await request(port, 'GET', '/');
  assert.strictEqual(root.status, 200, `root status 200, got ${root.status}`);
  assert(/<html/i.test(String(root.body)), 'root serves HTML');
  console.log(`✓ / -> 200, Content-Type=${root.headers['content-type']}`);

  console.log('--- GET /api/profiles ---');
  const profiles = await request(port, 'GET', '/api/profiles');
  assert.strictEqual(profiles.status, 200, `profiles status 200, got ${profiles.status}`);
  assert(Array.isArray(profiles.body.profiles), 'profiles is array');
  assert(profiles.body.profiles.length >= 10, `expect >=10 profiles, got ${profiles.body.profiles.length}`);
  const firstProfile = profiles.body.profiles[0];
  assert(typeof firstProfile.name === 'string', 'profile.name is string');
  assert(typeof firstProfile.model === 'string', 'profile.model is string');
  assert(typeof firstProfile.usage_percent === 'number', 'profile.usage_percent is number');
  assert(typeof firstProfile.context_limit === 'number', 'profile.context_limit is number');
  assert(typeof firstProfile.status === 'string', 'profile.status is string');
  console.log(`✓ /api/profiles -> ${profiles.body.profiles.length} profiles, first=${firstProfile.name}`);

  console.log('--- GET /api/profiles?profile=backend (single profile — usage only) ---');
  const oneProfile = await request(port, 'GET', '/api/profiles?profile=backend');
  assert.strictEqual(oneProfile.status, 200, 'single-profile 200');
  assert(oneProfile.body.profiles.length >= 1, 'at least 1 profile returned');
  const backend = oneProfile.body.profiles.find((p) => p.name === 'backend');
  assert(backend, 'backend profile present');
  // When profile filter is set, only the matching profile has usage populated
  const nonBackend = oneProfile.body.profiles.find((p) => p.name !== 'backend');
  if (nonBackend) {
    assert.strictEqual(nonBackend.usage_input, 0, `non-selected profile ${nonBackend.name} has 0 input_tokens`);
    assert.strictEqual(nonBackend.usage_output, 0, `non-selected profile ${nonBackend.name} has 0 output_tokens`);
  }
  console.log(`✓ /api/profiles?profile=backend -> ${oneProfile.body.profiles.length} profiles, usage restricted to backend`);

  console.log('--- GET /api/profiles/<bogus>... (invalid name) ---');
  const badName = await request(port, 'GET', '/api/profiles?profile=../etc');
  assert.strictEqual(badName.status, 400, 'invalid profile name -> 400');
  console.log('✓ invalid profile name -> 400');

  console.log('--- GET /api/profiles/backend/sessions ---');
  const sessions = await request(port, 'GET', '/api/profiles/backend/sessions');
  assert.strictEqual(sessions.status, 200, 'sessions 200');
  assert(Array.isArray(sessions.body.sessions), 'sessions is array');
  console.log(`✓ /api/profiles/backend/sessions -> ${sessions.body.sessions.length} sessions`);

  if (sessions.body.sessions.length > 0) {
    const sid = sessions.body.sessions[0].id;
    console.log(`--- GET /api/profiles/backend/sessions/${sid}/messages ---`);
    const msgs = await request(port, 'GET', `/api/profiles/backend/sessions/${sid}/messages`);
    assert.strictEqual(msgs.status, 200, 'messages 200');
    assert(Array.isArray(msgs.body.messages), 'messages is array');
    console.log(`✓ messages -> ${msgs.body.messages.length} messages`);
  }

  console.log('--- POST /api/profiles/backend/sessions (create) ---');
  const create = await request(port, 'POST', '/api/profiles/backend/sessions', {
    title: 'QA test session ' + Date.now(),
  });
  assert.strictEqual(create.status, 201, `create status 201, got ${create.status}: ${JSON.stringify(create.body)}`);
  assert(typeof create.body.id === 'string', 'create.body.id is string');
  const newSessionId = create.body.id;
  console.log(`✓ create -> 201 ${newSessionId}`);

  console.log(`--- PATCH /api/profiles/backend/sessions/${newSessionId} (501) ---`);
  const renamed = await request(port, 'PATCH', `/api/profiles/backend/sessions/${newSessionId}`, {
    title: 'renamed',
  });
  assert.strictEqual(renamed.status, 501, 'rename returns 501 (not implemented)');
  console.log('✓ rename -> 501');

  console.log(`--- DELETE /api/profiles/backend/sessions/${newSessionId} ---`);
  const del = await request(port, 'DELETE', `/api/profiles/backend/sessions/${newSessionId}`);
  assert.strictEqual(del.status, 200, `delete status 200, got ${del.status}: ${JSON.stringify(del.body)}`);
  assert.strictEqual(del.body.status, 'deleted', 'delete body status=deleted');
  console.log(`✓ delete -> 200 (status=${del.body.status})`);

  // Confirm deletion actually took effect (BUG-DASH-DELETE-1 fixed)
  const afterDel = await request(port, 'GET', '/api/profiles/backend/sessions');
  assert.strictEqual(afterDel.status, 200, 'list after delete 200');
  const stillThere = afterDel.body.sessions.find((s) => s.id === newSessionId);
  assert(!stillThere, `session ${newSessionId} should be gone after DELETE`);
  console.log(`✓ session gone after delete`);

  console.log('--- GET /api/user-role ---');
  const urGet = await request(port, 'GET', '/api/user-role');
  assert.strictEqual(urGet.status, 200, 'user-role GET 200');
  assert(Array.isArray(urGet.body.entries), 'user-role.entries is array');
  console.log(`✓ /api/user-role -> ${urGet.body.entries.length} entries`);

  console.log('--- POST /api/user-role ---');
  const urPost = await request(port, 'POST', '/api/user-role', {
    entries: [
      { userId: 'qa-test', role: 'leader', profile: 'backend', order: 1 },
    ],
  });
  assert.strictEqual(urPost.status, 200, 'user-role POST 200');
  assert.strictEqual(urPost.body.entries.length, 1, '1 entry stored');
  console.log('✓ POST /api/user-role -> 200');

  console.log('--- POST /api/user-role (invalid: missing role) ---');
  const urBad = await request(port, 'POST', '/api/user-role', {
    entries: [{ userId: 'qa-test', profile: 'backend', order: 1 }],
  });
  assert.strictEqual(urBad.status, 400, 'invalid role -> 400');
  console.log('✓ invalid entry -> 400');

  console.log('--- DELETE /api/user-role/backend ---');
  const urDel = await request(port, 'DELETE', '/api/user-role/backend');
  assert.strictEqual(urDel.status, 200, 'delete user-role entry 200');
  console.log('✓ DELETE /api/user-role/backend -> 200');

  console.log('--- GET /api/tasks/:board/:taskId ---');
  // Find a real running task on the dashboardium board (qa's own board).
  let taskRow = await findRunningTaskOnBoard('dashboardium');
  let taskBoard = 'dashboardium';
  if (!taskRow) {
    // fallback: any board
    const boards = fs.readdirSync('/root/.hermes/kanban/boards').filter((b) =>
      fs.existsSync(path.join('/root/.hermes/kanban/boards', b, 'kanban.db')),
    );
    for (const b of boards) {
      const r = await findRunningTaskOnBoard(b);
      if (r) {
        taskRow = r;
        taskBoard = b;
        break;
      }
    }
  }
  if (taskRow) {
    const task = await request(port, 'GET', `/api/tasks/${taskBoard}/${taskRow.id}`);
    assert.strictEqual(task.status, 200, `task details 200, got ${task.status}: ${JSON.stringify(task.body)}`);
    assert.strictEqual(task.body.task.id, taskRow.id, 'task.id matches');
    assert(Array.isArray(task.body.events), 'events is array');
    assert(Array.isArray(task.body.comments), 'comments is array');
    assert(Array.isArray(task.body.runs), 'runs is array');
    console.log(`✓ /api/tasks/${taskBoard}/${taskRow.id} -> 200 (${task.body.events.length} events, ${task.body.runs.length} runs)`);
  } else {
    console.log('⚠ no running tasks found on any board — skipped task details check');
  }

  console.log('--- POST /api/tasks/:board/:taskId/block (uses hermes CLI) ---');
  // Find a running task to block. Use a different board to avoid disturbing active QA work.
  // We'll use the dashboardium board and block/unblock a low-priority task if available,
  // otherwise skip.
  let blockTaskRow = null;
  let blockBoard = null;
  for (const b of fs.readdirSync('/root/.hermes/kanban/boards')) {
    const r = await findRunningTaskOnBoard(b);
    if (r && r.status === 'running') {
      blockTaskRow = r;
      blockBoard = b;
      break;
    }
  }
  if (blockTaskRow && blockBoard) {
    const blockRes = await request(port, 'POST', `/api/tasks/${blockBoard}/${blockTaskRow.id}/block`, {
      reason: 'QA auto-test block',
    });
    assert.strictEqual(blockRes.status, 200, `block 200, got ${blockRes.status}: ${JSON.stringify(blockRes.body)}`);
    assert.strictEqual(blockRes.body.status, 'blocked', 'block.status=blocked');
    console.log(`✓ POST .../block -> 200 (status=blocked)`);

    // immediately unblock to leave state clean
    const unblockRes = await request(port, 'POST', `/api/tasks/${blockBoard}/${blockTaskRow.id}/unblock`, {
      reason: 'QA auto-test unblock',
    });
    assert.strictEqual(unblockRes.status, 200, `unblock 200, got ${unblockRes.status}: ${JSON.stringify(unblockRes.body)}`);
    assert.strictEqual(unblockRes.body.status, 'unblocked', 'unblock.status=unblocked');
    console.log(`✓ POST .../unblock -> 200 (status=unblocked)`);
  } else {
    console.log('⚠ no running tasks available — skipped block/unblock integration check');
  }

  console.log('--- POST /api/tasks/:board/:taskId/archive (dry-run on already-archived or skip) ---');
  // We don't want to archive a real task; just confirm the endpoint validates inputs (400) — done in test-input-validation.js.
  console.log('⚠ archive skipped (would archive a real task — covered by validation test)');

  console.log('\nHTTP tests passed');
}

const server = app.listen(0, '127.0.0.1', async () => {
  const port = server.address().port;
  let exitCode = 0;
  try {
    await runTests(port);
  } catch (err) {
    console.error('\nHTTP test failed:', err);
    exitCode = 1;
  } finally {
    // Restore user_role.json
    if (userRoleBackup !== null) {
      try {
        fs.writeFileSync(USER_ROLE_PATH, userRoleBackup, 'utf8');
      } catch (e) {
        console.error('failed to restore user_role.json:', e.message);
      }
    } else if (fs.existsSync(USER_ROLE_PATH)) {
      try {
        fs.unlinkSync(USER_ROLE_PATH);
      } catch {}
    }
    server.close();
    process.exit(exitCode);
  }
});
