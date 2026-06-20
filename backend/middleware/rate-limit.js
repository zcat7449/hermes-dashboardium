const { GLOBAL_RATE_LIMIT_RPS, GLOBAL_RATE_LIMIT_WINDOW_MS } = require('../config');

const globalIpLimits = new Map(); // ip -> { count, resetAt }
const chatRateLimits = new Map(); // profile -> last allowed timestamp

function checkGlobalIpRateLimit(ip) {
  const now = Date.now();
  let bucket = globalIpLimits.get(ip);
  if (!bucket || now >= bucket.resetAt) {
    bucket = { count: 1, resetAt: now + GLOBAL_RATE_LIMIT_WINDOW_MS };
    globalIpLimits.set(ip, bucket);
    return true;
  }
  if (bucket.count >= GLOBAL_RATE_LIMIT_RPS) return false;
  bucket.count += 1;
  return true;
}

function globalRateLimitMiddleware(req, res, next) {
  const ip = req.ip || req.connection.remoteAddress || 'unknown';
  if (!checkGlobalIpRateLimit(ip)) {
    res.set('Retry-After', String(Math.ceil(GLOBAL_RATE_LIMIT_WINDOW_MS / 1000)));
    res.status(429).json({ error: 'global rate limit: too many requests from this IP' });
    return;
  }
  next();
}

function checkChatRateLimit(profile) {
  const now = Date.now();
  const last = chatRateLimits.get(profile) || 0;
  if (now - last < 5000) return false;
  chatRateLimits.set(profile, now);
  return true;
}

module.exports = {
  globalRateLimitMiddleware,
  checkGlobalIpRateLimit,
  checkChatRateLimit,
  chatRateLimits,
  globalIpLimits,
};
