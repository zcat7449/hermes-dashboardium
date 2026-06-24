const { listHermesSessionsImpl, exportHermesSession, getHermesStatus } = require('./hermes-cli');

// ---- Sessions cache: prevent process pile-up on 5s polling ----
const SESSION_CACHE_TTL_MS = 30000; // 30 seconds (matches WS poll interval)
const sessionsCache = new Map(); // key = profile, value = { promise, expiresAt }

// ---- Usage cache: prevent Hermes CLI overload from 14 parallel export calls ----
const USAGE_CACHE_TTL_MS = 60000; // 60 seconds
const usageCache = new Map(); // key = `${profile}:${sessionId}`, value = { promise, expiresAt }

// ---- Status cache: prevent process pile-up on 30s polling ----
const STATUS_CACHE_TTL_MS = 30000; // 30 seconds (sync with WS poll interval)
const statusCache = new Map(); // key = profile, value = { promise, expiresAt }

function getCachedStatus(profile) {
  const now = Date.now();
  const entry = statusCache.get(profile);
  if (entry && entry.expiresAt > now) {
    return entry.promise;
  }
  const promise = getHermesStatus(profile);
  statusCache.set(profile, { promise, expiresAt: now + STATUS_CACHE_TTL_MS });
  return promise;
}

// ---- Profile cache ----
let profileCache = { data: null, ts: 0, ttl: 1000 };

// ---- Task cache ----
let taskCache = { data: null, ts: 0, ttl: 1000 };

// ---- Profiles response cache ----
let profilesResponseCache = { data: null, ts: 0, ttl: 30000 };

function getCachedSessions(profile) {
  const now = Date.now();
  const entry = sessionsCache.get(profile);
  if (entry && entry.expiresAt > now) {
    return entry.promise;
  }
  const promise = listHermesSessionsImpl(profile, 20);
  sessionsCache.set(profile, { promise, expiresAt: now + SESSION_CACHE_TTL_MS });
  return promise;
}

function getCachedUsage(profile, sessionId) {
  const now = Date.now();
  const key = `${profile}:${sessionId}`;
  const entry = usageCache.get(key);
  if (entry && entry.expiresAt > now) {
    return entry.promise;
  }
  const promise = exportHermesSession(profile, sessionId);
  usageCache.set(key, { promise, expiresAt: now + USAGE_CACHE_TTL_MS });
  return promise;
}

function invalidateProfilesResponseCache() {
  profilesResponseCache.data = null;
}

function clearStatusCache() {
  statusCache.clear();
}

module.exports = {
  getCachedSessions,
  getCachedUsage,
  getCachedStatus,
  clearStatusCache,
  invalidateProfilesResponseCache,
  profileCache,
  taskCache,
  profilesResponseCache,
  sessionsCache,
  usageCache,
  statusCache,
};
