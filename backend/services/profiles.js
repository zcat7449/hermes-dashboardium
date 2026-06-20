const fs = require('fs');
const path = require('path');
const yaml = require('js-yaml');
const { PROFILES_DIR } = require('../config');

const REAL_HOME = '/root';

function readModel(configPath) {
  try {
    const raw = fs.readFileSync(configPath, 'utf8');
    const cfg = yaml.load(raw) || {};
    if (cfg.model_override) return cfg.model_override;
    if (cfg.model && typeof cfg.model === 'object') {
      const provider = cfg.model.provider || '';
      const model = cfg.model.default || cfg.model.model || '';
      if (provider && model) return `${provider}:${model}`;
      return model || provider || null;
    }
    return cfg.model || null;
  } catch (err) {
    return null;
  }
}

function listProfiles(profileCache) {
  const now = Date.now();
  if (profileCache.data && now - profileCache.ts < profileCache.ttl) {
    return profileCache.data;
  }
  let entries = [];
  try {
    entries = fs.readdirSync(PROFILES_DIR, { withFileTypes: true })
      .filter(d => d.isDirectory())
      .map(d => d.name)
      .sort();
  } catch (err) {
    console.error('failed to read profiles dir', err);
  }
  const data = entries.map(name => {
    const configPath = path.join(PROFILES_DIR, name, 'config.yaml');
    return { name, model: readModel(configPath) };
  });
  profileCache.data = data;
  profileCache.ts = now;
  return data;
}

function getProfileStateDb(profileName) {
  const p = path.join(PROFILES_DIR, profileName, 'state.db');
  if (fs.existsSync(p)) return p;
  if (profileName === 'default') {
    const main = path.join(REAL_HOME, '.hermes', 'state.db');
    if (fs.existsSync(main)) return main;
  }
  return null;
}

module.exports = { listProfiles, getProfileStateDb };
