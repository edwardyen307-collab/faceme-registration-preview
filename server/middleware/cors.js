'use strict';

const { config } = require('../config');

function corsMiddleware(req, res, next) {
  const origin = req.headers.origin;
  if (!origin) {
    // Same-origin / non-browser
    return next();
  }
  if (config.corsOrigins.includes(origin)) {
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Vary', 'Origin');
    res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
    res.setHeader(
      'Access-Control-Allow-Headers',
      'Content-Type, Authorization'
    );
    res.setHeader('Access-Control-Max-Age', '600');
    if (req.method === 'OPTIONS') {
      return res.status(204).end();
    }
    return next();
  }
  // Different origin not in allowlist: no ACAO; block preflight
  if (req.method === 'OPTIONS') {
    return res.status(403).json({ error: 'CORS origin not allowed', code: 'CORS_DENIED' });
  }
  // For actual requests from disallowed origins, still process but browser will block reading.
  // Prefer explicit reject for API paths:
  if (req.path.startsWith('/api/')) {
    return res.status(403).json({ error: 'CORS origin not allowed', code: 'CORS_DENIED' });
  }
  return next();
}

module.exports = { corsMiddleware };
