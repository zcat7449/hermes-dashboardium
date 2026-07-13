const crypto = require('crypto');
const fsp = require('fs').promises;
const fs = require('fs');
const path = require('path');
const log = require('../services/logger');

const AUDIT_LOG_DIR = process.env.AUDIT_LOG_DIR || path.join(process.env.HOME || require('os').homedir(), '.hermes', 'logs');
const AUDIT_LOG_FILE = path.join(AUDIT_LOG_DIR, 'dashboardium-audit.jsonl');
const AUDIT_MAX_SIZE = 5 * 1024 * 1024; // 5 MB
const AUDIT_KEEP_ARCHIVES = 3;

// Serialise rotations + appends on a single shared queue so concurrent
// auditLog() calls never interleave a rotation with a write (prevents the
// previous TOCTOU race that lost entries under load).
let writeQueue = Promise.resolve();

async function rotateIfNeeded() {
  try {
    let stats;
    try {
      stats = await fsp.stat(AUDIT_LOG_FILE);
    } catch {
      return; // file doesn't exist yet — nothing to rotate
    }
    if (stats.size < AUDIT_MAX_SIZE) return;
    // Rotate: delete oldest, shift archives. Done sequentially.
    for (let i = AUDIT_KEEP_ARCHIVES; i >= 1; i--) {
      const old = `${AUDIT_LOG_FILE}.${i}`;
      const next = `${AUDIT_LOG_FILE}.${i + 1}`;
      try {
        if (i === AUDIT_KEEP_ARCHIVES) {
          await fsp.unlink(old).catch(() => {});
        } else {
          await fsp.rename(old, next);
        }
      } catch {}
    }
    await fsp.rename(AUDIT_LOG_FILE, `${AUDIT_LOG_FILE}.1`);
  } catch (err) {
    log.warn('audit rotation error', {error: err.message});
  }
}

function auditLog(req, profile, message) {
  const ip = req.ip || req.connection.remoteAddress || 'unknown';
  const hash = message
    ? crypto.createHash('sha256').update(message, 'utf8').digest('hex')
    : null;
  const entry = {
    timestamp: new Date().toISOString(),
    profile: profile || null,
    ip,
    message_hash: hash,
    method: req.method,
    path: req.path,
  };
  const line = JSON.stringify(entry) + '\n';

  // BUG 5 fix: async file I/O via fs.promises + serialised queue. Previously
  // appendFileSync + statSync blocked the event loop on every chat message,
  // causing WS backpressure and visible lag under load.
  writeQueue = writeQueue.then(async () => {
    try {
      await fsp.mkdir(AUDIT_LOG_DIR, { recursive: true });
      await rotateIfNeeded();
      await fsp.appendFile(AUDIT_LOG_FILE, line);
    } catch (err) {
      // Fallback to stdout if file write fails — never let audit break the request
      log.info('audit fallback (file write failed)', {line: line.trim(), error: err.message});
    }
  }).catch(err => {
    log.warn('audit queue error', {error: err.message});
  });

  // Also log to stdout for immediate visibility (synchronous, cheap)
  log.info('audit', {line: line.trim()});
}

module.exports = auditLog;
