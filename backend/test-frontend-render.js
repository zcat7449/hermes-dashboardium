// Sanity test for frontend/views/render.js
// Verifies the file is syntactically valid and contains the key exports
// introduced by the session-id filter fix.
const fs = require('fs');
const path = require('path');
const assert = require('assert');

const fp = path.join(__dirname, '..', 'frontend', 'views', 'render.js');
assert.ok(fs.existsSync(fp), 'render.js not found');
const src = fs.readFileSync(fp, 'utf8');

// Must export the key functions via window.Dashboard.Render
assert.ok(src.indexOf('window.Dashboard.Render') !== -1 || src.indexOf('Dashboard.Render') !== -1,
  'render.js should expose window.Dashboard.Render');

// Must have the session-id filter on renderLog
assert.ok(src.indexOf('sessionId') !== -1,
  'render.js must reference sessionId (session-log filter fix)');
assert.ok(src.indexOf('activeSessionMap') !== -1,
  'render.js must reference activeSessionMap for filtering');

// Try to actually parse it as JS (catches syntax errors)
try {
  new Function(src);
  console.log('  ✓ render.js parses as valid JavaScript');
} catch (e) {
  console.error('  ✗ render.js syntax error:', e.message);
  process.exit(1);
}

console.log('PASS: test-frontend-render.js');
