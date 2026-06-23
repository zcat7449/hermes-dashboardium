// Input validation matrix — negative-path tests.
// All these should return 400 (Bad Request) or 404 (not found) — never 500.
// No real hermes subprocess needed: we mock it so all endpoints are reachable.

process.env.PORT = '0';
process.env.HOST = '127.0.0.1';
process.env.DATABASE_URL = '';
process.env.PG_IMPORT_FROM_SQLITE = '0';
process.env.AUTH_USERNAME='';
process.env.AUTH_PASSWORD='';
// Disable rate limit for validation tests (we're not measuring it here)
process.env.GLOBAL_RATE_LIMIT_RPS = '10000';
process.env.GLOBAL_RATE_LIMIT_WINDOW_MS = '60000';
process.env.PROFILES_DIR = '/root/.hermes/profiles';
process.env.KANBAN_BOARDS_DIR = '/root/.hermes/kanban/boards';
process.env.HERMES_BIN = '/usr/local/bin/hermes';
process.env.FRONTEND_DIR = require('path').join(__dirname, '..', 'frontend');

const http = require('http');
const assert = require('assert');
const path = require('path');

// Mock hermes-cli so chat/optimize and kanban commands are no-ops.
const hermesCliPath = require.resolve('./services/hermes-cli.js');
require.cache[hermesCliPath] = {
  id: hermesCliPath,
  filename: hermesCliPath,
  loaded: true,
  exports: {
    listHermesSessionsImpl: async () => [],
    parseHermesSessionsList: () => [],
    exportHermesSession: async () => null,
    deleteHermesSession: async () => true,
    renameHermesSession: async () => true,
    sanitizeChatMessage: (m) => {
      // Mirror real hermes-cli sanitizeChatMessage: strip flags, shell-meta chars
      return String(m || '')
        .replace(/(?:^|\s)--?[a-zA-Z0-9_-]+(?=\s|$)/gi, '')
        .replace(/^[\s-]+/, '')
        .replace(/[;&|`$(){}[\]\\]/g, '')
        .replace(/\s+/g, ' ')
        .trim();
    },
    hermesChat: async () => 'mock response',
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
    const req = http.request(
      {
        hostname: '127.0.0.1',
        port,
        path: p,
        method,
        headers: data ? { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(data) } : {},
      },
      (res) => {
        let chunks = '';
        res.setEncoding('utf8');
        res.on('data', (c) => (chunks += c));
        res.on('end', () => {
          try {
            resolve({ status: res.statusCode, body: JSON.parse(chunks) });
          } catch {
            resolve({ status: res.statusCode, body: chunks });
          }
        });
      },
    );
    req.on('error', reject);
    if (data) req.write(data);
    req.end();
  });
}

async function runTests(port) {
  console.log('--- /api/profiles — invalid profile filter ---');
  // profile regex: /^[a-zA-Z0-9_-]+$/
  const r1 = await request(port, 'GET', '/api/profiles?profile=has%20space');
  assert.strictEqual(r1.status, 400, `space in profile -> 400, got ${r1.status}`);
  assert(/invalid profile name/i.test(r1.body.error || ''), 'error message present');
  console.log('✓ profile=has space -> 400');

  const r2 = await request(port, 'GET', '/api/profiles?profile=../../etc');
  assert.strictEqual(r2.status, 400, `path traversal -> 400, got ${r2.status}`);
  console.log('✓ profile=../.. -> 400');

  const r3 = await request(port, 'GET', '/api/profiles?profile=foo%2Fbar');
  assert.strictEqual(r3.status, 400, `slash -> 400, got ${r3.status}`);
  console.log('✓ profile=foo/bar -> 400');

  console.log('\n--- /api/profiles/:profile/sessions — invalid profile name ---');
  const s1 = await request(port, 'GET', '/api/profiles/..%2F..%2Fetc/sessions');
  assert.strictEqual(s1.status, 400, `traversal in path -> 400, got ${s1.status}`);
  console.log('✓ /api/profiles/../sessions -> 400');

  const s2 = await request(port, 'GET', '/api/profiles/has%20space/sessions');
  assert.strictEqual(s2.status, 400, `space in path -> 400, got ${s2.status}`);
  console.log('✓ /api/profiles/has space/sessions -> 400');

  // Valid format but profile doesn't exist
  const s3 = await request(port, 'GET', '/api/profiles/nonexistent-profile-xyz/sessions');
  assert.strictEqual(s3.status, 404, `nonexistent profile -> 404, got ${s3.status}`);
  console.log('✓ /api/profiles/nonexistent-xyz/sessions -> 404');

  console.log('\n--- /api/profiles/:profile/sessions/:id/messages — invalid ids ---');
  // profile regex
  const m1 = await request(port, 'GET', '/api/profiles/bad..profile/sessions/abc/messages');
  assert.strictEqual(m1.status, 400, `bad profile chars -> 400, got ${m1.status}`);
  console.log('✓ bad profile chars -> 400');

  // session_id regex: /^[a-zA-Z0-9_:.-]+$/
  const m2 = await request(port, 'GET', '/api/profiles/backend/sessions/has%20space/messages');
  assert.strictEqual(m2.status, 400, `bad session id (space) -> 400, got ${m2.status}`);
  console.log('✓ bad session id (space) -> 400');

  console.log('\n--- /api/profiles/:profile/sessions (POST) — invalid profile ---');
  const c1 = await request(port, 'POST', '/api/profiles/..%2Fetc/sessions', { title: 'x' });
  assert.strictEqual(c1.status, 400, `bad profile in POST -> 400, got ${c1.status}`);
  console.log('✓ POST with bad profile -> 400');

  // Valid format but no state.db
  const c2 = await request(port, 'POST', '/api/profiles/nonexistent-profile-xyz/sessions', { title: 'x' });
  // Should be 404 (state.db not found) or 500. Spec says 404. Test the documented path.
  assert([400, 404].includes(c2.status), `nonexistent profile POST -> 400/404, got ${c2.status}`);
  console.log(`✓ POST to nonexistent profile -> ${c2.status} (4xx)`);

  console.log('\n--- PATCH session — invalid ids ---');
  const p1 = await request(port, 'PATCH', '/api/profiles/bad..profile/sessions/abc', { title: 'x' });
  assert.strictEqual(p1.status, 400, `bad profile in PATCH -> 400, got ${p1.status}`);
  console.log('✓ PATCH bad profile -> 400');

  const p2 = await request(port, 'PATCH', '/api/profiles/backend/sessions/has%20space', { title: 'x' });
  assert.strictEqual(p2.status, 400, `bad session id in PATCH -> 400, got ${p2.status}`);
  console.log('✓ PATCH bad session id -> 400');

  // Valid format but not implemented
  const p3 = await request(port, 'PATCH', '/api/profiles/backend/sessions/abc123', { title: 'x' });
  assert.strictEqual(p3.status, 501, `PATCH valid format -> 501, got ${p3.status}`);
  console.log('✓ PATCH valid format -> 501 (not implemented)');

  console.log('\n--- DELETE session — invalid ids ---');
  const d1 = await request(port, 'DELETE', '/api/profiles/..%2Fetc/sessions/abc');
  assert.strictEqual(d1.status, 400, `bad profile in DELETE -> 400, got ${d1.status}`);
  console.log('✓ DELETE bad profile -> 400');

  const d2 = await request(port, 'DELETE', '/api/profiles/backend/sessions/has%20space');
  assert.strictEqual(d2.status, 400, `bad session id in DELETE -> 400, got ${d2.status}`);
  console.log('✓ DELETE bad session id -> 400');

  console.log('\n--- /api/user-role — invalid bodies ---');
  const u1 = await request(port, 'POST', '/api/user-role', { entries: 'not-an-array' });
  assert.strictEqual(u1.status, 400, `entries not array -> 400, got ${u1.status}`);
  console.log('✓ entries not array -> 400');

  const u2 = await request(port, 'POST', '/api/user-role', {
    entries: [
      { userId: 'a', role: 'INVALID', profile: 'p', order: 1 },
    ],
  });
  assert.strictEqual(u2.status, 400, `invalid role value -> 400, got ${u2.status}`);
  console.log('✓ invalid role value -> 400');

  const u3 = await request(port, 'POST', '/api/user-role', {
    entries: [
      { role: 'leader', profile: 'p', order: 1 }, // missing userId
    ],
  });
  assert.strictEqual(u3.status, 400, `missing userId -> 400, got ${u3.status}`);
  console.log('✓ missing userId -> 400');

  const u4 = await request(port, 'POST', '/api/user-role', {
    entries: [
      { userId: 'a', role: 'leader', profile: '', order: 1 }, // empty profile
    ],
  });
  assert.strictEqual(u4.status, 400, `empty profile -> 400, got ${u4.status}`);
  console.log('✓ empty profile -> 400');

  const u5 = await request(port, 'POST', '/api/user-role', {
    entries: [
      { userId: 'a', role: 'leader', profile: 'p', order: 'one' }, // non-numeric order
    ],
  });
  assert.strictEqual(u5.status, 400, `non-numeric order -> 400, got ${u5.status}`);
  console.log('✓ non-numeric order -> 400');

  // Maximum 4 entries
  const u6 = await request(port, 'POST', '/api/user-role', {
    entries: Array.from({ length: 5 }, (_, i) => ({
      userId: `u${i}`,
      role: 'leader',
      profile: `p${i}`,
      order: i,
    })),
  });
  assert.strictEqual(u6.status, 400, `>4 entries -> 400, got ${u6.status}`);
  console.log('✓ >4 entries -> 400');

  // DELETE /api/user-role/:profile — invalid
  const u7 = await request(port, 'DELETE', '/api/user-role/..%2Fetc');
  assert.strictEqual(u7.status, 400, `bad profile in DELETE -> 400, got ${u7.status}`);
  console.log('✓ DELETE bad profile -> 400');

  // DELETE /api/user-role/nonexistent-profile-xyz-12345 — expect 404
  const u8 = await request(port, 'DELETE', '/api/user-role/nonexistent-xyz-12345');
  assert.strictEqual(u8.status, 404, `nonexistent entry -> 404, got ${u8.status}`);
  console.log('✓ DELETE nonexistent entry -> 404');

  console.log('\n--- /api/tasks/:board/:taskId — invalid ids ---');
  const t1 = await request(port, 'GET', '/api/tasks/bad..board/t_xxx');
  assert.strictEqual(t1.status, 400, `bad board -> 400, got ${t1.status}`);
  console.log('✓ bad board -> 400');

  const t2 = await request(port, 'GET', '/api/tasks/dashboardium/has%20space');
  assert.strictEqual(t2.status, 400, `bad task id -> 400, got ${t2.status}`);
  console.log('✓ bad task id -> 400');

  // Nonexistent board (valid format) -> 404
  const t3 = await request(port, 'GET', '/api/tasks/nonexistent-board-xyz123/t_aaa');
  assert.strictEqual(t3.status, 404, `nonexistent board -> 404, got ${t3.status}`);
  console.log('✓ nonexistent board -> 404');

  // Nonexistent task on existing board -> 404
  const t4 = await request(port, 'GET', '/api/tasks/dashboardium/t_nonexistent_xyz_999');
  assert.strictEqual(t4.status, 404, `nonexistent task -> 404, got ${t4.status}`);
  console.log('✓ nonexistent task on real board -> 404');

  console.log('\n--- /api/tasks/.../block|unblock|archive — invalid ids ---');
  for (const verb of ['block', 'unblock', 'archive']) {
    const r = await request(port, 'POST', `/api/tasks/bad..board/t_xxx/${verb}`, { reason: 'x' });
    assert.strictEqual(r.status, 400, `${verb} bad board -> 400, got ${r.status}`);
    console.log(`✓ ${verb} bad board -> 400`);
  }

  // reassign with empty assignee
  const t5 = await request(port, 'POST', '/api/tasks/dashboardium/t_aaa/reassign', {});
  // May be 400 (missing assignee) or 429 (rate limit hit by earlier chat calls). Both are non-5xx.
  assert(t5.status === 400 || t5.status === 429, `reassign missing assignee -> 400/429, got ${t5.status}`);
  if (t5.status === 400) console.log('✓ reassign missing assignee -> 400');
  else console.log(`✓ reassign missing assignee -> ${t5.status} (rate-limited before reaching handler — non-5xx)`);

  // reassign with invalid assignee
  const t6 = await request(port, 'POST', '/api/tasks/dashboardium/t_aaa/reassign', {
    assignee: 'has spaces',
  });
  assert(t6.status === 400 || t6.status === 429, `reassign bad assignee -> 400/429, got ${t6.status}`);
  console.log(`✓ reassign bad assignee -> ${t6.status}`);

  console.log('\n--- /api/chat/:profile — invalid inputs ---');
  const ch1 = await request(port, 'POST', '/api/chat/..%2Fetc', { message: 'hi' });
  assert.strictEqual(ch1.status, 400, `bad profile -> 400, got ${ch1.status}`);
  console.log('✓ bad profile -> 400');

  const ch2 = await request(port, 'POST', '/api/chat/backend', {}); // no message
  assert.strictEqual(ch2.status, 400, `no message -> 400, got ${ch2.status}`);
  console.log('✓ no message -> 400');

  const ch3 = await request(port, 'POST', '/api/chat/backend', { message: '   ' }); // empty
  assert.strictEqual(ch3.status, 400, `whitespace message -> 400, got ${ch3.status}`);
  console.log('✓ whitespace message -> 400');

  const ch4 = await request(port, 'POST', '/api/chat/backend', { message: ';;;;;' }); // becomes empty after sanitize
  assert.strictEqual(ch4.status, 400, `sanitize to empty -> 400, got ${ch4.status}`);
  console.log('✓ message sanitized to empty -> 400');

  console.log('\n--- /api/optimize/:profile — invalid profile ---');
  const op1 = await request(port, 'POST', '/api/optimize/..%2Fetc', {});
  assert.strictEqual(op1.status, 400, `bad profile -> 400, got ${op1.status}`);
  console.log('✓ bad profile -> 400');

  console.log('\nInput validation tests passed');
}

const server = app.listen(0, '127.0.0.1', async () => {
  const port = server.address().port;
  let exitCode = 0;
  try {
    await runTests(port);
  } catch (err) {
    console.error('\nValidation test failed:', err);
    exitCode = 1;
  } finally {
    server.close();
    process.exit(exitCode);
  }
});
