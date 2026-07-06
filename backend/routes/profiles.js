const { isPgAvailable, getPgInitError } = require('../db');
const log = require('../services/logger');
const { listProfiles } = require('../services/profiles');
const { scanBoardsForProfileTasks } = require('../services/sqlite');
const { getCachedSessions, getCachedUsage, getCachedContextLog, invalidateProfilesResponseCache, profileCache, taskCache, profilesResponseCache } = require('../services/cache');
const { MODEL_CONTEXT_LIMITS, DEFAULT_CONTEXT_LIMIT } = require('../config');
const { getRealNumCtx } = require('../services/ollama-context');

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
    let contextLimit;
    let contextLimitSource;
    let usagePercent = 0;

    // Try getCachedContextLog first — parses agent.log for real current context
    try {
      const ctx = await getCachedContextLog(profile.name);
      if (ctx && ctx.context_used !== undefined) {
        contextLimit = getModelContextLimit(ctx.model);
        contextLimitSource = 'log';
        usage = { input_tokens: ctx.context_used, output_tokens: ctx.output_tokens };
        usagePercent = contextLimit > 0 ? Math.min(1000, Math.round((ctx.context_used / contextLimit) * 100)) : 0;
      }
    } catch (_) {
      // fall through to fallback
    }

    if (contextLimitSource !== 'log') {
      // agent.log had no data — profile is idle or log is empty.
      // Do NOT fall back to exportHermesSession (cumulative tokens, not current context).
      // Show context limit from API/dict, but usage as N/A.
      usagePercent = -1; // signal: no real-time context data
      usage = { input_tokens: 0, output_tokens: 0 };

      try {
        const apiLimit = await getRealNumCtx(profile.model, profile.provider);
        if (apiLimit !== null) {
          contextLimit = apiLimit;
          contextLimitSource = 'api';
        } else {
          contextLimit = getModelContextLimit(profile.model);
          contextLimitSource = contextLimit === DEFAULT_CONTEXT_LIMIT ? 'default' : 'dict';
        }
      } catch (_) {
        contextLimit = getModelContextLimit(profile.model);
        contextLimitSource = contextLimit === DEFAULT_CONTEXT_LIMIT ? 'default' : 'dict';
      }
    }

    return {
      name: profile.name,
      model: profile.model,
      provider: profile.provider,
      kanban_task: currentTask ? currentTask.id : null,
      kanban_title: currentTask ? currentTask.title : null,
      kanban_board: currentTask ? currentTask.board : null,
      tasks: profileTasks,
      usage_input: usage.input_tokens,
      usage_output: usage.output_tokens,
      usage_percent: usagePercent,
      context_limit: contextLimit,
      context_limit_source: contextLimitSource,
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
      log.error('profiles endpoint error', {error: err.message || String(err)});
      res.status(500).json({ error: 'failed to collect profiles' });
    }
  });
}

module.exports = { mountProfilesRoutes, buildProfilesResponse };
