// Sanity test for frontend/views/actions.js
// Verifies the file is syntactically valid and the stuck-send fix
// is in place: sendTimeout variable + onMsg WS listener.
const fs = require('fs');
const path = require('path');
const assert = require('assert');

const fp = path.join(__dirname, '..', 'frontend', 'views', 'actions.js');
assert.ok(fs.existsSync(fp), 'actions.js not found');
const src = fs.readFileSync(fp, 'utf8');

// Stuck-send fix markers
assert.ok(src.indexOf('sendTimeout') !== -1,
  'actions.js must define sendTimeout (stuck-send fix)');
assert.ok(src.indexOf('onMsg') !== -1,
  'actions.js must define onMsg WS listener (stuck-send fix)');

// Try to actually parse it as JS (catches syntax errors)
try {
  new Function(src);
  console.log('  ✓ actions.js parses as valid JavaScript');
} catch (e) {
  console.error('  ✗ actions.js syntax error:', e.message);
  process.exit(1);
}

console.log('PASS: test-frontend-actions.js');
