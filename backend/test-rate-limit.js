// Rate-limit Map eviction sweep test.
// Tests that sweepExpiredBuckets() removes expired buckets from all three
// in-memory Maps without starting a real setInterval.

process.env.AUTH_USERNAME = 'test';
process.env.AUTH_PASSWORD = 'test';

const assert = require('assert');

const {
  sweepExpiredBuckets,
  globalIpLimits,
  chatRateLimits,
} = require('./middleware/rate-limit');
const { authFailCounts } = require('./middleware/auth');

function fillMap(map, count, resetAt) {
  for (let i = 0; i < count; i++) {
    map.set(`key-${i}`, { count: i, resetAt });
  }
}

async function runTests() {
  console.log('--- Rate-limit eviction sweep tests ---');

  // 1. Sweep empty maps — no crash
  sweepExpiredBuckets();
  console.log('✓ sweepExpiredBuckets on empty maps — no crash');

  // 2. Fill 1000 expired buckets in each map
  const past = Date.now() - 100000;
  fillMap(globalIpLimits, 1000, past);
  fillMap(chatRateLimits, 1000, past);
  fillMap(authFailCounts, 1000, past);

  assert.strictEqual(globalIpLimits.size, 1000, 'globalIpLimits has 1000 entries');
  assert.strictEqual(chatRateLimits.size, 1000, 'chatRateLimits has 1000 entries');
  assert.strictEqual(authFailCounts.size, 1000, 'authFailCounts has 1000 entries');
  console.log('✓ 1000 expired buckets inserted into each Map');

  // 3. Sweep
  sweepExpiredBuckets();

  assert.strictEqual(globalIpLimits.size, 0, 'globalIpLimits should be empty after sweep');
  assert.strictEqual(chatRateLimits.size, 0, 'chatRateLimits should be empty after sweep');
  assert.strictEqual(authFailCounts.size, 0, 'authFailCounts should be empty after sweep');
  console.log('✓ all 3000 expired buckets evicted by sweepExpiredBuckets');

  // 4. Active buckets (resetAt in future) must NOT be removed
  const future = Date.now() + 60000;
  globalIpLimits.set('active-ip', { count: 1, resetAt: future });
  chatRateLimits.set('active-profile', { count: 1, resetAt: future });
  authFailCounts.set('active-auth', { count: 1, resetAt: future });

  sweepExpiredBuckets();

  assert.strictEqual(globalIpLimits.size, 1, 'active bucket in globalIpLimits preserved');
  assert.strictEqual(chatRateLimits.size, 1, 'active bucket in chatRateLimits preserved');
  assert.strictEqual(authFailCounts.size, 1, 'active bucket in authFailCounts preserved');
  console.log('✓ active (future) buckets preserved after sweep');

  // 5. chatRateLimits buckets have resetAt=undefined (profile -> timestamp pattern)
  //    These should NOT be removed by sweep (no resetAt field)
  chatRateLimits.clear();
  chatRateLimits.set('no-reset', Date.now() - 5000); // just a number, not an object
  sweepExpiredBuckets();
  assert.strictEqual(chatRateLimits.size, 1, 'chatRateLimits with non-object values preserved');
  console.log('✓ chatRateLimits non-object values (profile -> timestamp) preserved');

  // Cleanup
  globalIpLimits.clear();
  chatRateLimits.clear();
  authFailCounts.clear();

  console.log('\nRate-limit eviction sweep tests passed');
}

runTests().then(
  () => process.exit(0),
  (err) => {
    console.error('\nRate-limit test failed:', err);
    process.exit(1);
  },
);
