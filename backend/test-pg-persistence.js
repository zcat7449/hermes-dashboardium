// Test PG persistence functions in db.js.
// Strategy (Variant C): mock the `pg` module's Pool BEFORE requiring db.js,
// set DATABASE_URL to a dummy string, then call initPostgres() so that
// pgAvailable becomes true and the internal module-private query() routes
// through getPool().query() → our mock. This avoids the fragile monkey-patch
// of db.query (which doesn't intercept internal calls).
//
// If DATABASE_URL is already set in the environment (real PG), we skip the
// mock and run against the real DB instead.
process.env.PORT = '0';
process.env.HOST = '127.0.0.1';

const assert = require('assert');

// ── In-memory PG mock ──────────────────────────────────────────────────
//
// Simulates the subset of pg.Pool.query() behaviour used by the persistence
// functions: parameterized ($1..$N) INSERT / UPDATE / SELECT with .rows.

function createMockPg() {
  const sessions = new Map();   // pk = id
  const messages = [];          // array of message rows
  let msgSeq = 0;

  // Parse a single-quoted SQL string literal back to a JS value.
  function unquoteSql(literal) {
    if (literal === 'NULL') return null;
    if (literal.startsWith("'")) {
      return literal.slice(1, -1).replace(/''/g, "'");
    }
    const n = Number(literal);
    if (!isNaN(n) && literal !== '') return n;
    return literal;
  }

  function exec(text, params) {
    params = params || [];
    // Normalize: replace $N placeholders with params[N-1].
    // Use SQL-style single-quoted strings for text values (so the regex
    // matchers below that expect '...' work consistently).
    let sql = text.replace(/\$(\d+)/g, (_, n) => {
      const v = params[parseInt(n, 10) - 1];
      if (v === null || v === undefined) return 'NULL';
      if (typeof v === 'number') return String(v);
      // string: single-quote and escape embedded single quotes
      return "'" + String(v).replace(/'/g, "''") + "'";
    });
    sql = sql.trim().replace(/;$/, '');

    // DDL statements (migrations) — just no-op
    if (/^(CREATE TABLE|CREATE INDEX|ALTER TABLE|CREATE DATABASE|DROP)/i.test(sql)) {
      return { rows: [] };
    }

    // SELECT ... FROM sessions WHERE id = '...' AND profile = '...'
    if (/^SELECT/i.test(sql) && /FROM sessions/i.test(sql) && /WHERE id\s*=/i.test(sql) && /profile\s*=/i.test(sql) && !/ORDER BY/i.test(sql)) {
      const idMatch = sql.match(/WHERE id\s*=\s*('[^']*')/);
      const profMatch = sql.match(/profile\s*=\s*('[^']*')/);
      if (idMatch && profMatch) {
        const id = unquoteSql(idMatch[1]);
        const profile = unquoteSql(profMatch[1]);
        const row = sessions.get(id);
        if (row && row.profile === profile) {
          return { rows: [row] };
        }
        return { rows: [] };
      }
    }

    // SELECT ... FROM sessions WHERE profile = '...' ORDER BY started_at DESC
    if (/^SELECT/i.test(sql) && /FROM sessions/i.test(sql) && /WHERE profile\s*=/i.test(sql) && /ORDER BY/i.test(sql)) {
      const profMatch = sql.match(/profile\s*=\s*('[^']*')/);
      const profile = profMatch ? unquoteSql(profMatch[1]) : null;
      const rows = [];
      for (const row of sessions.values()) {
        if (row.profile === profile) rows.push(row);
      }
      rows.sort((a, b) => b.started_at - a.started_at);
      return { rows };
    }

    // INSERT INTO sessions ...
    if (/^INSERT\s+INTO\s+sessions/i.test(sql)) {
      const valsMatch = sql.match(/VALUES\s*\(([^)]*)\)/);
      if (!valsMatch) throw new Error('mock: cannot parse INSERT values');
      const rawVals = valsMatch[1];
      const colsMatch = sql.match(/INSERT\s+INTO\s+sessions\s*\(([^)]*)\)/);
      const cols = colsMatch[1].split(',').map(s => s.trim());
      const vals = parseValues(rawVals);

      const row = {};
      cols.forEach((c, i) => { row[c] = vals[i]; });

      // ON CONFLICT (id) DO NOTHING
      if (/ON CONFLICT.*DO NOTHING/i.test(sql)) {
        if (sessions.has(row.id)) return { rows: [], rowCount: 0 };
      }
      sessions.set(row.id, row);
      return { rows: [row], rowCount: 1 };
    }

    // UPDATE sessions SET title = '...' WHERE id = '...' AND profile = '...'
    if (/^UPDATE\s+sessions\s+SET\s+title/i.test(sql)) {
      const titleMatch = sql.match(/title\s*=\s*('[^']*')/);
      const idMatch = sql.match(/WHERE id\s*=\s*('[^']*')/);
      const profMatch = sql.match(/profile\s*=\s*('[^']*')/);
      if (idMatch && profMatch) {
        const id = unquoteSql(idMatch[1]);
        const profile = unquoteSql(profMatch[1]);
        const row = sessions.get(id);
        if (row && row.profile === profile) {
          row.title = titleMatch ? unquoteSql(titleMatch[1]) : row.title;
          return { rows: [row], rowCount: 1 };
        }
      }
      return { rows: [], rowCount: 0 };
    }

    // UPDATE sessions SET archived = 1 WHERE id = '...' AND profile = '...'
    if (/^UPDATE\s+sessions\s+SET\s+archived/i.test(sql)) {
      const idMatch = sql.match(/WHERE id\s*=\s*('[^']*')/);
      const profMatch = sql.match(/profile\s*=\s*('[^']*')/);
      if (idMatch && profMatch) {
        const id = unquoteSql(idMatch[1]);
        const profile = unquoteSql(profMatch[1]);
        const row = sessions.get(id);
        if (row && row.profile === profile) {
          row.archived = 1;
          return { rows: [row], rowCount: 1 };
        }
      }
      return { rows: [], rowCount: 0 };
    }

    // INSERT INTO session_messages ...
    if (/^INSERT\s+INTO\s+session_messages/i.test(sql)) {
      const valsMatch = sql.match(/VALUES\s*\(([^)]*)\)/);
      if (!valsMatch) throw new Error('mock: cannot parse INSERT session_messages values');
      const colsMatch = sql.match(/INSERT\s+INTO\s+session_messages\s*\(([^)]*)\)/);
      const cols = colsMatch[1].split(',').map(s => s.trim());
      const vals = parseValues(valsMatch[1]);
      const row = {};
      cols.forEach((c, i) => { row[c] = vals[i]; });
      row.id = ++msgSeq;
      messages.push(row);
      return { rows: [row], rowCount: 1 };
    }

    // DELETE (cleanup) — no-op in mock
    if (/^DELETE/i.test(sql)) {
      return { rows: [], rowCount: 0 };
    }

    throw new Error('mock: unhandled SQL: ' + sql.substring(0, 80));
  }

  function parseValues(str) {
    // Split by comma, but handle NULL and single-quoted strings
    const parts = [];
    let current = '';
    let inStr = false;
    for (let i = 0; i < str.length; i++) {
      const ch = str[i];
      if (ch === "'" && str[i - 1] !== '\\') { inStr = !inStr; current += ch; continue; }
      if (ch === ',' && !inStr) { parts.push(current.trim()); current = ''; continue; }
      current += ch;
    }
    parts.push(current.trim());
    return parts.map(v => {
      if (v === 'NULL') return null;
      if (v.startsWith("'")) {
        // single-quoted SQL string: strip quotes and unescape ''
        return v.slice(1, -1).replace(/''/g, "'");
      }
      const n = Number(v);
      if (!isNaN(n) && v !== '') return n;
      return v;
    });
  }

  return {
    sessions,
    messages,
    query: async (text, params) => exec(text, params),
  };
}

// ── Test runner ────────────────────────────────────────────────────────

async function runWithMock() {
  // Variant C: mock pg.Pool BEFORE requiring db.js.
  // Set DATABASE_URL so db.js attempts PG init.
  process.env.DATABASE_URL = 'postgresql://mock:mock@localhost:5432/mock';

  const pg = require('pg');
  const OriginalPool = pg.Pool;

  const mock = createMockPg();

  // Replace pg.Pool with a mock that routes query() to our mock.
  pg.Pool = class MockPool {
    constructor() {}
    query(text, params) { return mock.query(text, params); }
    async connect() {
      return {
        query: (t, p) => mock.query(t, p),
        release: () => {},
      };
    }
    on() {}
    end() {}
  };

  try {
    // Delete any cached db.js so it picks up our mocked pg.Pool.
    const dbPath = require.resolve('./db');
    delete require.cache[dbPath];
    const db = require('./db');

    // initPostgres() will run migrations through our mock (DDL is no-op'd),
    // then set pgAvailable = true.
    const ok = await db.initPostgres();
    assert(ok, 'initPostgres should succeed with mock Pool');

    // ── Test createPgSession ──
    const testId = '20260626_120000_aabbcc';
    const testProfile = 'testprofile';
    const startedAt = Date.now() / 1000;

    await db.createPgSession({ id: testId, profile: testProfile, title: 'Test Session', source: 'cli', started_at: startedAt });
    let session = mock.sessions.get(testId);
    assert(session, 'createPgSession should insert a row');
    assert(session.profile === testProfile, 'session profile mismatch');
    assert(session.title === 'Test Session', 'session title mismatch');
    assert(session.source === 'cli', 'session source mismatch');
    assert(session.started_at === startedAt, 'session started_at mismatch');
    console.log('✓ createPgSession: inserted session row');

    // ── Test ON CONFLICT DO NOTHING ──
    await db.createPgSession({ id: testId, profile: testProfile, title: 'Updated Title', source: 'cli', started_at: startedAt });
    session = mock.sessions.get(testId);
    assert(session.title === 'Test Session', 'ON CONFLICT DO NOTHING should not update existing row');
    console.log('✓ createPgSession: ON CONFLICT DO NOTHING preserves existing');

    // ── Test getPgSession ──
    session = await db.getPgSession(testId, testProfile);
    assert(session, 'getPgSession should return the session');
    assert(session.id === testId, 'getPgSession id mismatch');
    assert(session.profile === testProfile, 'getPgSession profile mismatch');
    console.log('✓ getPgSession: retrieved session by id+profile');

    // ── Test getPgSession with wrong profile ──
    session = await db.getPgSession(testId, 'wrongprofile');
    assert(session === null, 'getPgSession should return null for wrong profile');
    console.log('✓ getPgSession: null for wrong profile');

    // ── Test updatePgSessionTitle ──
    await db.updatePgSessionTitle(testId, testProfile, 'New Title');
    session = mock.sessions.get(testId);
    assert(session.title === 'New Title', 'updatePgSessionTitle should update title');
    console.log('✓ updatePgSessionTitle: title updated');

    // ── Test archivePgSession ──
    await db.archivePgSession(testId, testProfile);
    session = mock.sessions.get(testId);
    assert(session.archived === 1, 'archivePgSession should set archived=1');
    console.log('✓ archivePgSession: session archived');

    // ── Test insertSessionMessage ──
    await db.insertSessionMessage(testId, testProfile, 'user', 'Hello world');
    await db.insertSessionMessage(testId, testProfile, 'assistant', 'Hi there!');
    assert(mock.messages.length === 2, 'insertSessionMessage should add 2 messages');
    const m0 = mock.messages[0];
    assert(m0.session_id === testId, 'message session_id mismatch');
    assert(m0.profile === testProfile, 'message profile mismatch');
    assert(m0.role === 'user', 'first message role mismatch');
    assert(m0.content === 'Hello world', 'first message content mismatch');
    assert(typeof m0.created_at === 'number', 'message created_at should be number');
    const m1 = mock.messages[1];
    assert(m1.role === 'assistant', 'second message role mismatch');
    assert(m1.content === 'Hi there!', 'second message content mismatch');
    console.log('✓ insertSessionMessage: 2 messages inserted');

    // ── Test listPgSessions ──
    const testId2 = '20260626_130000_ddeeff';
    const startedAt2 = Date.now() / 1000 + 100;
    await db.createPgSession({ id: testId2, profile: testProfile, title: 'Second', source: 'ws', started_at: startedAt2 });
    await db.createPgSession({ id: 'other_id', profile: 'otherprofile', title: 'Other', source: 'cli', started_at: startedAt });

    const sessions = await db.listPgSessions(testProfile);
    assert(Array.isArray(sessions), 'listPgSessions should return array');
    assert(sessions.length === 2, `listPgSessions should return 2 sessions for ${testProfile}, got ${sessions.length}`);
    assert(sessions[0].id === testId2, 'first session should be the newer one');
    assert(sessions[1].id === testId, 'second session should be the older one');
    console.log('✓ listPgSessions: 2 sessions, ordered by started_at DESC');

    // ── Test listPgSessions with non-existent profile ──
    const empty = await db.listPgSessions('nonexistent');
    assert(Array.isArray(empty) && empty.length === 0, 'listPgSessions for nonexistent profile should return empty array');
    console.log('✓ listPgSessions: empty for nonexistent profile');

    console.log('\nAll PG persistence tests passed (mock mode)');
  } finally {
    // Restore original pg.Pool and clear cache
    pg.Pool = OriginalPool;
    delete process.env.DATABASE_URL;
    const dbPath = require.resolve('./db');
    delete require.cache[dbPath];
  }
}

async function runWithRealPg() {
  const db = require('./db');
  const { initPostgres } = db;

  const ok = await initPostgres();
  if (!ok) {
    console.log('PG not available — falling back to mock mode');
    return runWithMock();
  }

  // Use a unique test prefix to avoid collisions
  const testId = 'testpg_' + Date.now() + '_' + Math.random().toString(36).slice(2, 8);
  const testProfile = '__test_persistence__';

  try {
    // ── createPgSession ──
    const startedAt = Date.now() / 1000;
    await db.createPgSession({ id: testId, profile: testProfile, title: 'Test', source: 'cli', started_at: startedAt });
    let session = await db.getPgSession(testId, testProfile);
    assert(session, 'createPgSession + getPgSession should work');
    assert(session.id === testId, 'session id mismatch');
    assert(session.title === 'Test', 'session title mismatch');
    console.log('✓ createPgSession + getPgSession');

    // ── ON CONFLICT DO NOTHING ──
    await db.createPgSession({ id: testId, profile: testProfile, title: 'Updated', source: 'cli', started_at: startedAt });
    session = await db.getPgSession(testId, testProfile);
    assert(session.title === 'Test', 'ON CONFLICT DO NOTHING should preserve original title');
    console.log('✓ ON CONFLICT DO NOTHING');

    // ── updatePgSessionTitle ──
    await db.updatePgSessionTitle(testId, testProfile, 'New Title');
    session = await db.getPgSession(testId, testProfile);
    assert(session.title === 'New Title', 'updatePgSessionTitle should work');
    console.log('✓ updatePgSessionTitle');

    // ── insertSessionMessage ──
    await db.insertSessionMessage(testId, testProfile, 'user', 'Hello PG!');
    await db.insertSessionMessage(testId, testProfile, 'assistant', 'Hello from PG!');
    console.log('✓ insertSessionMessage (2 messages)');

    // ── archivePgSession ──
    await db.archivePgSession(testId, testProfile);
    session = await db.getPgSession(testId, testProfile);
    assert(session.archived === 1, 'archivePgSession should set archived=1');
    console.log('✓ archivePgSession');

    // ── listPgSessions ──
    const sessions = await db.listPgSessions(testProfile);
    assert(Array.isArray(sessions), 'listPgSessions should return array');
    assert(sessions.some(s => s.id === testId), 'listPgSessions should include test session');
    console.log('✓ listPgSessions');

    console.log('\nAll PG persistence tests passed (real PG mode)');
  } finally {
    // Cleanup: delete test data
    try {
      await db.query('DELETE FROM session_messages WHERE session_id = $1', [testId]);
      await db.query('DELETE FROM sessions WHERE profile = $1', [testProfile]);
    } catch (_) {}
  }
}

(async () => {
  try {
    if (process.env.DATABASE_URL) {
      await runWithRealPg();
    } else {
      await runWithMock();
    }
    process.exit(0);
  } catch (err) {
    console.error('\nTest failed:', err);
    process.exit(1);
  }
})();