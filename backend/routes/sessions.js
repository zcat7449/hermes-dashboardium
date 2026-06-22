const fs = require('fs');
const path = require('path');
const { PROFILES_DIR, PROFILE_NAME_RE } = require('../config');
const { getProfileStateDb } = require('../services/profiles');
const { getCachedSessions, invalidateProfilesResponseCache, profileCache, taskCache } = require('../services/cache');
const { getSqliteResultWithParams } = require('../services/sqlite');
const { exportHermesSession, deleteHermesSession, renameHermesSession } = require('../services/hermes-cli');
const { isPgAvailable, createPgSession } = require('../db');

function generateSessionId() {
  const now = new Date();
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, '0');
  const d = String(now.getDate()).padStart(2, '0');
  const h = String(now.getHours()).padStart(2, '0');
  const min = String(now.getMinutes()).padStart(2, '0');
  const s = String(now.getSeconds()).padStart(2, '0');
  const rand = Math.random().toString(36).substring(2, 8);
  return `${y}${m}${d}_${h}${min}${s}_${rand}`;
}

function mountSessionsRoutes(app) {
  // Rename profile (session in Dashboardium UI = Hermes profile directory)
  app.post('/api/sessions/rename', async (req, res) => {
    const { name: oldName, new_name: newNameRaw } = req.body || {};
    const newName = typeof newNameRaw === 'string' ? newNameRaw.trim() : '';

    if (!PROFILE_NAME_RE.test(oldName) || !PROFILE_NAME_RE.test(newName)) {
      res.status(400).json({ error: 'invalid profile name(s)' });
      return;
    }
    if (oldName === newName) {
      res.json({ ok: true, name: newName });
      return;
    }

    const oldDir = path.join(PROFILES_DIR, oldName);
    const newDir = path.join(PROFILES_DIR, newName);

    if (!fs.existsSync(oldDir)) {
      res.status(404).json({ error: 'profile not found' });
      return;
    }
    if (fs.existsSync(newDir)) {
      res.status(409).json({ error: 'target profile already exists' });
      return;
    }

    try {
      const oldDb = getProfileStateDb(oldName);
      if (oldDb) {
        getSqliteResultWithParams(
          oldDb,
          "UPDATE sessions SET title = :p0 WHERE LOWER(title) = LOWER(:p1)",
          [newName, oldName]
        );
      }

      fs.renameSync(oldDir, newDir);

      profileCache.data = null;
      taskCache.data = null;
      invalidateProfilesResponseCache();

      res.json({ ok: true, name: newName });
    } catch (err) {
      console.error('profile rename error', err);
      res.status(500).json({ error: 'failed to rename profile', detail: String(err.message || err) });
    }
  });

  // Delete profile
  app.delete('/api/sessions/:name', async (req, res) => {
    const name = req.params.name;

    if (!PROFILE_NAME_RE.test(name)) {
      res.status(400).json({ error: 'invalid profile name' });
      return;
    }

    const profileDir = path.join(PROFILES_DIR, name);
    if (!fs.existsSync(profileDir)) {
      res.status(404).json({ error: 'profile not found' });
      return;
    }

    try {
      fs.rmSync(profileDir, { recursive: true, force: true });

      profileCache.data = null;
      taskCache.data = null;
      invalidateProfilesResponseCache();

      res.json({ ok: true, deleted: true, name });
    } catch (err) {
      console.error('profile delete error', err);
      res.status(500).json({ error: 'failed to delete profile', detail: String(err.message || err) });
    }
  });

  // List sessions for a profile
  app.get('/api/profiles/:profile/sessions', async (req, res) => {
    const profile = req.params.profile;
    if (!/^[a-zA-Z0-9_-]+$/.test(profile)) {
      res.status(400).json({ error: 'invalid profile name' });
      return;
    }
    const profileDir = path.join(PROFILES_DIR, profile);
    if (!fs.existsSync(profileDir)) {
      res.status(404).json({ error: 'profile not found' });
      return;
    }
    try {
      const sessions = await getCachedSessions(profile);
      res.json({ profile, sessions });
    } catch (err) {
      console.error('sessions list error', profile, err);
      res.status(500).json({ error: 'failed to list sessions', detail: String(err.message || err) });
    }
  });

  // Get session messages
  app.get('/api/profiles/:profile/sessions/:id/messages', async (req, res) => {
    const profile = req.params.profile;
    const sessionId = req.params.id;
    if (!/^[a-zA-Z0-9_-]+$/.test(profile) || !/^[a-zA-Z0-9_:.-]+$/.test(sessionId)) {
      res.status(400).json({ error: 'invalid profile or session id' });
      return;
    }
    try {
      const session = await exportHermesSession(profile, sessionId);
      if (!session) {
        res.json({ profile, session_id: sessionId, messages: [] });
        return;
      }
      const rows = Array.isArray(session.messages) ? session.messages : [];
      const messages = rows.map(r => ({
        id: parseInt(r.id) || 0,
        role: r.role,
        content: r.content || '',
        timestamp: parseFloat(r.timestamp),
      })).filter(Boolean);
      res.json({ profile, session_id: sessionId, messages });
    } catch (err) {
      console.error('messages error', err);
      res.status(500).json({ error: 'failed to load messages', detail: String(err.message || err) });
    }
  });

  // Create session
  app.post('/api/profiles/:profile/sessions', async (req, res) => {
    const profile = req.params.profile;
    if (!/^[a-zA-Z0-9_-]+$/.test(profile)) {
      res.status(400).json({ error: 'invalid profile name' });
      return;
    }
    const body = req.body || {};
    const id = body.id || generateSessionId();
    const title = typeof body.title === 'string' ? body.title : null;
    const source = typeof body.source === 'string' ? body.source : 'cli';
    const startedAt = typeof body.started_at === 'number' ? body.started_at : Date.now() / 1000;
    try {
      const dbPath = getProfileStateDb(profile);
      if (!dbPath) {
        res.status(404).json({ error: 'profile state.db not found' });
        return;
      }
      getSqliteResultWithParams(
        dbPath,
        `INSERT INTO sessions (id, source, title, started_at, message_count, archived)
         VALUES (:p0, :p1, :p2, :p3, 0, 0)
         ON CONFLICT (id) DO UPDATE SET title = COALESCE(:p2, excluded.title)`,
        [id, source, title, startedAt]
      );
      if (isPgAvailable()) {
        try {
          await createPgSession({ id, profile, title, source, started_at: startedAt });
        } catch (pgErr) {
          console.error('PG mirror session failed', profile, id, pgErr.message);
        }
      }
      res.status(201).json({ id, profile, title, source, started_at: startedAt });
      invalidateProfilesResponseCache();
    } catch (err) {
      console.error('session create error', err);
      res.status(500).json({ error: 'failed to create session', detail: String(err.message || err) });
    }
  });

  // PATCH rename session (NOOP)
  app.patch('/api/profiles/:profile/sessions/:id', async (req, res) => {
    const profile = req.params.profile;
    const id = req.params.id;
    if (!/^[a-zA-Z0-9_-]+$/.test(profile) || !/^[a-zA-Z0-9_:.-]+$/.test(id)) {
      res.status(400).json({ error: 'invalid profile or session id' });
      return;
    }
    invalidateProfilesResponseCache();
    res.status(501).json({ error: 'not implemented', detail: 'session rename not implemented' });
  });

  // DELETE session
  app.delete('/api/profiles/:profile/sessions/:id', async (req, res) => {
    const profile = req.params.profile;
    const id = req.params.id;
    if (!/^[a-zA-Z0-9_-]+$/.test(profile) || !/^[a-zA-Z0-9_:.-]+$/.test(id)) {
      res.status(400).json({ error: 'invalid profile or session id' });
      return;
    }
    try {
      const ok = await deleteHermesSession(profile, id);
      if (ok) {
        // Invalidate caches so next list reflects the deletion
        invalidateProfilesResponseCache();
        sessionsCache.delete(profile);
        res.json({ profile, session_id: id, status: 'deleted' });
      } else {
        res.status(500).json({ error: 'failed to delete session' });
      }
    } catch (err) {
      console.error('delete session error', err);
      res.status(500).json({ error: 'failed to delete session', detail: String(err.message || err) });
    }
  });
}

module.exports = { mountSessionsRoutes, generateSessionId };
