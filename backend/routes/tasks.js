const fs = require('fs');
const path = require('path');
const { KANBAN_BOARDS_DIR } = require('../config');
const { getDb } = require('../services/sqlite');
const { hermesKanbanBlock, hermesKanbanUnblock, hermesKanbanReassign, hermesKanbanArchive } = require('../services/hermes-cli');

function mountTasksRoutes(app) {
  // Get full task details
  app.get('/api/tasks/:board/:taskId', async (req, res) => {
    const board = req.params.board;
    const taskId = req.params.taskId;
    if (!/^[a-zA-Z0-9_-]+$/.test(board) || !/^[a-zA-Z0-9_:.-]+$/.test(taskId)) {
      res.status(400).json({ error: 'invalid board or task id' });
      return;
    }

    const boardPath = path.join(KANBAN_BOARDS_DIR, board, 'kanban.db');
    if (!fs.existsSync(boardPath)) {
      res.status(404).json({ error: 'board not found' });
      return;
    }

    const db = await getDb(boardPath);
    if (!db) {
      res.status(500).json({ error: 'failed to open board database' });
      return;
    }

    try {
      const task = db.prepare(
        `SELECT id, title, body, status, assignee, priority, created_at, started_at, completed_at
         FROM tasks WHERE id = ?`
      ).get(taskId);

      if (!task) {
        res.status(404).json({ error: 'task not found' });
        return;
      }

      const events = db.prepare(
        `SELECT id, run_id, kind, payload, created_at FROM task_events WHERE task_id = ? ORDER BY id ASC`
      ).all(taskId).map(e => ({
        id: e.id,
        run_id: e.run_id,
        kind: e.kind,
        payload: e.payload ? JSON.parse(e.payload) : null,
        created_at: e.created_at,
      }));

      const comments = db.prepare(
        `SELECT id, author, body, created_at FROM task_comments WHERE task_id = ? ORDER BY id ASC`
      ).all(taskId).map(c => ({
        id: c.id,
        author: c.author,
        body: c.body,
        created_at: c.created_at,
      }));

      const runs = db.prepare(
        `SELECT id, task_id, profile, status, started_at, ended_at, summary, error
         FROM task_runs WHERE task_id = ? ORDER BY id ASC`
      ).all(taskId).map(r => ({
        run_id: r.id,
        profile: r.profile,
        status: r.status,
        started_at: r.started_at,
        ended_at: r.ended_at || null,
        summary: r.summary || null,
        error: r.error || null,
      }));

      res.json({
        task: {
          id: task.id,
          title: task.title,
          body: task.body,
          status: task.status,
          assignee: task.assignee,
          priority: task.priority,
          created_at: task.created_at,
          started_at: task.started_at || null,
          completed_at: task.completed_at || null,
          board,
        },
        events,
        comments,
        runs,
      });
    } catch (err) {
      console.error('task details error', err);
      res.status(500).json({ error: 'failed to load task details' });
    }
  });

  // Block task
  app.post('/api/tasks/:board/:taskId/block', async (req, res) => {
    const board = req.params.board;
    const taskId = req.params.taskId;
    const reason = req.body && typeof req.body.reason === 'string' ? req.body.reason.trim() : 'Blocked from Dashboardium';
    if (!/^[a-zA-Z0-9_-]+$/.test(board) || !/^[a-zA-Z0-9_:.-]+$/.test(taskId)) {
      res.status(400).json({ error: 'invalid board or task id' });
      return;
    }
    try {
      await hermesKanbanBlock(taskId, reason);
      res.json({ board, task_id: taskId, status: 'blocked', reason });
    } catch (err) {
      console.error('block task error', err);
      res.status(500).json({ error: 'failed to block task' });
    }
  });

  // Unblock task
  app.post('/api/tasks/:board/:taskId/unblock', async (req, res) => {
    const board = req.params.board;
    const taskId = req.params.taskId;
    const reason = req.body && typeof req.body.reason === 'string' ? req.body.reason.trim().slice(0, 200) : 'Unblocked from Dashboardium';
    if (!/^[a-zA-Z0-9_-]+$/.test(board) || !/^[a-zA-Z0-9_:.-]+$/.test(taskId)) {
      res.status(400).json({ error: 'invalid board or task id' });
      return;
    }
    try {
      await hermesKanbanUnblock(taskId, reason);
      res.json({ board, task_id: taskId, status: 'unblocked', reason });
    } catch (err) {
      console.error('unblock task error', err);
      res.status(500).json({ error: 'failed to unblock task' });
    }
  });

  // Reassign task
  app.post('/api/tasks/:board/:taskId/reassign', async (req, res) => {
    const board = req.params.board;
    const taskId = req.params.taskId;
    const assignee = req.body && typeof req.body.assignee === 'string' ? req.body.assignee.trim() : '';
    if (!/^[a-zA-Z0-9_-]+$/.test(board) || !/^[a-zA-Z0-9_:.-]+$/.test(taskId)) {
      res.status(400).json({ error: 'invalid board or task id' });
      return;
    }
    if (!assignee) {
      res.status(400).json({ error: 'assignee is required' });
      return;
    }
    if (!/^[a-zA-Z0-9_-]+$/.test(assignee)) {
      res.status(400).json({ error: 'invalid assignee format' });
      return;
    }
    try {
      await hermesKanbanReassign(taskId, assignee);
      res.json({ board, task_id: taskId, assignee, status: 'reassigned' });
    } catch (err) {
      console.error('reassign task error', err);
      res.status(500).json({ error: 'failed to reassign task' });
    }
  });

  // Archive task
  app.post('/api/tasks/:board/:taskId/archive', async (req, res) => {
    const board = req.params.board;
    const taskId = req.params.taskId;
    if (!/^[a-zA-Z0-9_-]+$/.test(board) || !/^[a-zA-Z0-9_:.-]+$/.test(taskId)) {
      res.status(400).json({ error: 'invalid board or task id' });
      return;
    }
    try {
      await hermesKanbanArchive(taskId);
      res.json({ board, task_id: taskId, status: 'archived' });
    } catch (err) {
      console.error('archive task error', err);
      res.status(500).json({ error: 'failed to archive task' });
    }
  });
}

module.exports = { mountTasksRoutes };
