const { isPgAvailable, insertSessionMessage } = require('../db');
const { invalidateProfilesResponseCache } = require('../services/cache');
const { hermesChat, parseHermesChatOutput, sanitizeChatMessage } = require('../services/hermes-cli');
const { checkChatRateLimit } = require('../middleware/rate-limit');
const auditLog = require('../middleware/audit');
const { SESSION_ID_RE } = require('../config');

function mountChatRoutes(app) {
  app.post('/api/chat/:profile', async (req, res) => {
    const profile = req.params.profile;
    const messageRaw = req.body && typeof req.body.message === 'string' ? req.body.message.trim() : '';
    const sessionId = req.body && typeof req.body.session_id === 'string' ? req.body.session_id.trim() : null;
    if (!messageRaw) {
      res.status(400).json({ error: 'message is required' });
      return;
    }
    if (!/^[a-zA-Z0-9_-]+$/.test(profile)) {
      res.status(400).json({ error: 'invalid profile name' });
      return;
    }
    // Validate client-provided session_id against SESSION_ID_RE before use.
    // sessionId may be null (new session), so only check when non-empty.
    if (sessionId && !SESSION_ID_RE.test(sessionId)) {
      res.status(400).json({ error: 'invalid session id' });
      return;
    }
    if (!checkChatRateLimit(profile)) {
      res.set('Retry-After', '5');
      res.status(429).json({ error: 'rate limit: one message per 5 seconds per profile' });
      return;
    }
    const message = sanitizeChatMessage(messageRaw);
    if (!message) {
      res.status(400).json({ error: 'message became empty after sanitization' });
      return;
    }
    auditLog(req, profile, message);

    let currentSessionId = null;
    let isNewSession = false;
    if (sessionId) {
      currentSessionId = sessionId;
    } else if (isPgAvailable()) {
      currentSessionId = null;
      isNewSession = true;
    }

    try {
      let stdout;
      try {
        stdout = await hermesChat(profile, message, { sessionId: currentSessionId });
      } catch (chatErr) {
        if (currentSessionId && String(chatErr.message || '').includes('Session not found')) {
          currentSessionId = null;
          isNewSession = true;
          stdout = await hermesChat(profile, message, { sessionId: null });
        } else {
          throw chatErr;
        }
      }
      const parsed = parseHermesChatOutput(stdout);
      const responseText = parsed.response || stdout.trim();
      if (isPgAvailable() && currentSessionId) {
        try {
          await insertSessionMessage(currentSessionId, profile, 'user', message);
          await insertSessionMessage(currentSessionId, profile, 'assistant', responseText);
        } catch (err) {
          console.error('failed to persist session messages', err);
        }
      }
      res.json({
        profile,
        response: responseText,
        session_id: currentSessionId || parsed.session_id || null,
        new_session: isNewSession,
      });
      invalidateProfilesResponseCache();
      // Push response to Telegram if configured (async, non-blocking)
      const tgTarget = process.env.TELEGRAM_TARGET;
      // Validate tgTarget format before spawn: must match platform:identifier[:thread]
      // e.g. telegram:-1001234567890, telegram:-1001234567890:17585, discord:#chan, sms:+1551234567
      const TG_TARGET_RE = /^[a-z]+:[-+#A-Za-z0-9]+(?::[A-Za-z0-9._-]+)?$/;
      if (tgTarget && TG_TARGET_RE.test(tgTarget)) {
        const { spawn } = require('child_process');
        const msg = `${profile}: ${responseText.substring(0, 200)}`;
        try {
          const tg = spawn('hermes', ['send', '-t', tgTarget], {
            stdio: ['pipe', 'ignore', 'ignore'],
            timeout: 5000,
          });
          tg.stdin.write(msg);
          tg.stdin.end();
          tg.on('error', () => {}); // best-effort
        } catch {
          // Telegram push is best-effort
        }
      } else if (tgTarget) {
        console.warn('TELEGRAM_TARGET has invalid format, skipping push:', tgTarget);
      }
    } catch (err) {
      console.error('chat error', err);
      res.status(500).json({ error: 'chat failed' });
    }
  });

  app.post('/api/optimize/:profile', async (req, res) => {
    const profile = req.params.profile;
    if (!/^[a-zA-Z0-9_-]+$/.test(profile)) {
      res.status(400).json({ error: 'invalid profile name' });
      return;
    }
    if (!checkChatRateLimit(profile)) {
      res.set('Retry-After', '5');
      res.status(429).json({ error: 'rate limit: one request per 5 seconds per profile' });
      return;
    }
    auditLog(req, profile, 'optimize_context');
    try {
      await hermesChat(
        profile,
        'Очисти контекст, начни новый рабочий цикл. Отвечай кратко: выполнено.',
        { timeoutMs: 30000 }
      );
      res.json({ profile, status: 'optimized' });
      invalidateProfilesResponseCache();
    } catch (err) {
      console.error('optimize error', err);
      res.status(500).json({ error: 'optimize failed' });
    }
  });
}

module.exports = { mountChatRoutes };
