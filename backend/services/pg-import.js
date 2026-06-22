const fs = require('fs');
const path = require('path');
const { homedir } = require('os');
const { PROFILES_DIR, PG_IMPORT_FROM_SQLITE } = require('../config');
const { isPgAvailable, query } = require('../db');

const REAL_HOME = process.env.HOME || homedir();

async function importSessionsFromSqlite() {
  if (!PG_IMPORT_FROM_SQLITE || !isPgAvailable()) return { imported: 0, files: [] };
  const sqlite = require('better-sqlite3');
  const files = [
    path.join(REAL_HOME, '.hermes', 'state.db'),
    ...(fs.existsSync(PROFILES_DIR) ? fs.readdirSync(PROFILES_DIR, { withFileTypes: true })
      .filter(d => d.isDirectory())
      .map(d => path.join(PROFILES_DIR, d.name, 'state.db'))
      .filter(p => fs.existsSync(p)) : []),
  ];
  let imported = 0;
  for (const file of files) {
    let db;
    try {
      db = new sqlite(file, { readonly: true });
      const rows = db.prepare('SELECT id, title, source, started_at, ended_at, message_count, archived FROM sessions').all();
      const profileName = path.basename(path.dirname(file)) === '.hermes' ? 'default' : path.basename(path.dirname(file));
      for (const r of rows) {
        try {
          await query(
            `INSERT INTO sessions (id, profile, title, source, started_at, ended_at, message_count, archived)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
             ON CONFLICT (id) DO NOTHING`,
            [r.id, profileName, r.title || null, r.source || 'cli', r.started_at, r.ended_at || null, r.message_count || 0, r.archived || 0]
          );
          imported += 1;
        } catch (insertErr) {
          console.error('import session failed', r.id, insertErr.message);
        }
      }
      db.close();
    } catch (err) {
      console.error('failed to import from', file, err.message);
      if (db) { try { db.close(); } catch (_) {} }
    }
  }
  return { imported, files };
}

module.exports = { importSessionsFromSqlite };
