const { Pool } = require('pg');

const DATABASE_URL = process.env.DATABASE_URL;

const MIGRATIONS = [
  `CREATE TABLE IF NOT EXISTS sessions (
    id TEXT PRIMARY KEY,
    profile TEXT NOT NULL,
    title TEXT DEFAULT NULL,
    source TEXT DEFAULT 'cli',
    started_at REAL NOT NULL,
    ended_at REAL DEFAULT NULL,
    message_count INTEGER DEFAULT 0,
    archived INTEGER DEFAULT 0,
    created_at TIMESTAMP DEFAULT NOW()
  )`,
  `CREATE TABLE IF NOT EXISTS session_messages (
    id SERIAL PRIMARY KEY,
    session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
    profile TEXT NOT NULL,
    role TEXT NOT NULL,
    content TEXT NOT NULL,
    created_at REAL NOT NULL
  )`,
  `CREATE INDEX IF NOT EXISTS idx_sessions_profile_archived_started
    ON sessions(profile, archived, started_at DESC)`,
  `CREATE INDEX IF NOT EXISTS idx_session_messages_session_id
    ON session_messages(session_id)`,
  `ALTER TABLE sessions ADD COLUMN IF NOT EXISTS input_tokens INTEGER DEFAULT 0`,
  `ALTER TABLE sessions ADD COLUMN IF NOT EXISTS output_tokens INTEGER DEFAULT 0`,
];

let pool = null;
let pgAvailable = false;
let pgInitError = null;

async function getPool() {
  if (pool) return pool;
  if (!DATABASE_URL) {
    throw new Error('DATABASE_URL is not set');
  }
  pool = new Pool({
    connectionString: DATABASE_URL,
    max: 10,
    idleTimeoutMillis: 30000,
    connectionTimeoutMillis: 5000,
  });
  pool.on('error', (err) => {
    console.error('pg pool unexpected error', err.message);
    pgAvailable = false;
  });
  return pool;
}

async function initPostgres() {
  if (!DATABASE_URL) {
    pgAvailable = false;
    pgInitError = 'DATABASE_URL is not set';
    console.error('postgres init skipped: DATABASE_URL is not set');
    return false;
  }
  try {
    const p = await getPool();
    const client = await p.connect();
    try {
      for (const sql of MIGRATIONS) {
        await client.query(sql);
      }
    } finally {
      client.release();
    }
    pgAvailable = true;
    pgInitError = null;
    return true;
  } catch (err) {
    pgAvailable = false;
    pgInitError = err.message;
    console.error('postgres init failed:', err.message);
    return false;
  }
}

function isPgAvailable() {
  return pgAvailable;
}

function getPgInitError() {
  return pgInitError;
}

async function query(text, params) {
  if (!pgAvailable) throw new Error('postgres unavailable');
  const p = await getPool();
  return p.query(text, params);
}

// ── PG session/message persistence functions ──────────────────────────

/**
 * List sessions for a profile from PG.
 * @param {string} profile
 * @returns {Promise<Array>} rows ordered by started_at DESC
 */
async function listPgSessions(profile) {
  const result = await query(
    `SELECT id, profile, title, source, started_at, ended_at, message_count, archived, input_tokens, output_tokens
     FROM sessions
     WHERE profile = $1
     ORDER BY started_at DESC`,
    [profile]
  );
  return result.rows;
}

/**
 * Create (or upsert) a session row in PG.
 * @param {{id:string, profile:string, title:?string, source:string, started_at:number}} params
 * @returns {Promise<void>}
 */
async function createPgSession({ id, profile, title, source, started_at }) {
  await query(
    `INSERT INTO sessions (id, profile, title, source, started_at, message_count, archived)
     VALUES ($1, $2, $3, $4, $5, 0, 0)
     ON CONFLICT (id) DO NOTHING`,
    [id, profile, title || null, source || 'cli', started_at]
  );
}

/**
 * Update session title in PG.
 * @param {string} id
 * @param {string} profile
 * @param {string} title
 * @returns {Promise<void>}
 */
async function updatePgSessionTitle(id, profile, title) {
  await query(
    `UPDATE sessions SET title = $1 WHERE id = $2 AND profile = $3`,
    [title, id, profile]
  );
}

/**
 * Archive a session in PG.
 * @param {string} id
 * @param {string} profile
 * @returns {Promise<void>}
 */
async function archivePgSession(id, profile) {
  await query(
    `UPDATE sessions SET archived = 1 WHERE id = $1 AND profile = $2`,
    [id, profile]
  );
}

/**
 * Insert a message row for a session in PG.
 * @param {string} sessionId
 * @param {string} profile
 * @param {string} role
 * @param {string} content
 * @returns {Promise<void>}
 */
async function insertSessionMessage(sessionId, profile, role, content) {
  await query(
    `INSERT INTO session_messages (session_id, profile, role, content, created_at)
     VALUES ($1, $2, $3, $4, $5)`,
    [sessionId, profile, role, content, Date.now() / 1000]
  );
}

/**
 * Get a single session from PG by id + profile.
 * @param {string} id
 * @param {string} profile
 * @returns {Promise<?object>}
 */
async function getPgSession(id, profile) {
  const result = await query(
    `SELECT id, profile, title, source, started_at, ended_at, message_count, archived, input_tokens, output_tokens
     FROM sessions
     WHERE id = $1 AND profile = $2`,
    [id, profile]
  );
  return result.rows[0] || null;
}

module.exports = {
  initPostgres,
  isPgAvailable,
  getPgInitError,
  query,
  getPool,
  listPgSessions,
  createPgSession,
  updatePgSessionTitle,
  archivePgSession,
  insertSessionMessage,
  getPgSession,
};
