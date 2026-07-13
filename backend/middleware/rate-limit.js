const { GLOBAL_RATE_LIMIT_RPS, GLOBAL_RATE_LIMIT_WINDOW_MS } = require('../config');
const { authFailCounts } = require('./auth');

const globalIpLimits = new Map(); // ip -> { count, resetAt }
const chatRateLimits = new Map(); // profile -> last allowed timestamp

let sweeperTimer = null;

/**
 * Remove all expired buckets from all three in-memory Maps.
 * A bucket is expired when its resetAt timestamp is in the past.
 */
function sweepExpiredBuckets() {
  const now = Date.now();
  for (const map of [globalIpLimits, chatRateLimits, authFailCounts]) {
    for (const [key, bucket] of map) {
      if (bucket.resetAt !== undefined && now >= bucket.resetAt) {
        map.delete(key);
      }
    }
  }
}

/**
 * Start periodic eviction sweep. Returns { stop: () => void }.
 * @param {number} intervalMs - sweep interval in ms (default 300000 = 5 min)
 */
function startRateLimitSweeper(intervalMs = 300000) {
  if (sweeperTimer) return { stop: stopRateLimitSweeper };
  sweeperTimer = setInterval(sweepExpiredBuckets, intervalMs);
  sweeperTimer.unref();
  return { stop: stopRateLimitSweeper };
}

function stopRateLimitSweeper() {
  if (sweeperTimer) {
    clearInterval(sweeperTimer);
    sweeperTimer = null;
  }
}

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
  // BUG 2 fix: store bucket as { resetAt } so sweepExpiredBuckets can evict it.
  // Previously we stored a bare number, so `bucket.resetAt !== undefined`
  // was always false and the sweeper never deleted anything — Map grew
  // unboundedly. Now: 5s sliding window, sweepable.
  const bucket = chatRateLimits.get(profile);
  if (bucket && now < bucket.resetAt) return false;
  chatRateLimits.set(profile, { resetAt: now + 5000 });
  return true;
}

module.exports = {
  globalRateLimitMiddleware,
  checkGlobalIpRateLimit,
  checkChatRateLimit,
  chatRateLimits,
  globalIpLimits,
  sweepExpiredBuckets,
  startRateLimitSweeper,
  stopRateLimitSweeper,
};
