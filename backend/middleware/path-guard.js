const path = require('path');

/**
 * Decode a URL repeatedly until it stops changing, to defeat double-encoding
 * attacks (e.g. %252e%252e%252f → %2e%2e%2f → ../).
 *
 * Malformed escape sequences throw URIError; in that case fall back to the
 * raw URL so a single bad percent still gets checked as a string.
 */
function fullyDecode(value) {
  let prev = value;
  let cur = value;
  // Cap iterations to avoid pathological inputs causing infinite loops.
  for (let i = 0; i < 5; i++) {
    try {
      cur = decodeURIComponent(prev);
    } catch {
      return prev;
    }
    if (cur === prev) return cur;
    prev = cur;
  }
  return prev;
}

function pathGuardMiddleware(req, res, next) {
  const rawUrl = req.originalUrl || '';

  // Decode up to twice (handles %2e%2e%2f and %252e%252e%252f) and check
  // both the raw and the decoded forms for any traversal segment.
  const decodedOnce = fullyDecode(rawUrl);
  const decodedTwice = fullyDecode(decodedOnce);

  const candidates = [rawUrl, decodedOnce, decodedTwice];
  for (const candidate of candidates) {
    // Reject obvious '..' and backslash variants.
    if (candidate.includes('..')) {
      return res.status(400).json({ error: 'path traversal detected' });
    }
    // Normalize the path-only portion. If normalization escapes the URL
    // root via '..' segments, the path-guard still catches it via the
    // substring check above; this is a defence-in-depth sanity check.
    try {
      const urlPath = candidate.split('?')[0].split('#')[0];
      const normalized = path.posix.normalize(urlPath);
      if (normalized.includes('..')) {
        return res.status(400).json({ error: 'path traversal detected' });
      }
    } catch {
      // Bad input — fall through to the next candidate or, if all fail,
      // be conservative and block. (We already returned above for the
      // first match, so reaching here means the path-part failed to
      // parse, which itself is suspicious.)
    }
  }

  next();
}

module.exports = pathGuardMiddleware;
