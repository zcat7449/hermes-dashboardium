const { spawn, execFile } = require('child_process');
const { promisify } = require('util');
const execFileAsync = promisify(execFile);
const { HERMES_BIN, PROFILE_SWITCH_TIMEOUT_MS, CHAT_TIMEOUT_MS, SESSION_ID_RE } = require('../config');

// ---- Hermes CLI sessions ----

function runHermesSessions(profile, args, timeoutMs = 15000) {
  return new Promise((resolve, reject) => {
    const child = spawn(HERMES_BIN, ['--profile', profile, 'sessions', ...args], {
      timeout: timeoutMs,
      env: { ...process.env, FORCE_COLOR: '0', NO_COLOR: '1' },
    });
    let stdout = '';
    let stderr = '';
    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stdout.on('data', (d) => { stdout += d; });
    child.stderr.on('data', (d) => { stderr += d; });
    child.on('error', (err) => reject(err));
    child.on('close', (code) => {
      if (code !== 0 && code !== null) {
        const err = new Error(stderr.trim() || `hermes sessions exited with ${code}`);
        err.code = code;
        reject(err);
        return;
      }
      resolve(stdout.trim());
    });
  });
}

function parseHermesSessionsList(stdout) {
  const lines = stdout.split(/\r?\n/);
  let headerIndex = -1;
  let format = null; // 'A' = Preview/Last Active/Src/ID, 'B' = Title/Preview/Last Active/ID
  for (let i = 0; i < lines.length; i++) {
    if (/^Preview\s+Last Active\s+Src\s+ID/i.test(lines[i])) {
      headerIndex = i;
      format = 'A';
      break;
    }
    if (/^Title\s+Preview\s+Last Active\s+ID/i.test(lines[i])) {
      headerIndex = i;
      format = 'B';
      break;
    }
  }
  if (headerIndex === -1) return [];

  const header = lines[headerIndex];
  const out = [];

  if (format === 'A') {
    const lastActiveStart = header.indexOf('Last Active');
    const srcStart = header.indexOf('Src');
    const idStart = header.indexOf('ID');
    if (lastActiveStart === -1 || srcStart === -1 || idStart === -1) return [];

    for (let i = headerIndex + 1; i < lines.length; i++) {
      const line = lines[i];
      if (!line || !line.trim()) continue;
      if (/^[-\u2500\u2550\u2501\s]+$/.test(line)) continue;

      const preview = line.slice(0, lastActiveStart).trim() || null;
      const lastActiveText = line.slice(lastActiveStart, srcStart).trim() || null;
      const source = line.slice(srcStart, idStart).trim() || 'cli';
      const id = line.slice(idStart).trim() || null;

      if (!id) continue;
      out.push({
        id,
        title: preview,
        source: source || 'cli',
        last_active_text: lastActiveText,
      });
    }
  } else if (format === 'B') {
    const previewStart = header.indexOf('Preview');
    const lastActiveStart = header.indexOf('Last Active');
    const idStart = header.indexOf('ID');
    if (previewStart === -1 || lastActiveStart === -1 || idStart === -1) return [];

    for (let i = headerIndex + 1; i < lines.length; i++) {
      const line = lines[i];
      if (!line || !line.trim()) continue;
      if (/^[-\u2500\u2550\u2501\s]+$/.test(line)) continue;

      const title = line.slice(0, previewStart).trim() || null;
      const preview = line.slice(previewStart, lastActiveStart).trim() || null;
      const lastActiveText = line.slice(lastActiveStart, idStart).trim() || null;
      const id = line.slice(idStart).trim() || null;

      if (!id) continue;
      out.push({
        id,
        title: title || preview,
        source: 'cli',
        last_active_text: lastActiveText,
      });
    }
  }

  return out;
}

async function listHermesSessionsImpl(profile, limit = 20) {
  const stdout = await runHermesSessions(profile, ['list'], 15000);
  return parseHermesSessionsList(stdout).slice(0, limit);
}

async function exportHermesSession(profile, sessionId) {
  if (!SESSION_ID_RE.test(sessionId)) return null;
  const stdout = await runHermesSessions(profile, ['export', '-', '--session-id', sessionId], 15000);
  const lines = stdout.split(/\r?\n/).filter(Boolean);
  if (!lines.length) return null;
  try {
    return JSON.parse(lines[0]);
  } catch {
    return null;
  }
}

async function deleteHermesSession(profile, sessionId) {
  if (!SESSION_ID_RE.test(sessionId)) return false;
  try {
    await runHermesSessions(profile, ['delete', '--yes', sessionId], 10000);
    return true;
  } catch (err) {
    console.error('hermes sessions delete failed', profile, sessionId, err.message);
    return false;
  }
}

async function renameHermesSession(profile, sessionId, title) {
  if (!SESSION_ID_RE.test(sessionId) || typeof title !== 'string') return false;
  const safeTitle = title.replace(/[\r\n\x00]/g, '');
  try {
    await runHermesSessions(profile, ['rename', sessionId, safeTitle], 10000);
    return true;
  } catch (err) {
    console.error('hermes sessions rename failed', profile, sessionId, err.message);
    return false;
  }
}

// ---- Hermes chat ----

function sanitizeChatMessage(message) {
  return message
    .replace(/(?:^|\s)--?[a-zA-Z0-9_-]+(?=\s|$)/gi, '')
    .replace(/^[\s-]+/, '')
    .replace(/[;&|`$(){}[\]\\]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function validateHermesArgs(args, allowedFlags = []) {
  for (const arg of args) {
    const s = String(arg || '');
    if (allowedFlags.includes(s)) continue;
    if (/^--/.test(s)) {
      throw new Error('refusing to pass option-style argument to hermes CLI');
    }
    if (/^-[a-zA-Z0-9_-]/.test(s)) {
      throw new Error('refusing to pass option-style argument to hermes CLI');
    }
  }
  return args;
}

async function hermesChat(profile, message, options = {}) {
  const { sessionId, timeoutMs = CHAT_TIMEOUT_MS } = options;
  const safeMessage = String(message || '').replace(/^--/g, '').replace(/^-(?=[a-zA-Z])/g, '');
  const baseArgs = sessionId
    ? ['chat', '--resume', sessionId, '-q', safeMessage]
    : ['chat', '-q', safeMessage];
  const args = validateHermesArgs(baseArgs, ['-q', '-Q', '--resume']);
  await execFileAsync(HERMES_BIN, ['profile', 'use', profile], {
    timeout: PROFILE_SWITCH_TIMEOUT_MS,
  });
  let result;
  try {
    const { stdout } = await execFileAsync(HERMES_BIN, args, { timeout: timeoutMs });
    result = stdout;
  } finally {
    try {
      await execFileAsync(HERMES_BIN, ['profile', 'use', 'default'], {
        timeout: PROFILE_SWITCH_TIMEOUT_MS,
      });
    } catch (_) {}
  }
  return result;
}

function parseHermesChatOutput(stdout) {
  const lines = stdout.split(/\r?\n/);
  let sessionId = null;
  let textStart = 0;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    if (line.startsWith('session_id:')) {
      sessionId = line.split(':')[1].trim();
      textStart = i + 1;
      break;
    }
  }
  const responseText = lines.slice(textStart).filter(l => l.trim() !== '').join('\n').trim();
  return { session_id: sessionId, response: responseText };
}

// ---- Hermes status (real context size) ----

async function getHermesStatus(profile) {
  try {
    const { stdout } = await execFileAsync(HERMES_BIN, ['--profile', profile, 'status'], {
      timeout: 10000,
      env: { ...process.env, FORCE_COLOR: '0', NO_COLOR: '1' },
    });
    // Parse "Context: 151,089 / 1,048,576 (14%)"
    const match = stdout.match(/Context:\s*([\d,]+)\s*\/\s*([\d,]+)\s*\((\d+)%\)/);
    if (match) {
      const used = parseInt(match[1].replace(/,/g, ''), 10);
      const limit = parseInt(match[2].replace(/,/g, ''), 10);
      const pct = parseInt(match[3], 10);
      return { used, limit, pct };
    }
  } catch (e) {
    // Silently fail
  }
  return null;
}

async function hermesKanbanBlock(taskId, reason) {
  await execFileAsync(HERMES_BIN, ['kanban', 'block', taskId, reason], { timeout: 10000 });
}

async function hermesKanbanUnblock(taskId, reason) {
  await execFileAsync(HERMES_BIN, ['kanban', 'unblock', taskId, reason], { timeout: 10000 });
}

async function hermesKanbanReassign(taskId, assignee) {
  await execFileAsync(HERMES_BIN, ['kanban', 'reassign', taskId, '--assignee', assignee], { timeout: 10000 });
}

async function hermesKanbanArchive(taskId) {
  await execFileAsync(HERMES_BIN, ['kanban', 'archive', taskId], { timeout: 10000 });
}

module.exports = {
  runHermesSessions,
  parseHermesSessionsList,
  listHermesSessionsImpl,
  exportHermesSession,
  deleteHermesSession,
  renameHermesSession,
  sanitizeChatMessage,
  validateHermesArgs,
  hermesChat,
  parseHermesChatOutput,
  getHermesStatus,
  hermesKanbanBlock,
  hermesKanbanUnblock,
  hermesKanbanReassign,
  hermesKanbanArchive,
};
