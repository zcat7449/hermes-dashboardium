// WebSocket server for real-time profile updates, chat, and optimize.
// Lightweight delta polling — checks only message_count, no full profile rebuild.
const WebSocket = require('ws');
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

// Track last known message_count per profile per session for delta push
const lastSessionCounts = {}; // { profile: { sessionId: message_count } }

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

function initWebSocket(httpServer) {
  wss = new WebSocket.Server({ server: httpServer, path: '/ws' });

  wss.on('connection', (ws, req) => {
    // Auth check
    if (!authenticateWs(req)) {
      ws.close(4001, 'unauthorized');
      return;
    }

    const ip = req.socket.remoteAddress || 'unknown';
    console.log(`ws: client connected from ${ip}`);

    // Send initial profiles snapshot immediately
    sendProfilesSnapshot(ws);

    ws.on('message', async (raw) => {
      let msg;
      try {
        msg = JSON.parse(raw.toString());
      } catch {
        ws.send(JSON.stringify({ type: 'error', error: 'invalid json' }));
        return;
      }
      await handleWsMessage(ws, msg, req);
    });

    ws.on('close', () => {
      console.log(`ws: client disconnected from ${ip}`);
    });

    ws.on('error', (err) => {
      console.error('ws: client error', err.message);
    });
  });

  // Load leader profiles and start delta polling
  LEADER_PROFILES = loadLeaderProfiles();
  startDeltaPolling();

  console.log(`WebSocket server initialized on /ws (delta polling ${WS_DELTA_POLL_MS}ms, ${LEADER_PROFILES.length} leaders)`);
}

function startDeltaPolling() {
  if (deltaPollTimer) clearInterval(deltaPollTimer);
  deltaPollTimer = setInterval(async () => {
    if (!wss || wss.clients.size === 0) return;
    try {
      // Only check leader profiles for new messages (lightweight: sessions list only)
      for (const name of LEADER_PROFILES) {
        try {
          const sessions = await getCachedSessions(name);
          for (const s of sessions) {
            const sid = s.id;
            const count = s.message_count || 0;
            const prev = lastSessionCounts[name] && lastSessionCounts[name][sid];
            if (prev !== undefined && count > prev) {
              // New messages detected — fetch and push them
              const session = await exportHermesSession(name, sid);
              if (session && Array.isArray(session.messages)) {
                const newMsgs = session.messages.slice(prev);
                for (const m of newMsgs) {
                  if (m.role === 'user' || m.role === 'assistant') {
                    const text = m.content || '';
                    if (text) {
                      broadcast(JSON.stringify({
                        type: 'chat_update',
                        profile: name,
                        session_id: sid,
                        role: m.role === 'user' ? 'you' : 'bot',
                        text: text,
                        timestamp: parseFloat(m.timestamp) || Date.now() / 1000,
                      }));
                    }
                  }
                }
              }
            }
            if (!lastSessionCounts[name]) lastSessionCounts[name] = {};
            lastSessionCounts[name][sid] = count;
          }
        } catch (e) {
          // Silently skip
        }
      }
    } catch (err) {
      // Silently skip
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
    ws.send(JSON.stringify({
      type: 'profiles',
      seq: pollSeq,
      profiles: data,
      polled_at: Date.now(),
    }));
  } catch (err) {
    ws.send(JSON.stringify({ type: 'error', error: 'failed to load profiles' }));
  }
}

async function handleWsMessage(ws, msg, req) {
  const { type, profile, message, session_id } = msg;

  switch (type) {
    case 'chat': {
      if (!profile || !message) {
        ws.send(JSON.stringify({ type: 'chat_error', error: 'profile and message required' }));
        return;
      }
      if (!/^[a-zA-Z0-9_-]+$/.test(profile)) {
        ws.send(JSON.stringify({ type: 'chat_error', error: 'invalid profile name' }));
        return;
      }
      if (!checkChatRateLimit(profile)) {
        ws.send(JSON.stringify({ type: 'chat_error', error: 'rate limit: one message per 5 seconds per profile' }));
        return;
      }
      const safeMsg = sanitizeChatMessage(message);
      if (!safeMsg) {
        ws.send(JSON.stringify({ type: 'chat_error', error: 'message became empty after sanitization' }));
        return;
      }
      auditLog(req, profile, safeMsg);

      let currentSessionId = session_id || null;
      let isNewSession = false;
      if (!currentSessionId && isPgAvailable()) {
        isNewSession = true;
      }

      try {
        let stdout;
        try {
          stdout = await hermesChat(profile, safeMsg, { sessionId: currentSessionId });
        } catch (chatErr) {
          if (currentSessionId && String(chatErr.message || '').includes('Session not found')) {
            currentSessionId = null;
            isNewSession = true;
            stdout = await hermesChat(profile, safeMsg, { sessionId: null });
          } else {
            throw chatErr;
          }
        }
        const parsed = parseHermesChatOutput(stdout);
        const responseText = parsed.response || stdout.trim();
        if (isPgAvailable() && currentSessionId) {
          try {
            await insertSessionMessage(currentSessionId, profile, 'user', safeMsg);
            await insertSessionMessage(currentSessionId, profile, 'assistant', responseText);
          } catch (err) {
            console.error('ws: failed to persist session messages', err);
          }
        }
        ws.send(JSON.stringify({
          type: 'chat_response',
          profile,
          response: responseText,
          session_id: currentSessionId || parsed.session_id || null,
          new_session: isNewSession,
        }));
        invalidateProfilesResponseCache();
      } catch (err) {
        console.error('ws: chat error', err);
        ws.send(JSON.stringify({ type: 'chat_error', error: 'chat failed: ' + (err.message || String(err)) }));
      }
      break;
    }

    case 'optimize': {
      if (!profile) {
        ws.send(JSON.stringify({ type: 'optimize_error', error: 'profile required' }));
        return;
      }
      if (!/^[a-zA-Z0-9_-]+$/.test(profile)) {
        ws.send(JSON.stringify({ type: 'optimize_error', error: 'invalid profile name' }));
        return;
      }
      if (!checkChatRateLimit(profile)) {
        ws.send(JSON.stringify({ type: 'optimize_error', error: 'rate limit: one request per 5 seconds per profile' }));
        return;
      }
      auditLog(req, profile, 'optimize_context');
      try {
        await hermesChat(
          profile,
          'Очисти контекст, начни новый рабочий цикл. Отвечай кратко: выполнено.',
          { timeoutMs: 30000 }
        );
        ws.send(JSON.stringify({ type: 'optimize_response', profile, status: 'optimized' }));
        invalidateProfilesResponseCache();
      } catch (err) {
        console.error('ws: optimize error', err);
        ws.send(JSON.stringify({ type: 'optimize_error', error: 'optimize failed: ' + (err.message || String(err)) }));
      }
      break;
    }

    case 'ping': {
      ws.send(JSON.stringify({ type: 'pong', ts: Date.now() }));
      break;
    }

    default:
      ws.send(JSON.stringify({ type: 'error', error: 'unknown message type: ' + type }));
  }
}

function broadcast(payload) {
  if (!wss) return;
  for (const client of wss.clients) {
    if (client.readyState === WebSocket.OPEN) {
      client.send(payload);
    }
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
