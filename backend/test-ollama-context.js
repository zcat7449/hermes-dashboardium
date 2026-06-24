// Tests for services/ollama-context.js — getRealNumCtx with cache, API, timeout, fallback.

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
const { getRealNumCtx, clearCache, setHttpClient } = require('./services/ollama-context');

async function runTests() {
  console.log('--- getRealNumCtx: mock API returns num_ctx ---');

  clearCache();

  // Mock HTTP client: returns parameters with num_ctx 8192
  setHttpClient(async (url, body, headers) => {
    assert(body.name, 'model name passed in body');
    return { parameters: 'num_ctx 8192\nstop ["<|end|>"]' };
  });

  const result1 = await getRealNumCtx('llama3:8b', 'ollama');
  assert.strictEqual(result1, 8192, 'returns num_ctx from API');
  console.log('✓ getRealNumCtx("llama3:8b", "ollama") -> 8192');

  console.log('\n--- Cache hit on second call ---');

  // Second call should hit cache, not invoke HTTP
  let httpCalls = 0;
  setHttpClient(async () => { httpCalls++; return { parameters: 'num_ctx 99999' }; });

  const result2 = await getRealNumCtx('llama3:8b', 'ollama');
  assert.strictEqual(result2, 8192, 'returns cached value');
  assert.strictEqual(httpCalls, 0, 'no HTTP call on cache hit');
  console.log('✓ second call -> cache hit, no HTTP call');

  console.log('\n--- Different model -> new API call ---');

  const result3 = await getRealNumCtx('gemma3:12b', 'ollama');
  assert.strictEqual(result3, 99999, 'new model fetches from API');
  assert.strictEqual(httpCalls, 1, 'one new HTTP call');
  console.log('✓ different model -> new API call');

  console.log('\n--- API error -> fallback to null ---');

  clearCache();
  setHttpClient(async () => { throw new Error('network error'); });

  const result4 = await getRealNumCtx('unknown:model', 'ollama');
  assert.strictEqual(result4, null, 'returns null on API error');
  console.log('✓ API error -> null (caller falls back to dict/default)');

  console.log('\n--- Timeout (2s) -> fallback to null ---');

  clearCache();
  setHttpClient(async () => {
    await new Promise(r => setTimeout(r, 5000)); // longer than 2s timeout
    return { parameters: 'num_ctx 16384' };
  });

  const result5 = await getRealNumCtx('slow:model', 'ollama');
  assert.strictEqual(result5, null, 'returns null on timeout');
  console.log('✓ timeout -> null');

  console.log('\n--- ollama-cloud provider uses env URL ---');

  clearCache();
  process.env.OLLAMA_CLOUD_URL = 'https://ollama.example.com/api/show';
  process.env.OLLAMA_CLOUD_API_KEY = 'test-key-123';
  let capturedUrl = null;
  let capturedHeaders = null;
  setHttpClient(async (url, body, headers) => {
    capturedUrl = url;
    capturedHeaders = headers;
    return { parameters: 'num_ctx 32768' };
  });

  const result6 = await getRealNumCtx('ollama-cloud:glm-5.2', 'ollama-cloud');
  assert.strictEqual(result6, 32768, 'returns num_ctx for cloud model');
  assert.strictEqual(capturedUrl, 'https://ollama.example.com/api/show', 'uses OLLAMA_CLOUD_URL');
  assert.strictEqual(capturedHeaders['Authorization'], 'Bearer test-key-123', 'sends Bearer token');
  console.log('✓ ollama-cloud -> uses env URL + Bearer token');

  console.log('\n--- modelfile fallback when parameters missing ---');

  clearCache();
  setHttpClient(async () => {
    return { modelfile: 'FROM llama3\nPARAMETER num_ctx 16384\nTEMPLATE ...' };
  });

  const result7 = await getRealNumCtx('custom:model', 'ollama');
  assert.strictEqual(result7, 16384, 'parses num_ctx from modelfile');
  console.log('✓ modelfile fallback -> 16384');

  console.log('\n--- Empty model string -> null ---');

  clearCache();
  const result8 = await getRealNumCtx('', 'ollama');
  assert.strictEqual(result8, null, 'empty model returns null');
  console.log('✓ empty model string -> null');

  console.log('\n--- Cache TTL expiry -> re-fetches ---');

  clearCache();
  let callCount = 0;
  setHttpClient(async () => {
    callCount++;
    return { parameters: `num_ctx ${callCount * 4096}` };
  });

  const r1 = await getRealNumCtx('ttl:test', 'ollama');
  assert.strictEqual(r1, 4096, 'first call returns 4096');
  assert.strictEqual(callCount, 1);

  // Second call within TTL — cache hit
  const r2 = await getRealNumCtx('ttl:test', 'ollama');
  assert.strictEqual(r2, 4096, 'second call returns cached 4096');
  assert.strictEqual(callCount, 1, 'no new HTTP call');
  console.log('✓ cache TTL -> second call returns cached value');

  console.log('\nOllama context tests passed');
}

runTests().then(() => process.exit(0)).catch((err) => {
  console.error('\nOllama context test failed:', err);
  process.exit(1);
});
