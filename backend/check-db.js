const fs = require('fs');
const path = require('path');
const PROFILES_DIR = process.env.PROFILES_DIR || path.join(process.env.HOME || '/root', '.hermes', 'profiles');
function getProfileStateDb(profileName) {
  const p = path.join(PROFILES_DIR, profileName, 'state.db');
  console.log('checking', p, fs.existsSync(p));
  if (fs.existsSync(p)) return p;
  if (profileName === 'default') {
    const main = path.join(process.env.HOME || '/root', '.hermes', 'state.db');
    if (fs.existsSync(main)) return main;
  }
  return null;
}
console.log('orchestrator result:', getProfileStateDb('orchestrator'));
console.log('backend result:', getProfileStateDb('backend'));
console.log('nonexistent result:', getProfileStateDb('nonexistent_profile'));
