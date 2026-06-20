const crypto = require('crypto');

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
  console.log(JSON.stringify(entry));
}

module.exports = auditLog;
