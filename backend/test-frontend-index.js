// Sanity test for frontend/views/index.html
// Verifies the global custom scrollbar CSS is in place (UX fix).
const fs = require('fs');
const path = require('path');
const assert = require('assert');

const fp = path.join(__dirname, '..', 'frontend', 'views', 'index.html');
assert.ok(fs.existsSync(fp), 'index.html not found');
const src = fs.readFileSync(fp, 'utf8');

// Global scrollbar fix markers
assert.ok(src.indexOf('::-webkit-scrollbar') !== -1,
  'index.html must define ::-webkit-scrollbar (scrollbar fix)');
assert.ok(src.indexOf('scrollbar-width: thin') !== -1,
  'index.html must define scrollbar-width: thin (scrollbar fix)');

console.log('  ✓ index.html has global custom scrollbar styles');
console.log('PASS: test-frontend-index.js');
