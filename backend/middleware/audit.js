const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const log = require('../services/logger');

const AUDIT_LOG_DIR = process.env.AUDIT_LOG_DIR || path.join(process.env.HOME || require('os').homedir(), '.hermes', 'logs');
const AUDIT_LOG_FILE = path.join(AUDIT_LOG_DIR, 'dashboardium-audit.jsonl');
const AUDIT_MAX_SIZE = 5 * 1024 * 1024; // 5 MB
const AUDIT_KEEP_ARCHIVES = 3;

function ensureLogDir() {
  try {
    fs.mkdirSync(AUDIT_LOG_DIR, { recursive: true });
  } catch {}
}

function rotateIfNeeded() {
  try {
    if (!fs.existsSync(AUDIT_LOG_FILE)) return;
    const stats = fs.statSync(AUDIT_LOG_FILE);
    if (stats.size < AUDIT_MAX_SIZE) return;
    // Rotate: delete oldest, shift archives
    for (let i = AUDIT_KEEP_ARCHIVES; i >= 1; i--) {
      const old = `${AUDIT_LOG_FILE}.${i}`;
      const next = `${AUDIT_LOG_FILE}.${i + 1}`;
      if (fs.existsSync(old)) {
        if (i === AUDIT_KEEP_ARCHIVES) {
          fs.unlinkSync(old); // delete oldest
        } else {
          fs.renameSync(old, next);
        }
      }
    }
    fs.renameSync(AUDIT_LOG_FILE, `${AUDIT_LOG_FILE}.1`);
  } catch {}
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

  // Write to file (with rotation)
  try {
    ensureLogDir();
    rotateIfNeeded();
    fs.appendFileSync(AUDIT_LOG_FILE, line);
  } catch (err) {
    // Fallback to stdout if file write fails
    log.info('audit', {line: line.trim()});
  }

  // Also log to stdout for immediate visibility
  log.info('audit', {line: line.trim()});
}

module.exports = auditLog;