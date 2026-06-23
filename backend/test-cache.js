// Tests for services/cache.js — sessions caching, usage caching, invalidation.

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

// Mock hermes-cli before requiring cache
let listCalls = 0;
let exportCalls = 0;
const hermesCliPath = require.resolve('./services/hermes-cli.js');
require.cache[hermesCliPath] = {
  id: hermesCliPath, filename: hermesCliPath, loaded: true,
  exports: {
    listHermesSessionsImpl: async () => { listCalls++; return [{ id: 's1', title: 'test' }]; },
    parseHermesSessionsList: () => [],
    exportHermesSession: async () => { exportCalls++; return { id: 's1', messages: [] }; },
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

const { getCachedSessions, getCachedUsage, invalidateProfilesResponseCache, profilesResponseCache } = require('./services/cache');

async function runTests() {
  console.log('--- Sessions cache ---');

  // First call — should invoke listHermesSessionsImpl
  listCalls = 0;
  const s1 = await getCachedSessions('test-profile');
  assert.strictEqual(listCalls, 1, 'first call invokes listHermesSessionsImpl');
  assert.strictEqual(s1.length, 1, 'returns 1 session');
  assert.strictEqual(s1[0].id, 's1', 'session id matches');
  console.log('✓ first getCachedSessions -> calls impl, returns data');

  // Second call — should use cache, no new impl call
  const s2 = await getCachedSessions('test-profile');
  assert.strictEqual(listCalls, 1, 'second call uses cache, no new impl call');
  assert.strictEqual(s2.length, 1, 'returns cached 1 session');
  console.log('✓ second getCachedSessions -> cache hit, no impl call');

  // Different profile — new impl call
  const s3 = await getCachedSessions('other-profile');
  assert.strictEqual(listCalls, 2, 'different profile invokes impl');
  console.log('✓ different profile -> new impl call');

  console.log('\n--- Usage cache ---');

  // First call — should invoke exportHermesSession
  exportCalls = 0;
  const u1 = await getCachedUsage('test-profile', 's1');
  assert.strictEqual(exportCalls, 1, 'first call invokes exportHermesSession');
  assert(u1, 'returns session data');
  console.log('✓ first getCachedUsage -> calls impl, returns data');

  // Second call — cache hit
  const u2 = await getCachedUsage('test-profile', 's1');
  assert.strictEqual(exportCalls, 1, 'second call uses cache');
  console.log('✓ second getCachedUsage -> cache hit');

  // Different session — new call
  const u3 = await getCachedUsage('test-profile', 's2');
  assert.strictEqual(exportCalls, 2, 'different session invokes impl');
  console.log('✓ different session -> new impl call');

  console.log('\n--- Profiles response cache invalidation ---');

  // Set some data
  profilesResponseCache.data = { profiles: [], polled_at: 123 };
  profilesResponseCache.ts = Date.now();
  assert(profilesResponseCache.data, 'cache has data');

  // Invalidate
  invalidateProfilesResponseCache();
  assert.strictEqual(profilesResponseCache.data, null, 'cache invalidated');
  console.log('✓ invalidateProfilesResponseCache -> data=null');

  console.log('\nCache tests passed');
}

runTests().then(() => process.exit(0)).catch((err) => {
  console.error('\nCache test failed:', err);
  process.exit(1);
});