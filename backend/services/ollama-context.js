// services/ollama-context.js
// Fetch real num_ctx from Ollama API (/api/show) with caching and fallback.
//
// Local:   POST http://localhost:11434/api/show  {"name":"MODEL"}
// Cloud:   POST <OLLAMA_CLOUD_URL>               {"name":"MODEL"}  + Bearer token
//
// Cache TTL: 1 hour.  Request timeout: 2 seconds.
// On any error → returns null (caller falls back to models.json → DEFAULT).

const http = require('http');
const https = require('https');
const { URL } = require('url');

const CACHE_TTL_MS = 3600 * 1000; // 1 hour
const REQUEST_TIMEOUT_MS = 2000;  // 2 seconds

const cache = new Map();

// --- helpers ---

function getCacheKey(modelStr, provider) {
  return `${provider || 'ollama'}:${modelStr}`;
}

/** Strip provider prefix from model string, e.g. "ollama-cloud:glm-5.2" → "glm-5.2" */
function extractModelName(modelStr) {
  const parts = (modelStr || '').split(':');
  return parts.length > 1 ? parts.slice(1).join(':') : parts[0];
}

// --- HTTP transport (replaceable for tests) ---

let _httpRequestOverride = null;

/** @param {function(string, object, object): Promise<object>} fn */
function setHttpClient(fn) {
  _httpRequestOverride = fn;
}

/**
 * Make a POST request with JSON body.
 * @param {string} urlStr
 * @param {object} body
 * @param {object} headers
 * @returns {Promise<object>} parsed JSON response
 */
function httpRequest(urlStr, body, headers) {
  if (_httpRequestOverride) {
    return _httpRequestOverride(urlStr, body, headers);
  }

  return new Promise((resolve, reject) => {
    const parsed = new URL(urlStr);
    const lib = parsed.protocol === 'https:' ? https : http;
    const port = parsed.port || (parsed.protocol === 'https:' ? 443 : 80);

    const options = {
      method: 'POST',
      hostname: parsed.hostname,
      port,
      path: parsed.pathname + parsed.search,
      headers: { 'Content-Type': 'application/json', ...headers },
    };

    const req = lib.request(options, (res) => {
      let data = '';
      res.on('data', (chunk) => { data += chunk; });
      res.on('end', () => {
        try {
          resolve(JSON.parse(data));
        } catch (e) {
          reject(new Error('Invalid JSON response from Ollama API'));
        }
      });
    });

    req.on('error', (err) => reject(err));
    req.write(JSON.stringify(body));
    req.end();
  });
}

// --- public API ---

/**
 * Get the real num_ctx for a model from the Ollama API.
 *
 * Resolution order:
 *   1. Cache hit (TTL 1h)
 *   2. Ollama API (/api/show) → parse num_ctx from parameters or modelfile
 *   3. null (caller falls back to models.json → DEFAULT)
 *
 * @param {string} modelStr  Full model string, e.g. "ollama-cloud:glm-5.2" or "deepseek-v4-flash"
 * @param {string} provider  Provider name, e.g. "ollama", "ollama-cloud"
 * @returns {Promise<number|null>}
 */
async function getRealNumCtx(modelStr, provider) {
  const key = getCacheKey(modelStr, provider);
  const cached = cache.get(key);
  if (cached && Date.now() - cached.ts < CACHE_TTL_MS) {
    return cached.num_ctx;
  }

  const modelName = extractModelName(modelStr);
  if (!modelName) return null;

  try {
    let url;
    const headers = {};

    if (provider === 'ollama-cloud') {
      url = process.env.OLLAMA_CLOUD_URL || 'https://ollama.com/api/show';
      const apiKey = process.env.OLLAMA_CLOUD_API_KEY;
      if (apiKey) {
        headers['Authorization'] = `Bearer ${apiKey}`;
      }
    } else {
      // Local Ollama
      url = 'http://localhost:11434/api/show';
    }

    const body = { name: modelName };

    const response = await Promise.race([
      httpRequest(url, body, headers),
      new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), REQUEST_TIMEOUT_MS)),
    ]);

    // Parse num_ctx from "parameters" string (e.g. "num_ctx 8192\nstop ...")
    let num_ctx = null;
    if (response && response.parameters) {
      const match = String(response.parameters).match(/num_ctx\s+(\d+)/);
      if (match) num_ctx = parseInt(match[1], 10);
    }
    // Fallback: parse from modelfile
    if (!num_ctx && response && response.modelfile) {
      const match = String(response.modelfile).match(/num_ctx\s+(\d+)/);
      if (match) num_ctx = parseInt(match[1], 10);
    }

    if (num_ctx && num_ctx > 0) {
      cache.set(key, { num_ctx, ts: Date.now() });
      return num_ctx;
    }
  } catch (_err) {
    // Network error, timeout, invalid JSON → fall through to null
  }

  return null;
}

/** Clear the entire cache (for testing). */
function clearCache() {
  cache.clear();
}

module.exports = { getRealNumCtx, clearCache, setHttpClient };
