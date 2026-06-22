const { isPgAvailable, insertSessionMessage } = require('../db');
const { invalidateProfilesResponseCache } = require('../services/cache');
const { hermesChat, parseHermesChatOutput, sanitizeChatMessage } = require('../services/hermes-cli');
const { checkChatRateLimit } = require('../middleware/rate-limit');
const auditLog = require('../middleware/audit');

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
      // Push response to Telegram if configured
      try {
        const { spawnSync } = require('child_process');
        const tgTarget = process.env.TELEGRAM_TARGET || 'telegram';
        const msg = `*${profile}*: ${responseText.substring(0, 200)}`;
        spawnSync('hermes', ['send', '-t', tgTarget], { input: msg, timeout: 5000, stdio: ['pipe', 'ignore', 'ignore'] });
      } catch (tgErr) {
        // Telegram push is best-effort
      }
    } catch (err) {
      console.error('chat error', err);
      res.status(500).json({ error: 'chat failed', detail: String(err.message || err) });
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
      res.status(500).json({ error: 'optimize failed', detail: String(err.message || err) });
    }
  });
}

module.exports = { mountChatRoutes };
