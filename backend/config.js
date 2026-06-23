const path = require('path');
const { homedir } = require('os');

const REAL_HOME = process.env.HOME || homedir();

const PROFILES_DIR = process.env.PROFILES_DIR || path.join(REAL_HOME, '.hermes', 'profiles');
const KANBAN_BOARDS_DIR = process.env.KANBAN_BOARDS_DIR || path.join(REAL_HOME, '.hermes', 'kanban', 'boards');
const PORT = parseInt(process.env.PORT || '3002', 10);
const HOST = process.env.HOST || '0.0.0.0';
const FRONTEND_DIR = process.env.FRONTEND_DIR || path.join(__dirname, '..', 'frontend');
const FRONTEND_ORIGIN_RAW = process.env.FRONTEND_ORIGIN || 'http://localhost:3000';
const ALLOWED_ORIGINS = FRONTEND_ORIGIN_RAW.split(',').map(s => s.trim());
const HERMES_BIN = process.env.HERMES_BIN || 'hermes';
const SQLITE_BUSY_RETRIES = parseInt(process.env.SQLITE_BUSY_RETRIES || '2', 10);
const SQLITE_TIMEOUT_MS = parseInt(process.env.SQLITE_TIMEOUT_MS || '5000', 10);
const GLOBAL_RATE_LIMIT_RPS = parseInt(process.env.GLOBAL_RATE_LIMIT_RPS || '30', 10);
const GLOBAL_RATE_LIMIT_WINDOW_MS = parseInt(process.env.GLOBAL_RATE_LIMIT_WINDOW_MS || '1000', 10);
const CHAT_TIMEOUT_MS = parseInt(process.env.CHAT_TIMEOUT_MS || '120000', 10);
const PROFILE_SWITCH_TIMEOUT_MS = parseInt(process.env.PROFILE_SWITCH_TIMEOUT_MS || '5000', 10);
const PG_IMPORT_FROM_SQLITE = process.env.PG_IMPORT_FROM_SQLITE !== '0';
const USER_ROLE_PATH = path.join(REAL_HOME, '.hermes', 'user_role.json');
const AUTH_USERNAME = process.env.AUTH_USERNAME || '';
const AUTH_PASSWORD = process.env.AUTH_PASSWORD || '';

const { context_limits: MODEL_CONTEXT_LIMITS, default_context_limit: DEFAULT_CONTEXT_LIMIT } = require('./models.json');

const SESSION_ID_RE = /^[a-zA-Z0-9_:.\-]+$/;
const PROFILE_NAME_RE = /^[a-zA-Z0-9_-]+$/;

module.exports = {
  PROFILES_DIR,
  KANBAN_BOARDS_DIR,
  PORT,
  HOST,
  FRONTEND_DIR,
  FRONTEND_ORIGIN_RAW,
  ALLOWED_ORIGINS,
  HERMES_BIN,
  SQLITE_BUSY_RETRIES,
  SQLITE_TIMEOUT_MS,
  GLOBAL_RATE_LIMIT_RPS,
  GLOBAL_RATE_LIMIT_WINDOW_MS,
  CHAT_TIMEOUT_MS,
  PROFILE_SWITCH_TIMEOUT_MS,
  PG_IMPORT_FROM_SQLITE,
  USER_ROLE_PATH,
  AUTH_USERNAME,
  AUTH_PASSWORD,
  MODEL_CONTEXT_LIMITS,
  DEFAULT_CONTEXT_LIMIT,
  SESSION_ID_RE,
  PROFILE_NAME_RE,
};
