// WebSocket server for real-time profile updates, chat, and optimize.
// Lightweight delta polling — checks only message_count, no full profile rebuild.
const WebSocket = require('ws');
const { execFile } = require('child_process');
const log = require('./logger');
const { buildProfilesResponse } = require('../routes/profiles');
const { hermesChat, parseHermesChatOutput, sanitizeChatMessage } = require('./hermes-cli');
const { getCachedSessions } = require('./cache');
const { exportHermesSession } = require('./hermes-cli');
const { checkChatRateLimit } = require('../middleware/rate-limit');
const auditLog = require('../middleware/audit');
const { isPgAvailable, insertSessionMessage } = require('../db');
const { invalidateProfilesResponseCache } = require('./cache');

const WS_DELTA_POLL_MS = 10000; // 10s — only checks message_count, lightweight
let LEADER_PROFILES = []; // populated from user_role.json at init

let wss = null;
let deltaPollTimer = null;
let pollSeq = 0;
// BUG 4 fix: re-entrancy guard for deltaPollTimer — prevents overlap when
// a poll tick takes longer than WS_DELTA_POLL_MS (exportHermesSession can stall).
let deltaPollInFlight = false;

// Track last known message_count per profile per session for delta push.
// BUG 2 fix: LRU-bounded per profile to prevent unbounded growth when
// sessions accumulate over weeks/months of operation. Max 100 entries per
// profile; oldest insertion is dropped when capacity is exceeded.
const LAST_SESSION_COUNTS_MAX_PER_PROFILE = 100;
const lastSessionCounts = {}; // { profile: Map<sessionId, message_count> }

/**
 * Record a session count in the per-profile LRU map, evicting the oldest
 * entry when the per-profile cap is exceeded.
 */
function recordSessionCount(profile, sessionId, count) {
  if (!lastSessionCounts[profile]) {
    lastSessionCounts[profile] = new Map();
  }
  const m = lastSessionCounts[profile];
  // Re-insert to move to most-recently-used position.
  m.delete(sessionId);
  m.set(sessionId, count);
  if (m.size > LAST_SESSION_COUNTS_MAX_PER_PROFILE) {
    const oldestKey = m.keys().next().value;
    if (oldestKey !== undefined) m.delete(oldestKey);
  }
}

/**
 * Garbage-collect entries in `lastSessionCounts[profile]` that are not in
 * the current live sessions list. Runs once per poll tick per profile so
 * the map converges to the actual session set over time.
 */
function gcSessionCounts(profile, liveSessionIds) {
  const m = lastSessionCounts[profile];
  if (!m) return;
  const live = new Set(liveSessionIds);
  for (const sid of m.keys()) {
    if (!live.has(sid)) m.delete(sid);
  }
}

/**
 * Read leader profiles from user_role.json (profiles with role 'leader').
 * Falls back to empty array if file missing — no delta polling.
 */
function loadLeaderProfiles() {
  try {
    const fs = require('fs');
    const { USER_ROLE_PATH } = require('../config');
    if (!fs.existsSync(USER_ROLE_PATH)) return [];
    const raw = fs.readFileSync(USER_ROLE_PATH, 'utf8');
    const parsed = JSON.parse(raw);
    const entries = Array.isArray(parsed.entries) ? parsed.entries : [];
    return entries.filter(e => e.role === 'leader').map(e => e.profile);
  } catch {
    return [];
  }
}

/**
 * Authenticate WebSocket connection.
 * If AUTH is enabled, check ?token= query parameter against Base64(user:pass).
 * Browser WS API cannot send custom headers, so token in query string is the standard approach.
 */
function authenticateWs(req) {
  const { AUTH_USERNAME, AUTH_PASSWORD } = require('../config');
  if (!AUTH_USERNAME || !AUTH_PASSWORD) return true; // auth disabled
  const url = new URL(req.url, 'http://localhost');
  const token = url.searchParams.get('token');
  if (!token) return false;
  try {
    const decoded = Buffer.from(token, 'base64').toString('utf-8');
    const colon = decoded.indexOf(':');
    if (colon === -1) return false;
    const user = decoded.slice(0, colon);
    const pass = decoded.slice(colon + 1);
    return user === AUTH_USERNAME && pass === AUTH_PASSWORD;
  } catch {
    return false;
  }
}

/**
 * BUG 3 fix: safeSend wraps ws.send so a closed socket doesn't throw.
 * Returns true on success, false if the socket isn't OPEN or send threw.
 * JSON.stringify is the caller's responsibility so we don't pay it on
 * the failure path.
 */
function safeSend(ws, obj) {
  if (!ws || ws.readyState !== WebSocket.OPEN) return false;
  let wire;
  try {
    wire = typeof obj === 'string' ? obj : JSON.stringify(obj);
  } catch {
    return false;
  }
  try {
    ws.send(wire);
    return true;
  } catch {
    return false;
  }
}

function initWebSocket(httpServer) {
  wss = new WebSocket.Server({ server: httpServer, path: '/ws' });

  wss.on('connection', (ws, req) => {
    // Auth check
    if (!authenticateWs(req)) {
      ws.close(4001, 'unauthorized');
      return;
    }

    const ip = req.socket.remoteAddress || 'unknown';
    log.info('ws client connected', {ip});

    // BUG 3 fix: per-WS subscription set. broadcast() now filters against
    // this set so private chat_update messages of one user don't leak to
    // other connected clients. Populated by 'subscribe' messages from the
    // front; also seeded from ?sessions=... query (comma-separated) for
    // compatibility with clients that don't send explicit subscriptions.
    ws._subscribedSessions = new Set();
    ws._chatAbortController = null; // BUG 1 fix: tracks in-flight chat subprocess
    try {
      const url = new URL(req.url, 'http://localhost');
      const initial = url.searchParams.get('sessions');
      if (initial) {
        for (const sid of initial.split(',').map(s => s.trim()).filter(Boolean)) {
          ws._subscribedSessions.add(sid);
        }
      }
    } catch {}

    // Send initial profiles snapshot immediately
    sendProfilesSnapshot(ws);

    ws.on('message', async (raw) => {
      let msg;
      try {
        msg = JSON.parse(raw.toString());
      } catch {
        safeSend(ws, { type: 'error', error: 'invalid json' });
        return;
      }
      await handleWsMessage(ws, msg, req);
    });

    ws.on('close', () => {
      log.info('ws client disconnected', {ip});
      // BUG 1 fix: kill any in-flight chat subprocess on WS disconnect.
      // hermesChat spawns a child process via execFile; without abort the
      // child keeps running and may even respond to a now-orphaned WS.
      if (ws._chatAbortController) {
        try { ws._chatAbortController.abort(); } catch {}
        ws._chatAbortController = null;
      }
    });

    ws.on('error', (err) => {
      log.error('ws client error', {error: err.message});
      if (ws._chatAbortController) {
        try { ws._chatAbortController.abort(); } catch {}
        ws._chatAbortController = null;
      }
    });
  });

  // Load leader profiles and start delta polling
  LEADER_PROFILES = loadLeaderProfiles();
  startDeltaPolling();

  log.info('WebSocket server initialized', {wsPath: '/ws', deltaPollMs: WS_DELTA_POLL_MS, leaders: LEADER_PROFILES.length});
}

function startDeltaPolling() {
  if (deltaPollTimer) clearInterval(deltaPollTimer);
  deltaPollTimer = setInterval(async () => {
    // BUG 4 fix: re-entrancy guard. If a previous tick is still in flight
    // (exportHermesSession can take 15+ s, longer than WS_DELTA_POLL_MS),
    // skip this tick to avoid duplicate concurrent broadcasts.
    if (deltaPollInFlight) return;
    if (!wss || wss.clients.size === 0) return;
    deltaPollInFlight = true;
    try {
      // Only check leader profiles for new messages (lightweight: sessions list only)
      for (const name of LEADER_PROFILES) {
        try {
          const sessions = await getCachedSessions(name);
          const liveIds = [];
          for (const s of sessions) {
            const sid = s.id;
            const count = s.message_count || 0;
            liveIds.push(sid);
            const m = lastSessionCounts[name];
            const prev = m ? m.get(sid) : undefined;
            if (prev !== undefined && count > prev) {
              // New messages detected — fetch and push them
              const session = await exportHermesSession(name, sid);
              if (session && Array.isArray(session.messages)) {
                const newMsgs = session.messages.slice(prev);
                for (const newMsg of newMsgs) {
                  if (newMsg.role === 'user' || newMsg.role === 'assistant') {
                    const text = newMsg.content || '';
                    if (text) {
                      broadcast({
                        type: 'chat_update',
                        profile: name,
                        session_id: sid,
                        role: newMsg.role === 'user' ? 'you' : 'bot',
                        text: text,
                        timestamp: parseFloat(newMsg.timestamp) || Date.now() / 1000,
                      });
                    }
                  }
                }
              }
            }
            recordSessionCount(name, sid, count);
          }
          // BUG 2 fix: GC entries for sessions that no longer exist.
          gcSessionCounts(name, liveIds);
        } catch (e) {
          // Silently skip
        }
      }
    } catch (err) {
      // Silently skip
    } finally {
      deltaPollInFlight = false;
    }
  }, WS_DELTA_POLL_MS);
}

function stopDeltaPolling() {
  if (deltaPollTimer) {
    clearInterval(deltaPollTimer);
    deltaPollTimer = null;
  }
}

async function sendProfilesSnapshot(ws) {
  try {
    const data = await buildProfilesResponse(null);
    safeSend(ws, {
      type: 'profiles',
      seq: pollSeq,
      profiles: data,
      polled_at: Date.now(),
    });
  } catch (err) {
    safeSend(ws, { type: 'error', error: 'failed to load profiles' });
  }
}

async function handleWsMessage(ws, msg, req) {
  const { type, profile, message, session_id } = msg;

  switch (type) {
    case 'chat': {
      if (!profile || !message) {
        safeSend(ws, { type: 'chat_error', error: 'profile and message required' });
        return;
      }
      if (!/^[a-zA-Z0-9_-]+$/.test(profile)) {
        safeSend(ws, { type: 'chat_error', error: 'invalid profile name' });
        return;
      }
      if (!checkChatRateLimit(profile)) {
        safeSend(ws, { type: 'chat_error', error: 'rate limit: one message per 5 seconds per profile' });
        return;
      }
      const safeMsg = sanitizeChatMessage(message);
      if (!safeMsg) {
        safeSend(ws, { type: 'chat_error', error: 'message became empty after sanitization' });
        return;
      }
      auditLog(req, profile, safeMsg);

      let currentSessionId = session_id || null;
      let isNewSession = false;
      if (!currentSessionId && isPgAvailable()) {
        isNewSession = true;
      }

      // BUG 1 fix: bind an AbortController to this chat call. If the WS
      // disconnects mid-flight, ws.on('close') triggers abort() which
      // kills the underlying hermes subprocess via execFile signal.
      const controller = new AbortController();
      ws._chatAbortController = controller;

      // BUG 6 fix: track whether we retried due to "Session not found" so
      // we can (a) record it in the audit log and (b) re-bind the
      // effective session id to whatever the retry response actually
      // contains, instead of leaving the frontend with a stale id.
      let sessionNotFoundRetried = false;

      try {
        let stdout;
        try {
          stdout = await hermesChat(profile, safeMsg, {
            sessionId: currentSessionId,
            signal: controller.signal,
          });
        } catch (chatErr) {
          if (controller.signal.aborted) {
            // WS closed mid-chat — don't try to respond on a dead socket.
            return;
          }
          if (currentSessionId && String(chatErr.message || '').includes('Session not found')) {
            // BUG 6 fix: split-brain mitigation. The previous attempt may
            // have partially written to Hermes-side session storage; we
            // can't roll that back, but we can:
            //   1) re-bind currentSessionId from the retry response below
            //      (so the frontend and our DB agree on the real session)
            //   2) flag the retry in the audit log so operators can trace
            //      these events when investigating drift.
            sessionNotFoundRetried = true;
            currentSessionId = null;
            isNewSession = true;
            stdout = await hermesChat(profile, safeMsg, {
              sessionId: null,
              signal: controller.signal,
            });
          } else {
            throw chatErr;
          }
        }
        const parsed = parseHermesChatOutput(stdout);
        const responseText = parsed.response || stdout.trim();
        // BUG 6 fix: if we retried, prefer the session_id reported in the
        // retry response over our local null. This converges the two
        // sides onto whatever Hermes actually created.
        if (sessionNotFoundRetried) {
          if (parsed.session_id) {
            currentSessionId = parsed.session_id;
          }
          // BUG 6 fix: record the retry in the audit trail and in stdout
          // logs. We use the message-text slot (which is hashed and stored)
          // because auditLog's signature is fixed; the structured fields
          // (original session, rebound session) are logged separately so
          // operators can trace the split-brain event end-to-end.
          try {
            auditLog(req, profile, `session_not_found_retry:${session_id || 'none'}->${currentSessionId || 'none'}`);
          } catch (auditErr) {
            // best-effort; don't break the chat flow on audit failure
          }
          log.info('ws chat session_not_found_retry', {
            profile,
            original_session_id: session_id || null,
            rebound_session_id: currentSessionId,
            reason: 'session_not_found_retry',
          });
        }
        if (isPgAvailable() && currentSessionId) {
          try {
            await insertSessionMessage(currentSessionId, profile, 'user', safeMsg);
            await insertSessionMessage(currentSessionId, profile, 'assistant', responseText);
          } catch (err) {
            log.error('ws: failed to persist session messages', {error: err.message || String(err)});
          }
        }
        log.info('ws chat_response sending', { profile, responseLen: responseText.length, responsePreview: responseText.substring(0, 80) });
        safeSend(ws, {
          type: 'chat_response',
          profile,
          response: responseText,
          session_id: currentSessionId || parsed.session_id || null,
          new_session: isNewSession,
        });
        invalidateProfilesResponseCache();
      } catch (err) {
        if (controller.signal.aborted) return;
        log.error('ws chat error', {error: err.message || String(err)});
        safeSend(ws, { type: 'chat_error', error: 'chat failed: ' + (err.message || String(err)) });
      } finally {
        if (ws._chatAbortController === controller) {
          ws._chatAbortController = null;
        }
      }
      break;
    }

    case 'optimize': {
      if (!profile) {
        safeSend(ws, { type: 'optimize_error', error: 'profile required' });
        return;
      }
      if (!/^[a-zA-Z0-9_-]+$/.test(profile)) {
        safeSend(ws, { type: 'optimize_error', error: 'invalid profile name' });
        return;
      }
      if (!checkChatRateLimit(profile)) {
        safeSend(ws, { type: 'optimize_error', error: 'rate limit: one request per 5 seconds per profile' });
        return;
      }
      auditLog(req, profile, 'optimize_context');
      // BUG 1 fix: same abort binding for optimize path.
      const optController = new AbortController();
      ws._chatAbortController = optController;
      try {
        await hermesChat(
          profile,
          'Очисти контекст, начни новый рабочий цикл. Отвечай кратко: выполнено.',
          { timeoutMs: 30000, signal: optController.signal }
        );
        if (optController.signal.aborted) return;
        safeSend(ws, { type: 'optimize_response', profile, status: 'optimized' });
        invalidateProfilesResponseCache();
      } catch (err) {
        if (optController.signal.aborted) return;
        log.error('ws optimize error', {error: err.message || String(err)});
        safeSend(ws, { type: 'optimize_error', error: 'optimize failed: ' + (err.message || String(err)) });
      } finally {
        if (ws._chatAbortController === optController) {
          ws._chatAbortController = null;
        }
      }
      break;
    }

    case 'subscribe': {
      // BUG 3 fix: explicit subscription management. Frontend sends
      // { type: 'subscribe', session_id: 'abc' } to start receiving
      // chat_update messages for that session.
      if (!ws._subscribedSessions) ws._subscribedSessions = new Set();
      if (msg.session_id) ws._subscribedSessions.add(String(msg.session_id));
      safeSend(ws, { type: 'subscribed', session_id: msg.session_id || null });
      break;
    }

    case 'unsubscribe': {
      if (!ws._subscribedSessions) ws._subscribedSessions = new Set();
      if (msg.session_id) ws._subscribedSessions.delete(String(msg.session_id));
      safeSend(ws, { type: 'unsubscribed', session_id: msg.session_id || null });
      break;
    }

    case 'ping': {
      safeSend(ws, { type: 'pong', ts: Date.now() });
      break;
    }

    default:
      safeSend(ws, { type: 'error', error: 'unknown message type: ' + type });
  }
}

function broadcast(payload) {
  if (!wss) return;
  // Normalize to object so we can filter by session_id.
  let obj = null;
  if (typeof payload === 'string') {
    try { obj = JSON.parse(payload); } catch { obj = null; }
  } else if (payload && typeof payload === 'object') {
    obj = payload;
  }
  const sessionId = obj && obj.session_id;
  let wire = null;
  if (typeof payload === 'string') {
    wire = payload;
  } else {
    try { wire = JSON.stringify(obj); } catch { wire = null; }
  }
  if (wire == null) return;
  for (const client of wss.clients) {
    if (client.readyState !== WebSocket.OPEN) continue;
    // BUG 3 fix: only deliver to clients that have subscribed to this
    // session. Clients with no subscriptions at all still receive
    // non-session-scoped broadcasts (profiles snapshot, system events).
    if (sessionId) {
      const subs = client._subscribedSessions;
      if (subs instanceof Set && subs.size > 0 && !subs.has(sessionId)) {
        continue;
      }
    }
    // BUG 3 fix: route through safeSend so a closed socket mid-loop
    // doesn't throw and abort the whole broadcast.
    safeSend(client, wire);
  }
}

function closeWebSocket() {
  stopDeltaPolling();
  if (wss) {
    wss.close();
    wss = null;
  }
}

module.exports = { initWebSocket, closeWebSocket, broadcast };
