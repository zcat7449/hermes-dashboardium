const fs = require('fs');
const path = require('path');
const sqlite3 = require('better-sqlite3');
const Database = sqlite3;
const log = require('./logger');
const { KANBAN_BOARDS_DIR, SQLITE_BUSY_RETRIES, SQLITE_TIMEOUT_MS } = require('../config');

let dbConnections = new Map();

function openDbWithRetry(boardPath, retries = SQLITE_BUSY_RETRIES) {
  return new Promise((resolve, reject) => {
    let attempt = 0;
    const tryOpen = () => {
      try {
        const db = new Database(boardPath, {
          readonly: true,
          fileMustExist: false,
          timeout: SQLITE_TIMEOUT_MS,
          mode: sqlite3.OPEN_READONLY,
        });
        resolve(db);
      } catch (err) {
        const isBusy = err && (err.code === 'SQLITE_BUSY' || (err.message && err.message.includes('SQLITE_BUSY')));
        if (isBusy && attempt < retries) {
          attempt++;
          setTimeout(tryOpen, 100 * attempt);
        } else {
          reject(err);
        }
      }
    };
    tryOpen();
  });
}

async function getDb(boardPath) {
  if (!fs.existsSync(boardPath)) return null;
  let db = dbConnections.get(boardPath);
  if (!db) {
    try {
      db = await openDbWithRetry(boardPath, SQLITE_BUSY_RETRIES);
      dbConnections.set(boardPath, db);
    } catch (err) {
      log.error('failed to open board db', {boardPath, error: err.message});
      return null;
    }
  }
  return db;
}

function closeDbs() {
  for (const [p, db] of dbConnections) {
    try { db.close(); } catch (_) {}
  }
  dbConnections.clear();
}

function getSqliteResultWithParams(dbPath, sql, params = []) {
  try {
    const args = ['-json'];
    params.forEach((p, i) => {
      args.push('.param set :p' + i + ' ' + String(p == null ? '' : p));
    });
    args.push(sql);
    const result = require('child_process').execFileSync('sqlite3', [dbPath, ...args], { encoding: 'utf8', timeout: 2000, maxBuffer: 1024 * 1024 });
    const parsed = JSON.parse(result || '[]');
    if (!Array.isArray(parsed)) return [];
    return parsed;
  } catch { return []; }
}

async function scanBoardsForProfileTasks() {
  const rows = [];
  let boardDirs = [];
  try {
    boardDirs = fs.readdirSync(KANBAN_BOARDS_DIR, { withFileTypes: true })
      .filter(d => d.isDirectory())
      .map(d => d.name);
  } catch (err) {
    log.error('failed to read boards dir', {error: err.message || String(err)});
  }
  for (const board of boardDirs) {
    const dbPath = path.join(KANBAN_BOARDS_DIR, board, 'kanban.db');
    const db = await getDb(dbPath);
    if (!db) continue;
    try {
      const boardRows = db.prepare(
        `SELECT id, title, status, started_at, assignee, completed_at, last_heartbeat_at
         FROM tasks
         WHERE status IN ('todo','ready','running','blocked')
         ORDER BY
           CASE status
             WHEN 'running' THEN 0
             WHEN 'blocked' THEN 1
             WHEN 'ready' THEN 2
             WHEN 'todo' THEN 3
           END,
           started_at DESC`
      ).all();
      for (const r of boardRows) {
        r.board = board;
        rows.push(r);
      }
    } catch (err) {
      // Board may not have tasks table yet; ignore silently.
    }
  }
  return rows;
}

module.exports = {
  getDb,
  closeDbs,
  getSqliteResultWithParams,
  scanBoardsForProfileTasks,
  dbConnections,
};
