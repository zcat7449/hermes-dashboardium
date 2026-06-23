// Test Dashboardium sessions endpoints backed by Hermes CLI.
// Does NOT start the HTTP server; tests helper functions directly.
process.env.PORT = '0';
process.env.HOST = '127.0.0.1';
process.env.DATABASE_URL = '';
process.env.PG_IMPORT_FROM_SQLITE = '0';

const assert = require('assert');
const server = require('./server.js');

const TEST_PROFILE = 'backend';

async function testList() {
  const sessions = await server.listHermesSessions(TEST_PROFILE, 5);
  assert(Array.isArray(sessions), 'listHermesSessions should return array');
  assert(sessions.length > 0, `profile ${TEST_PROFILE} should have at least one session`);
  const s = sessions[0];
  assert(typeof s.id === 'string' && s.id.length > 0, 'session id should be non-empty string');
  assert(typeof s.source === 'string', 'session source should be string');
  console.log(`✓ list: ${sessions.length} sessions, first=${s.id}`);
}

async function testExport() {
  const sessions = await server.listHermesSessions(TEST_PROFILE, 1);
  const id = sessions[0].id;
  const full = await server.exportHermesSession(TEST_PROFILE, id);
  assert(full && typeof full === 'object', 'export should return object');
  assert(Array.isArray(full.messages), 'exported session should have messages array');
  console.log(`✓ export: id=${id}, messages=${full.messages.length}`);
}

async function testParse() {
  const sample = [
    'Preview                                            Last Active   Src    ID',
    '───────────────────────────────────────────────────────────────────────────────────────────────',
    'ping                                               2h ago        cli    20260616_080504_840cd1',
    'work kanban task t_aa6d9410                        just now      cli    20260616_100948_15b034',
    'very long preview title with 10m ago inside        3m ago        cli    20260616_100948_15b035',
    '',
  ].join('\n');
  const parsed = server.parseHermesSessionsList ? server.parseHermesSessionsList(sample) : [];
  assert(parsed.length === 3, `parse should return 3 rows, got ${parsed.length}`);
  assert(parsed[0].id === '20260616_080504_840cd1', 'first id mismatch');
  assert(parsed[0].title === 'ping', 'first title mismatch');
  assert(parsed[0].last_active_text === '2h ago', 'first last_active mismatch');
  assert(parsed[1].id === '20260616_100948_15b034', 'second id mismatch');
  assert(parsed[1].title === 'work kanban task t_aa6d9410', 'second title should include full preview');
  assert(parsed[1].last_active_text === 'just now', 'second last_active mismatch');
  assert(parsed[2].title === 'very long preview title with 10m ago inside', 'third title should not consume time fragment');
  assert(parsed[2].last_active_text === '3m ago', 'third last_active mismatch');
  console.log('✓ parse: 3 rows parsed');
}

(async () => {
  try {
    await testList();
    await testExport();
    await testParse();
    console.log('\nAll tests passed');
    process.exit(0);
  } catch (err) {
    console.error('\nTest failed:', err);
    process.exit(1);
  }
})();
