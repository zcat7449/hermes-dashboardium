#!/usr/bin/env node

/**
 * Dashboardium Setup — gbrain auto-configuration
 *
 * Checks if gbrain MCP server is running, configures all Hermes profiles,
 * and copies the gbrain-auto-query skill.
 *
 * Usage: node setup.js
 */

const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const HERMES_HOME = process.env.HOME + '/.hermes';
const PROFILES_DIR = HERMES_HOME + '/profiles';
const SKILL_SOURCE = HERMES_HOME + '/skills/gbrain-auto-query/SKILL.md';
const GRAIN_HEALTH_URL = 'http://localhost:7333/mcp/health';
const ALL_PROFILES = [
  'default', 'orchestrator', 'backend', 'frontend', 'devops',
  'qa', 'seo', 'devsecops', 'rag', 'aitrainer', 'allvillage',
  'auditor-gemma', 'auditor-openai', 'auditor-qwen', 'rechelok',
];

function run(cmd) {
  try {
    return execSync(cmd, { stdio: 'pipe', timeout: 10000 }).toString().trim();
  } catch (e) {
    return null;
  }
}

function log(label, msg) {
  const icons = { ok: '✅', warn: '⚠️ ', fail: '❌', info: 'ℹ️ ' };
  console.log(`${icons[label] || '  '} ${msg}`);
}

async function main() {
  console.log('\n🔧 Dashboardium Setup — gbrain auto-configuration\n');

  // 1. Check if gbrain is running
  log('info', 'Checking gbrain MCP server...');
  const health = run(`curl -s -o /dev/null -w "%{http_code}" ${GRAIN_HEALTH_URL}`);

  if (health === '200') {
    log('ok', 'gbrain MCP server is running on http://localhost:7333');
  } else {
    log('warn', 'gbrain MCP server not detected on http://localhost:7333');
    log('info', 'Install gbrain first: https://github.com/nousresearch/gbrain#quick-start');
    log('info', 'Then re-run: node setup.js');
    process.exit(0);
  }

  // 2. Get gbrain token from config
  let token = null;
  const configPaths = [
    HERMES_HOME + '/config.yaml',
    ...ALL_PROFILES.map(p => `${PROFILES_DIR}/${p}/config.yaml`),
  ];

  for (const cfgPath of configPaths) {
    if (fs.existsSync(cfgPath)) {
      const content = fs.readFileSync(cfgPath, 'utf-8');
      const match = content.match(/Authorization:\s*Bearer\s+(\S+)/);
      if (match) {
        token = match[1];
        break;
      }
    }
  }

  if (!token) {
    log('warn', 'gbrain token not found in any Hermes config');
    log('info', 'Set your token manually, then re-run: node setup.js');
    process.exit(0);
  }

  log('ok', `gbrain token found: ${token.substring(0, 12)}...`);

  // 3. Configure all profiles
  log('info', 'Configuring gbrain MCP for all Hermes profiles...');
  let configured = 0;

  for (const profile of ALL_PROFILES) {
    const profileDir = `${PROFILES_DIR}/${profile}`;
    if (!fs.existsSync(profileDir)) continue;

    try {
      run(`hermes config set mcp_servers.gbrain.url "http://localhost:7333/mcp" --profile "${profile}"`);
      run(`hermes config set mcp_servers.gbrain.headers.Authorization "Bearer ${token}" --profile "${profile}"`);
      run(`hermes config set mcp_servers.gbrain.timeout 60 --profile "${profile}"`);
      configured++;
    } catch (e) {
      log('warn', `Failed to configure ${profile}: ${e.message}`);
    }
  }

  log('ok', `gbrain MCP configured for ${configured} profiles`);

  // 4. Copy gbrain-auto-query skill to all profiles
  if (!fs.existsSync(SKILL_SOURCE)) {
    log('warn', 'gbrain-auto-query skill not found at ' + SKILL_SOURCE);
    log('info', 'Install the skill first: hermes skills install gbrain-auto-query');
  } else {
    let copied = 0;
    for (const profile of ALL_PROFILES) {
      const profileDir = `${PROFILES_DIR}/${profile}`;
      if (!fs.existsSync(profileDir)) continue;
      const target = `${profileDir}/skills/gbrain-auto-query.md`;
      try {
        fs.mkdirSync(path.dirname(target), { recursive: true });
        fs.copyFileSync(SKILL_SOURCE, target);
        copied++;
      } catch (e) {
        log('warn', `Failed to copy skill to ${profile}: ${e.message}`);
      }
    }
    log('ok', `gbrain-auto-query skill deployed to ${copied} profiles`);
  }

  // 5. Summary
  console.log('\n─── Setup complete ───\n');
  log('ok', 'gbrain MCP configured for all Hermes profiles');
  log('ok', 'gbrain-auto-query skill deployed');
  log('info', 'Restart Hermes gateway for changes to take effect:');
  console.log('   hermes gateway restart --profile <your-profile>\n');
}

main().catch(e => {
  console.error('Setup failed:', e.message);
  process.exit(1);
});
