// WebSocket server for real-time profile updates, chat, and optimize.
// Replaces client-side polling (5s) with server-side push.
const WebSocket = require('ws');
const { buildProfilesResponse } = require('../routes/profiles');
const { hermesChat, parseHermesChatOutput, sanitizeChatMessage } = require('./hermes-cli');
const { getCachedSessions } = require('./cache');
const { exportHermesSession } = require('./hermes-cli');
const { checkChatRateLimit } = require('../middleware/rate-limit');
const auditLog = require('../middleware/audit');
const { isPgAvailable, insertSessionMessage } = require('../db');
const { invalidateProfilesResponseCache } = require('./cache');

const WS_POLL_MS = 30000; // server-side polling interval (30s instead of 5s to reduce load)

let wss = null;
let pollTimer = null;
let pollSeq = 0;

// Track last known message_count per profile per session for delta push
const lastSessionCounts = {}; // { profile: { sessionId: message_count } }

function initWebSocket(httpServer) {
  wss = new WebSocket.Server({ server: httpServer, path: '/ws' });

  wss.on('connection', (ws, req) => {
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

  // Start server-side polling — pushes profiles to all connected clients
  startPolling();

  console.log('WebSocket server initialized on /ws');
}

function startPolling() {
  if (pollTimer) clearInterval(pollTimer);
  pollTimer = setInterval(async () => {
    if (!wss || wss.clients.size === 0) return; // skip when no clients
    try {
      // Clear session cache so message_count is fresh for delta detection
      const { sessionsCache } = require('./cache');
      sessionsCache.clear();
      const data = await buildProfilesResponse(null);
      pollSeq++;

      // Check for new messages in sessions (delta push)
      for (const profile of data) {
        const name = profile.name;
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
            // Update tracked count
            if (!lastSessionCounts[name]) lastSessionCounts[name] = {};
            lastSessionCounts[name][sid] = count;
          }
        } catch (e) {
          // Silently skip profiles with session errors
        }
      }

      const payload = JSON.stringify({
        type: 'profiles',
        seq: pollSeq,
        profiles: data,
        polled_at: Date.now(),
      });
      broadcast(payload);
    } catch (err) {
      console.error('ws: poll error', err.message);
    }
  }, WS_POLL_MS);
}

function stopPolling() {
  if (pollTimer) {
    clearInterval(pollTimer);
    pollTimer = null;
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
  stopPolling();
  if (wss) {
    wss.close();
    wss = null;
  }
}

module.exports = { initWebSocket, closeWebSocket, broadcast };
