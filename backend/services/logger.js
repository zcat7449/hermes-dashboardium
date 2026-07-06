// services/logger.js — structured logger for Dashboardium backend
// Replaces raw console.log/error with timestamped, leveled output.
// Usage: const log = require('./services/logger'); log.info('msg', {key: val});

const LEVELS = { debug: 10, info: 20, warn: 30, error: 40 };
const currentLevel = LEVELS[process.env.LOG_LEVEL || 'info'] || LEVELS.info;

function format(level, message, data) {
  const ts = new Date().toISOString();
  const dataStr = data ? ' ' + JSON.stringify(data) : '';
  return `${ts} [${level.toUpperCase()}] ${message}${dataStr}`;
}

function log(level, message, data) {
  if (LEVELS[level] < currentLevel) return;
  const line = format(level, message, data);
  if (level === 'error') {
    process.stderr.write(line + '\n');
  } else {
    process.stdout.write(line + '\n');
  }
}

module.exports = {
  debug: (msg, data) => log('debug', msg, data),
  info: (msg, data) => log('info', msg, data),
  warn: (msg, data) => log('warn', msg, data),
  error: (msg, data) => log('error', msg, data),
};
