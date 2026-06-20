function pathGuardMiddleware(req, res, next) {
  if (req.originalUrl.includes('..')) {
    return res.status(400).json({ error: 'path traversal detected' });
  }
  next();
}

module.exports = pathGuardMiddleware;
