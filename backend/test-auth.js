// Basic Auth matrix tests.
// Boots the backend in-process with AUTH_USERNAME/PASSWORD set, exercises the
// middleware behaviour across public, protected, and websocket paths.
//
// Auth contract:
//   - /api/health, /ws, frontend static -> no auth
//   - everything else under /api -> Basic Auth required
//   - 401 with WWW-Authenticate: Basic realm="Dashboardium"
//   - 401 with bad credentials
//   - 200 with correct credentials

process.env.PORT = '0';
process.env.HOST = '127.0.0.1';
process.env.DATABASE_URL = '';
process.env.PG_IMPORT_FROM_SQLITE = '0';
process.env.AUTH_USERNAME = 'qa-test-user';
process.env.AUTH_PASSWORD = 'qa-test-pass';
process.env.HOME = '/root';
process.env.PROFILES_DIR = '/root/.hermes/profiles';
process.env.KANBAN_BOARDS_DIR = '/root/.hermes/kanban/boards';
process.env.HERMES_BIN = '/usr/local/bin/hermes';
process.env.FRONTEND_DIR = require('path').join(__dirname, '..', 'frontend');

const http = require('http');
const assert = require('assert');

const { app } = require('./server.js');

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

const basic = (u, p) => 'Basic ' + Buffer.from(`${u}:${p}`).toString('base64');

async function runTests(port) {
  console.log('--- Public paths (no auth required) ---');

  const health = await request(port, 'GET', '/api/health');
  assert.strictEqual(health.status, 200, `/api/health must be 200 without auth, got ${health.status}`);
  assert.strictEqual(health.body.status, 'ok', 'health.status=ok');
  console.log(`✓ GET /api/health (no auth) -> 200`);

  const root = await request(port, 'GET', '/');
  assert.strictEqual(root.status, 200, `/ must be 200 without auth, got ${root.status}`);
  console.log(`✓ GET / (no auth) -> 200`);

  // /public static (subdir of frontend)
  const pub = await request(port, 'GET', '/public/');
  // Either 200 (index exists) or 404 (no index) — both are "not 401"
  assert.notStrictEqual(pub.status, 401, `/public must not require auth, got 401`);
  console.log(`✓ GET /public/ (no auth) -> ${pub.status} (not 401)`);

  console.log('\n--- Protected API: 401 without credentials ---');

  const noAuth = await request(port, 'GET', '/api/profiles');
  assert.strictEqual(noAuth.status, 401, `/api/profiles without auth must be 401, got ${noAuth.status}`);
  assert.strictEqual(
    noAuth.headers['www-authenticate'],
    'Basic realm="Dashboardium"',
    'WWW-Authenticate header set',
  );
  console.log(`✓ GET /api/profiles (no auth) -> 401, WWW-Authenticate set`);

  const noAuthTasks = await request(port, 'GET', '/api/tasks/dashboardium/t_aaa');
  assert.strictEqual(noAuthTasks.status, 401, 'tasks endpoint requires auth');
  console.log(`✓ GET /api/tasks/.../... (no auth) -> 401`);

  const noAuthSessions = await request(port, 'GET', '/api/profiles/backend/sessions');
  assert.strictEqual(noAuthSessions.status, 401, 'sessions list requires auth');
  console.log(`✓ GET /api/profiles/backend/sessions (no auth) -> 401`);

  console.log('\n--- Protected API: 401 with bad credentials ---');

  const badCreds = await request(port, 'GET', '/api/profiles', null, {
    Authorization: basic('wrong', 'creds'),
  });
  assert.strictEqual(badCreds.status, 401, `bad creds -> 401, got ${badCreds.status}`);
  assert.strictEqual(
    badCreds.headers['www-authenticate'],
    'Basic realm="Dashboardium"',
    'WWW-Authenticate set on bad creds',
  );
  console.log(`✓ GET /api/profiles (bad creds) -> 401`);

  // Malformed header — missing Basic prefix
  const malformed = await request(port, 'GET', '/api/profiles', null, {
    Authorization: 'Bearer xyz',
  });
  assert.strictEqual(malformed.status, 401, `malformed auth header -> 401, got ${malformed.status}`);
  console.log(`✓ GET /api/profiles (Bearer token, not Basic) -> 401`);

  // Malformed base64
  const badB64 = await request(port, 'GET', '/api/profiles', null, {
    Authorization: 'Basic !!notbase64!!',
  });
  assert.strictEqual(badB64.status, 401, `bad base64 -> 401, got ${badB64.status}`);
  console.log(`✓ GET /api/profiles (bad base64) -> 401`);

  // Missing colon in decoded user:pass
  const noColon = await request(port, 'GET', '/api/profiles', null, {
    Authorization: 'Basic ' + Buffer.from('nocolon').toString('base64'),
  });
  assert.strictEqual(noColon.status, 401, `no colon -> 401, got ${noColon.status}`);
  console.log(`✓ GET /api/profiles (no colon in user:pass) -> 401`);

  console.log('\n--- Protected API: 200 with correct credentials ---');

  const ok = await request(port, 'GET', '/api/profiles', null, {
    Authorization: basic('qa-test-user', 'qa-test-pass'),
  });
  assert.strictEqual(ok.status, 200, `correct creds -> 200, got ${ok.status}: ${JSON.stringify(ok.body)}`);
  assert(Array.isArray(ok.body.profiles), 'profiles is array');
  console.log(`✓ GET /api/profiles (correct creds) -> 200, ${ok.body.profiles.length} profiles`);

  const okUserRole = await request(port, 'GET', '/api/user-role', null, {
    Authorization: basic('qa-test-user', 'qa-test-pass'),
  });
  assert.strictEqual(okUserRole.status, 200, 'user-role GET with auth -> 200');
  console.log(`✓ GET /api/user-role (correct creds) -> 200`);

  // All /api/health variants: with or without auth, always 200 (allowlisted)
  const healthWithAuth = await request(port, 'GET', '/api/health', null, {
    Authorization: basic('qa-test-user', 'qa-test-pass'),
  });
  assert.strictEqual(healthWithAuth.status, 200, '/api/health with auth -> 200');
  console.log(`✓ GET /api/health (with auth) -> 200 (allowlist works)`);

  // CORS preflight OPTIONS /api/* — should not be blocked by auth (cors middleware runs first)
  const cors = await request(port, 'OPTIONS', '/api/profiles');
  assert(cors.status === 200 || cors.status === 204, `CORS preflight ${cors.status}`);
  console.log(`✓ OPTIONS /api/profiles (no auth) -> ${cors.status} (cors middleware, not blocked)`);

  console.log('\nAuth matrix tests passed');
}

const server = app.listen(0, '127.0.0.1', async () => {
  const port = server.address().port;
  let exitCode = 0;
  try {
    await runTests(port);
  } catch (err) {
    console.error('\nAuth test failed:', err);
    exitCode = 1;
  } finally {
    server.close();
    process.exit(exitCode);
  }
});
