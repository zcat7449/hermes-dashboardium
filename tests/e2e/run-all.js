// E2E test runner — runs all .test.js files in this directory sequentially
// Usage:
//   node run-all.js           # run all
//   node run-all.js --list    # list tests
//   node run-all.js --only chat-realtime   # run one test by name

const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');

const DIR = __dirname;
const files = fs.readdirSync(DIR)
  .filter((f) => f.endsWith('.test.js'))
  .sort();

const onlyIdx = process.argv.indexOf('--only');
const onlyName = onlyIdx > -1 ? process.argv[onlyIdx + 1] : null;

if (process.argv.includes('--list')) {
  console.log('Available E2E tests:');
  for (const f of files) console.log('  -', f.replace('.test.js', ''));
  process.exit(0);
}

const toRun = onlyName
  ? files.filter((f) => f.replace('.test.js', '').includes(onlyName))
  : files;

if (toRun.length === 0) {
  console.error('No tests matched: ' + onlyName);
  process.exit(1);
}

console.log('Running ' + toRun.length + ' E2E test(s)...\n');

let passed = 0;
let failed = 0;
const results = [];

(async () => {
  for (const f of toRun) {
    const name = f.replace('.test.js', '');
    process.stdout.write('  ' + name + ' ... ');
    const start = Date.now();

    const result = await new Promise((resolve) => {
      const child = spawn('node', [path.join(DIR, f)], {
        stdio: 'pipe',
        env: { ...process.env, DASHBOARDIUM_URL: process.env.DASHBOARDIUM_URL || 'http://localhost:3010' },
      });
      let stdout = '';
      let stderr = '';
      child.stdout.on('data', (d) => { stdout += d.toString(); });
      child.stderr.on('data', (d) => { stderr += d.toString(); });
      const timer = setTimeout(() => {
        child.kill('SIGTERM');
        resolve({ code: 124, stdout, stderr, killed: true });
      }, 180000); // 3-minute timeout per test
      child.on('exit', (code) => {
        clearTimeout(timer);
        resolve({ code, stdout, stderr, killed: false });
      });
    });

    const dur = ((Date.now() - start) / 1000).toFixed(1);
    if (result.code === 0) {
      console.log('PASS (' + dur + 's)');
      passed++;
    } else {
      console.log('FAIL (' + dur + 's)');
      if (result.stdout) console.log('--- stdout ---\n' + result.stdout);
      if (result.stderr) console.log('--- stderr ---\n' + result.stderr);
      failed++;
    }
    results.push({ name, passed: result.code === 0, dur, killed: result.killed });
  }

  console.log('\n' + '='.repeat(50));
  console.log('Total: ' + toRun.length + ' | Passed: ' + passed + ' | Failed: ' + failed);
  console.log('='.repeat(50));

  if (failed > 0) {
    console.log('\nFailed tests:');
    for (const r of results.filter((r) => !r.passed)) {
      console.log('  ✗ ' + r.name);
    }
  }
  process.exit(failed > 0 ? 1 : 0);
})();
