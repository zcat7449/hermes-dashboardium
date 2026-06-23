// WebSocket tests: spin up the full backend with WS server attached.
// Tests connect, snapshot delivery, ping/pong, and chat validation paths.
// The hermes CLI is mocked so chat paths complete without spawning a real model.

process.env.PORT = '0';
process.env.HOST = '127.0.0.1';
process.env.DATABASE_URL = '';
process.env.PG_IMPORT_FROM_SQLITE = '0';
process.env.AUTH_USERNAME = '';
process.env.AUTH_PASSWORD = '';
process.env.HOME = '/root';
process.env.PROFILES_DIR = '/root/.hermes/profiles';
process.env.KANBAN_BOARDS_DIR = '/root/.hermes/kanban/boards';
process.env.HERMES_BIN = '/usr/local/bin/hermes';
process.env.FRONTEND_DIR = require('path').join(__dirname, '..', 'frontend');

const http = require('http');
const assert = require('assert');

// ---- Mock hermes-cli BEFORE server.js loads it ----
// Replace services/hermes-cli with stub functions so chat/optimize do not
// spawn a real hermes subprocess.
const hermesCliPath = require.resolve('./services/hermes-cli.js');
require.cache[hermesCliPath] = {
  id: hermesCliPath,
  filename: hermesCliPath,
  loaded: true,
  exports: {
    // Sessions: return empty list so chat_update polling has nothing to scan
    listHermesSessionsImpl: async () => [],
    parseHermesSessionsList: () => [],
    exportHermesSession: async () => null,
    deleteHermesSession: async () => true,
    renameHermesSession: async () => true,
    sanitizeChatMessage: (m) => {
      // Strip control chars and shell-meta-like characters to mirror the real impl
      return String(m || '')
        .replace(/(?:^|\s)--?[a-zA-Z0-9_-]+(?=\s|$)/gi, '')
        .replace(/^[\s-]+/, '')
        .replace(/[;&|`$(){}[\]\\]/g, '')
        .replace(/\s+/g, ' ')
        .trim();
    },
    hermesChat: async (_profile, _msg, _opts) => 'session_id: mock-session-123\nhello from mock',
    parseHermesChatOutput: (stdout) => {
      const lines = String(stdout).split(/\r?\n/);
      let sessionId = null;
      let textStart = 0;
      for (let i = 0; i < lines.length; i++) {
        if (lines[i].startsWith('session_id:')) {
          sessionId = lines[i].split(':')[1].trim();
          textStart = i + 1;
          break;
        }
      }
      const response = lines.slice(textStart).filter((l) => l.trim()).join('\n').trim();
      return { session_id: sessionId, response };
    },
    hermesKanbanBlock: async () => undefined,
    hermesKanbanUnblock: async () => undefined,
    hermesKanbanReassign: async () => undefined,
    hermesKanbanArchive: async () => undefined,
    validateHermesArgs: (args) => args,
    runHermesSessions: async () => '',
  },
};

const { app } = require('./server.js');
const { initWebSocket, closeWebSocket } = require('./services/websocket.js');

const WebSocket = require('ws');

function makeServer() {
  const server = http.createServer(app);
  initWebSocket(server);
  return server;
}

function open(port, path = '/ws') {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(`ws://127.0.0.1:${port}${path}`);
    ws.once('open', () => resolve(ws));
    ws.once('error', reject);
  });
}

function nextMessage(ws, predicate, timeoutMs = 5000) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      ws.off('message', onMsg);
      reject(new Error(`timeout waiting for message matching predicate`));
    }, timeoutMs);
    function onMsg(raw) {
      let msg;
      try {
        msg = JSON.parse(raw.toString());
      } catch {
        return;
      }
      if (!predicate || predicate(msg)) {
        clearTimeout(timer);
        ws.off('message', onMsg);
        resolve(msg);
      }
    }
    ws.on('message', onMsg);
  });
}

function send(ws, obj) {
  ws.send(JSON.stringify(obj));
}

async function runTests(port) {
  console.log('--- WS: connection + initial profiles snapshot ---');
  const ws = await open(port);

  // The server pushes a 'profiles' snapshot on connect.
  const snapshot = await nextMessage(ws, (m) => m.type === 'profiles', 5000);
  assert.strictEqual(snapshot.type, 'profiles', 'snapshot.type=profiles');
  assert(Array.isArray(snapshot.profiles), 'snapshot.profiles is array');
  assert(snapshot.profiles.length > 0, `snapshot has profiles, got ${snapshot.profiles.length}`);
  assert(typeof snapshot.seq === 'number', 'snapshot.seq is number');
  console.log(`✓ WS connected, received profiles snapshot (${snapshot.profiles.length} profiles, seq=${snapshot.seq})`);

  console.log('--- WS: ping -> pong ---');
  send(ws, { type: 'ping' });
  const pong = await nextMessage(ws, (m) => m.type === 'pong', 2000);
  assert.strictEqual(pong.type, 'pong', 'pong.type=pong');
  assert(typeof pong.ts === 'number', 'pong.ts is number');
  console.log(`✓ ping -> pong (ts=${pong.ts})`);

  console.log('--- WS: unknown message type ---');
  send(ws, { type: 'bogus' });
  const err = await nextMessage(ws, (m) => m.type === 'error', 2000);
  assert.strictEqual(err.type, 'error', 'unknown type -> error');
  assert(/unknown message type/i.test(err.error || ''), 'error message about unknown type');
  console.log(`✓ unknown message type -> ${err.error}`);

  console.log('--- WS: chat with invalid profile ---');
  send(ws, { type: 'chat', profile: '../bad', message: 'hi' });
  const chatErr = await nextMessage(ws, (m) => m.type === 'chat_error', 2000);
  assert.strictEqual(chatErr.type, 'chat_error', 'invalid profile -> chat_error');
  assert(/invalid profile name/i.test(chatErr.error || ''), 'error about invalid profile');
  console.log(`✓ chat invalid profile -> ${chatErr.error}`);

  console.log('--- WS: chat without message ---');
  send(ws, { type: 'chat', profile: 'backend' });
  const noMsg = await nextMessage(ws, (m) => m.type === 'chat_error', 2000);
  assert.strictEqual(noMsg.type, 'chat_error', 'no message -> chat_error');
  assert(/profile and message required/i.test(noMsg.error || ''), 'error about missing fields');
  console.log(`✓ chat no message -> ${noMsg.error}`);

  console.log('--- WS: chat with empty sanitized message ---');
  // sanitizeChatMessage strips -- flags and special chars; pass a message that becomes empty
  send(ws, { type: 'chat', profile: 'backend', message: ';;;;' });
  const empty = await nextMessage(ws, (m) => m.type === 'chat_error', 2000);
  assert.strictEqual(empty.type, 'chat_error', 'empty message -> chat_error');
  console.log(`✓ chat empty sanitized -> ${empty.error}`);

  console.log('--- WS: optimize without profile ---');
  send(ws, { type: 'optimize' });
  const optNoProf = await nextMessage(ws, (m) => m.type === 'optimize_error', 2000);
  assert.strictEqual(optNoProf.type, 'optimize_error', 'optimize no profile -> optimize_error');
  console.log(`✓ optimize no profile -> ${optNoProf.error}`);

  console.log('--- WS: optimize invalid profile ---');
  send(ws, { type: 'optimize', profile: 'has spaces' });
  const optBad = await nextMessage(ws, (m) => m.type === 'optimize_error', 2000);
  assert.strictEqual(optBad.type, 'optimize_error', 'optimize invalid -> optimize_error');
  console.log(`✓ optimize invalid profile -> ${optBad.error}`);

  console.log('--- WS: chat rate limit (two messages within 5s) ---');
  send(ws, { type: 'chat', profile: 'rate-test', message: 'first message' });
  const chatResp = await nextMessage(ws, (m) => m.type === 'chat_response' || m.type === 'chat_error', 5000);
  // Could be chat_response (mocked) or chat_error (mock not set for this profile)
  assert(['chat_response', 'chat_error'].includes(chatResp.type), `first chat -> ${chatResp.type}`);
  console.log(`✓ first chat -> ${chatResp.type}`);

  // Send another within 5s — should be rate-limited
  send(ws, { type: 'chat', profile: 'rate-test', message: 'second message' });
  const rateLimited = await nextMessage(ws, (m) => m.type === 'chat_error', 2000);
  assert.strictEqual(rateLimited.type, 'chat_error', 'second chat within 5s -> chat_error');
  assert(/rate limit/i.test(rateLimited.error || ''), 'error about rate limit');
  console.log(`✓ second chat within 5s -> ${rateLimited.error}`);

  console.log('--- WS: invalid JSON ---');
  ws.send('not-json-{');
  const jsonErr = await nextMessage(ws, (m) => m.type === 'error', 2000);
  assert.strictEqual(jsonErr.type, 'error', 'invalid json -> error');
  assert(/invalid json/i.test(jsonErr.error || ''), 'error about invalid json');
  console.log(`✓ invalid JSON -> ${jsonErr.error}`);

  ws.close();

  console.log('\nWebSocket tests passed');
}

const server = makeServer();
server.listen(0, '127.0.0.1', async () => {
  const port = server.address().port;
  let exitCode = 0;
  try {
    await runTests(port);
  } catch (err) {
    console.error('\nWS test failed:', err);
    exitCode = 1;
  } finally {
    closeWebSocket();
    server.close(() => process.exit(exitCode));
  }
});
