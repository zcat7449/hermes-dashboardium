'use strict';

/**
 * HTTP Basic Auth middleware.
 * Credentials from env: AUTH_USERNAME, AUTH_PASSWORD.
 * If both are unset — auth is disabled (dev mode).
 */

const AUTH_USER = process.env.AUTH_USERNAME || '';
const AUTH_PASS = process.env.AUTH_PASSWORD || '';
const AUTH_ENABLED = !!(AUTH_USER && AUTH_PASS);

// Public paths that bypass auth (health-check for monitoring, etc.)
// NOTE: middleware mounted at '/api', so req.path is '/health' not '/api/health'
// WebSocket path — browser WS API cannot send custom headers
const ALLOWLIST = new Set(['/health', '/ws']);

function basicAuthMiddleware(req, res, next) {
  if (!AUTH_ENABLED) return next();
  if (ALLOWLIST.has(req.path)) return next();

  const header = req.headers.authorization;
  if (!header || !header.startsWith('Basic ')) {
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
      res.set('WWW-Authenticate', 'Basic realm="Dashboardium"');
      return res.status(401).json({ error: 'unauthorized' });
    }
  } catch {
    res.set('WWW-Authenticate', 'Basic realm="Dashboardium"');
    return res.status(401).json({ error: 'unauthorized' });
  }

  next();
}

module.exports = basicAuthMiddleware;
