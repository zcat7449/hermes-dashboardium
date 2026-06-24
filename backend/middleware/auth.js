'use strict';

/**
 * HTTP Basic Auth middleware with brute-force protection.
 * Credentials from env: AUTH_USERNAME, AUTH_PASSWORD.
 * If both are unset — auth is disabled (dev mode).
 */

const AUTH_USER = process.env.AUTH_USERNAME || '';
const AUTH_PASS = process.env.AUTH_PASSWORD || '';
const AUTH_ENABLED = !!(AUTH_USER && AUTH_PASS);

// Public paths that bypass auth (health-check for monitoring, etc.)
const ALLOWLIST = new Set(['/health']);

// Brute-force protection: max 10 failed attempts per IP per 60s window
const AUTH_FAIL_LIMIT = 10;
const AUTH_FAIL_WINDOW_MS = 60000;
const authFailCounts = new Map(); // ip -> { count, resetAt }

function checkAuthRateLimit(ip) {
  const now = Date.now();
  let bucket = authFailCounts.get(ip);
  if (!bucket || now >= bucket.resetAt) {
    bucket = { count: 0, resetAt: now + AUTH_FAIL_WINDOW_MS };
    authFailCounts.set(ip, bucket);
  }
  if (bucket.count >= AUTH_FAIL_LIMIT) return false;
  bucket.count++;
  return true;
}

function basicAuthMiddleware(req, res, next) {
  if (!AUTH_ENABLED) return next();
  if (ALLOWLIST.has(req.path)) return next();

  const ip = req.ip || req.connection.remoteAddress || 'unknown';

  const header = req.headers.authorization;
  if (!header || !header.startsWith('Basic ')) {
    if (!checkAuthRateLimit(ip)) {
      res.set('Retry-After', '60');
      return res.status(429).json({ error: 'too many failed auth attempts' });
    }
    res.set('WWW-Authenticate', 'Basic realm="Dashboardium"');
    return res.status(401).json({ error: 'unauthorized' });
  }

  try {
    const decoded = Buffer.from(header.slice(6), 'base64').toString('utf-8');
    const colon = decoded.indexOf(':');
    if (colon === -1) throw new Error('invalid format');
    const user = decoded.slice(0, colon);
    const pass = decoded.slice(colon + 1);
    if (user !== AUTH_USER || pass !== AUTH_PASS) {
      if (!checkAuthRateLimit(ip)) {
        res.set('Retry-After', '60');
        return res.status(429).json({ error: 'too many failed auth attempts' });
      }
      res.set('WWW-Authenticate', 'Basic realm="Dashboardium"');
      return res.status(401).json({ error: 'unauthorized' });
    }
  } catch {
    if (!checkAuthRateLimit(ip)) {
      res.set('Retry-After', '60');
      return res.status(429).json({ error: 'too many failed auth attempts' });
    }
    res.set('WWW-Authenticate', 'Basic realm="Dashboardium"');
    return res.status(401).json({ error: 'unauthorized' });
  }

  // Reset fail count on successful auth
  authFailCounts.delete(ip);
  next();
}

module.exports = basicAuthMiddleware;
module.exports.authFailCounts = authFailCounts;
