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

module.exports = {
  initPostgres,
  isPgAvailable,
  getPgInitError,
  query,
  getPool,
};
