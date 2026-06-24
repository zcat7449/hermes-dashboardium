// Tests for routes/profiles.js — buildProfilesResponse, context_limit, context_limit_source.

process.env.PORT = '0';
process.env.HOST = '127.0.0.1';
process.env.DATABASE_URL = '';
process.env.PG_IMPORT_FROM_SQLITE = '0';
process.env.AUTH_USERNAME = '';
process.env.AUTH_PASSWORD = '';
process.env.PROFILES_DIR = '/root/.hermes/profiles';
process.env.KANBAN_BOARDS_DIR = '/root/.hermes/kanban/boards';
process.env.HERMES_BIN = '/usr/local/bin/hermes';
process.env.FRONTEND_DIR = require('path').join(__dirname, '..', 'frontend');

const assert = require('assert');

// Mock hermes-cli before anything else
const hermesCliPath = require.resolve('./services/hermes-cli.js');
require.cache[hermesCliPath] = {
  id: hermesCliPath, filename: hermesCliPath, loaded: true,
  exports: {
    listHermesSessionsImpl: async () => [{ id: 's1', title: 'test' }],
    parseHermesSessionsList: () => [],
    exportHermesSession: async () => ({ id: 's1', messages: [], input_tokens: '500', output_tokens: '200' }),
    deleteHermesSession: async () => true,
    renameHermesSession: async () => true,
    sanitizeChatMessage: (m) => String(m || '').trim(),
    hermesChat: async () => 'mock',
    parseHermesChatOutput: () => ({ session_id: 'mock', response: 'mock' }),
    hermesKanbanBlock: async () => undefined,
    hermesKanbanUnblock: async () => undefined,
    hermesKanbanReassign: async () => undefined,
    hermesKanbanArchive: async () => undefined,
    validateHermesArgs: (args) => args,
    runHermesSessions: async () => '',
  },
};

// Mock sqlite
const sqlitePath = require.resolve('./services/sqlite');
require.cache[sqlitePath] = {
  id: sqlitePath, filename: sqlitePath, loaded: true,
  exports: {
    scanBoardsForProfileTasks: async () => [],
  },
};

// Now require modules (ollama-context will be real, but we control it via setHttpClient)
const { buildProfilesResponse } = require('./routes/profiles');
const { clearCache, setHttpClient } = require('./services/ollama-context');

async function runTests() {
  console.log('--- buildProfilesResponse: context_limit_source=dict ---');

  // getRealNumCtx returns null (no HTTP mock) -> fallback to dict
  clearCache();

  const profiles1 = await buildProfilesResponse(null);
  const backend1 = profiles1.find(p => p.name === 'backend');
  assert(backend1, 'backend profile found');
  // deepseek-v4-flash is in dict as 1000000
  assert.strictEqual(backend1.context_limit, 1000000, 'dict context_limit for deepseek-v4-flash');
  assert.strictEqual(backend1.context_limit_source, 'dict', 'source=dict');
  assert(backend1.provider !== undefined, 'provider field present');
  console.log('✓ backend profile -> context_limit=1000000, source=dict');

  console.log('\n--- buildProfilesResponse: context_limit_source=api ---');

  // Mock HTTP to return num_ctx for deepseek-v4-flash
  clearCache();
  setHttpClient(async (url, body, headers) => {
    if (body.name === 'deepseek-v4-flash') {
      return { parameters: 'num_ctx 65536' };
    }
    return { parameters: '' };
  });

  const profiles2 = await buildProfilesResponse(null);
  const backend2 = profiles2.find(p => p.name === 'backend');
  assert(backend2, 'backend profile found');
  assert.strictEqual(backend2.context_limit, 65536, 'API context_limit');
  assert.strictEqual(backend2.context_limit_source, 'api', 'source=api');
  console.log('✓ backend profile -> context_limit=65536, source=api');

  console.log('\n--- usage_percent: no longer capped at 99 ---');

  // With context_limit=1000 and usage=700, percent should be 70 (not 99)
  clearCache();
  setHttpClient(async (url, body, headers) => {
    if (body.name === 'deepseek-v4-flash') {
      return { parameters: 'num_ctx 1000' };
    }
    return { parameters: '' };
  });

  const profiles3 = await buildProfilesResponse(null);
  const backend3 = profiles3.find(p => p.name === 'backend');
  assert(backend3, 'backend profile found');
  assert.strictEqual(backend3.usage_percent, 70, 'usage_percent=70');
  assert(backend3.usage_percent <= 1000, 'usage_percent capped at 1000');
  console.log('✓ usage_percent=70 (not capped at 99)');

  console.log('\n--- provider field in response ---');

  const profiles4 = await buildProfilesResponse(null);
  const backend4 = profiles4.find(p => p.name === 'backend');
  assert('provider' in backend4, 'provider field exists');
  console.log('✓ provider field present in response');

  console.log('\nProfiles route tests passed');
}

runTests().then(() => process.exit(0)).catch((err) => {
  console.error('\nProfiles route test failed:', err);
  process.exit(1);
});
