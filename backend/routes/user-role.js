const fs = require('fs');
const { USER_ROLE_PATH } = require('../config');
const { invalidateProfilesResponseCache } = require('../services/cache');

function readUserRole() {
  try {
    if (!fs.existsSync(USER_ROLE_PATH)) return { entries: [] };
    const raw = fs.readFileSync(USER_ROLE_PATH, 'utf8');
    const parsed = JSON.parse(raw);
    return { entries: Array.isArray(parsed.entries) ? parsed.entries : [] };
  } catch (err) {
    console.error('failed to read user_role.json', err.message);
    return { entries: [] };
  }
}

function writeUserRole(data) {
  try {
    fs.writeFileSync(USER_ROLE_PATH, JSON.stringify(data, null, 2), 'utf8');
    return true;
  } catch (err) {
    console.error('failed to write user_role.json', err.message);
    return false;
  }
}

function mountUserRoleRoutes(app) {
  // GET /api/user-role
  app.get('/api/user-role', (req, res) => {
    const data = readUserRole();
    res.json(data);
  });

  // POST /api/user-role
  app.post('/api/user-role', (req, res) => {
    const { entries } = req.body || {};
    if (!Array.isArray(entries)) {
      res.status(400).json({ error: 'entries must be an array' });
      return;
    }
    if (entries.length > 4) {
      res.status(400).json({ error: 'maximum 4 entries allowed' });
      return;
    }
    for (const entry of entries) {
      if (typeof entry.userId !== 'string' || !entry.userId) {
        res.status(400).json({ error: 'each entry must have a non-empty userId' });
        return;
      }
      if (entry.role !== 'leader' && entry.role !== 'subordinate') {
        res.status(400).json({ error: 'role must be "leader" or "subordinate"' });
        return;
      }
      if (typeof entry.profile !== 'string' || !entry.profile) {
        res.status(400).json({ error: 'each entry must have a non-empty profile' });
        return;
      }
      if (typeof entry.order !== 'number') {
        res.status(400).json({ error: 'each entry must have a numeric order' });
        return;
      }
    }
    const data = { entries };
    if (writeUserRole(data)) {
      invalidateProfilesResponseCache();
      res.json(data);
    } else {
      res.status(500).json({ error: 'failed to write user_role.json' });
    }
  });

  // DELETE /api/user-role/:profile
  app.delete('/api/user-role/:profile', (req, res) => {
    const profile = req.params.profile;
    if (!/^[a-zA-Z0-9_-]+$/.test(profile)) {
      res.status(400).json({ error: 'invalid profile name' });
      return;
    }
    const data = readUserRole();
    const filtered = data.entries.filter(e => e.profile !== profile);
    if (filtered.length === data.entries.length) {
      res.status(404).json({ error: 'profile not found in user roles' });
      return;
    }
    const newData = { entries: filtered };
    if (writeUserRole(newData)) {
      invalidateProfilesResponseCache();
      res.json(newData);
    } else {
      res.status(500).json({ error: 'failed to write user_role.json' });
    }
  });
}

module.exports = { mountUserRoleRoutes, readUserRole, writeUserRole };
