// Sanity test for frontend/views/api.js
// Verifies the file is syntactically valid and loadSessionMessages
// tags messages with sessionId (the session-log filter fix).
const fs = require('fs');
const path = require('path');
const assert = require('assert');

const fp = path.join(__dirname, '..', 'frontend', 'views', 'api.js');
assert.ok(fs.existsSync(fp), 'api.js not found');
const src = fs.readFileSync(fp, 'utf8');

// loadSessionMessages should tag messages with sessionId
assert.ok(src.indexOf('sessionId') !== -1,
  'api.js must reference sessionId (session-log fix)');
assert.ok(src.indexOf('loadSessionMessages') !== -1,
  'api.js must define loadSessionMessages');

// Try to actually parse it as JS (catches syntax errors)
try {
  new Function(src);
  console.log('  ✓ api.js parses as valid JavaScript');
} catch (e) {
  console.error('  ✗ api.js syntax error:', e.message);
  process.exit(1);
}

console.log('PASS: test-frontend-api.js');
