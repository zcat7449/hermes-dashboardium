const fs = require('fs');
const path = require('path');
const yaml = require('js-yaml');
const log = require('./logger');
const { PROFILES_DIR } = require('../config');

const { homedir } = require('os');
const REAL_HOME = homedir();

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
    log.error('failed to read profiles dir', {error: err.message || String(err)});
  }
  const data = entries.map(name => {
    const configPath = path.join(PROFILES_DIR, name, 'config.yaml');
    const model = readModel(configPath);
    let provider = null;
    try {
      const raw = fs.readFileSync(configPath, 'utf8');
      const cfg = yaml.load(raw) || {};
      if (cfg.model && typeof cfg.model === 'object') {
        provider = cfg.model.provider || null;
      }
    } catch (_) {}
    return { name, model, provider };
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
