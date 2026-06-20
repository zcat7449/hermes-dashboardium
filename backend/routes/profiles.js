const { isPgAvailable, getPgInitError } = require('../db');
const { listProfiles } = require('../services/profiles');
const { scanBoardsForProfileTasks } = require('../services/sqlite');
const { getCachedSessions, getCachedUsage, invalidateProfilesResponseCache, profileCache, taskCache, profilesResponseCache } = require('../services/cache');
const { MODEL_CONTEXT_LIMITS, DEFAULT_CONTEXT_LIMIT } = require('../config');

function getModelContextLimit(modelStr) {
  const parts = (modelStr || '').split(':');
  const model = parts.length > 1 ? parts.slice(1).join(':') : parts[0];
  return MODEL_CONTEXT_LIMITS[model] || DEFAULT_CONTEXT_LIMIT;
}

async function getProfileTasks() {
  const now = Date.now();
  if (taskCache.data && now - taskCache.ts < taskCache.ttl) {
    return taskCache.data;
  }
  const data = await scanBoardsForProfileTasks();
  taskCache.data = data;
  taskCache.ts = now;
  return data;
}

async function buildProfilesResponse(selectedProfile) {
  const profiles = listProfiles(profileCache);
  const tasks = await getProfileTasks();
  const tasksByAssignee = {};
  for (const task of tasks) {
    if (!tasksByAssignee[task.assignee]) {
      tasksByAssignee[task.assignee] = [];
    }
    tasksByAssignee[task.assignee].push(task);
  }
  const nowSeconds = Math.floor(Date.now() / 1000);
  return Promise.all(profiles.map(async (profile) => {
    const profileTasksRaw = tasksByAssignee[profile.name] || [];
    const profileTasks = profileTasksRaw.map(t => ({
      id: t.id,
      title: t.title,
      status: t.status,
      board: t.board,
      started_at: t.started_at ? new Date(t.started_at * 1000).toISOString() : null,
    }));
    const currentTask = profileTasks.find(t => t.status === 'running')
      || profileTasks.find(t => t.status === 'blocked')
      || profileTasks[0]
      || null;
    const startedAt = currentTask && currentTask.started_at ? currentTask.started_at : null;
    const startedAtSeconds = startedAt ? Math.floor(new Date(startedAt).getTime() / 1000) : null;
    const sinceSeconds = startedAtSeconds ? nowSeconds - startedAtSeconds : 0;
    let status = 'idle';
    if (currentTask) {
      status = currentTask.status === 'running' ? 'running' : currentTask.status;
    }

    let usage = { input_tokens: 0, output_tokens: 0 };
    let activeSession = null;
    if (!selectedProfile || profile.name === selectedProfile) {
      try {
        const sessions = await getCachedSessions(profile.name);
        if (sessions.length > 0) {
          const s = sessions[0];
          activeSession = { id: s.id, title: s.title, started_at: null };
          const full = await getCachedUsage(profile.name, s.id);
          if (full) {
            usage = {
              input_tokens: parseInt(full.input_tokens) || 0,
              output_tokens: parseInt(full.output_tokens) || 0,
            };
            activeSession.started_at = parseFloat(full.started_at) || null;
          }
        }
      } catch (usageErr) {
        console.error('usage read error', profile.name, usageErr.message);
      }
    }

    const contextLimit = getModelContextLimit(profile.model);
    const totalUsage = usage.input_tokens + usage.output_tokens;
    const usagePercent = contextLimit > 0 ? Math.min(99, Math.round((totalUsage / contextLimit) * 100)) : 0;

    return {
      name: profile.name,
      model: profile.model,
      kanban_task: currentTask ? currentTask.id : null,
      kanban_title: currentTask ? currentTask.title : null,
      kanban_board: currentTask ? currentTask.board : null,
      tasks: profileTasks,
      usage_input: usage.input_tokens,
      usage_output: usage.output_tokens,
      usage_percent: usagePercent,
      context_limit: contextLimit,
      status,
      started_at: startedAt,
      since_seconds: Math.floor(sinceSeconds),
    };
  }));
}

function mountProfilesRoutes(app) {
  app.get('/api/health', (req, res) => {
    res.status(200).json({
      status: 'ok',
      postgres: isPgAvailable(),
      postgres_error: getPgInitError(),
    });
  });

  app.get('/api/profiles', async (req, res) => {
    const selectedProfile = typeof req.query.profile === 'string' ? req.query.profile.trim() : null;
    if (selectedProfile && !/^[a-zA-Z0-9_-]+$/.test(selectedProfile)) {
      res.status(400).json({ error: 'invalid profile name' });
      return;
    }
    const now = Date.now();
    if (!selectedProfile && profilesResponseCache.data && now - profilesResponseCache.ts < profilesResponseCache.ttl) {
      res.json(profilesResponseCache.data);
      return;
    }
    try {
      const data = { profiles: await buildProfilesResponse(selectedProfile), polled_at: Date.now() };
      if (!selectedProfile) {
        profilesResponseCache.data = data;
        profilesResponseCache.ts = now;
      }
      res.json(data);
    } catch (err) {
      console.error('profiles endpoint error', err);
      res.status(500).json({ error: 'failed to collect profiles' });
    }
  });
}

module.exports = { mountProfilesRoutes, buildProfilesResponse };
