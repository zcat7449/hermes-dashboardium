// Sanity test for frontend/views/modal.js
// Verifies the file is syntactically valid and the I18n.t import
// is in place (P3 regression fix for t is not defined).
const fs = require('fs');
const path = require('path');
const assert = require('assert');

const fp = path.join(__dirname, '..', 'frontend', 'views', 'modal.js');
assert.ok(fs.existsSync(fp), 'modal.js not found');
const src = fs.readFileSync(fp, 'utf8');

// P3 regression fix: I18n.t import
assert.ok(src.indexOf('I18n') !== -1,
  'modal.js must reference I18n (t is not defined fix)');
assert.ok(src.indexOf('t = I18n.t') !== -1 || src.indexOf('t = window.Dashboard.I18n.t') !== -1,
  'modal.js must alias t = I18n.t');

// Try to actually parse it as JS (catches syntax errors)
try {
  new Function(src);
  console.log('  ✓ modal.js parses as valid JavaScript');
} catch (e) {
  console.error('  ✗ modal.js syntax error:', e.message);
  process.exit(1);
}

console.log('PASS: test-frontend-modal.js');
