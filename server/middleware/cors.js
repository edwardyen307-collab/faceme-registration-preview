'use strict';

const { config } = require('../config');

function isLoopbackOrigin(origin) {
  if (!origin) return false;
  try {
    const u = new URL(origin);
    const h = u.hostname.toLowerCase();
    return h === '127.0.0.1' || h === 'localhost' || h === '::1';
  } catch (_) {
    return false;
  }
}

function corsMiddleware(req, res, next) {
  const origin = req.headers.origin;
  if (!origin) {
    return next();
  }
  const allowed =
    config.corsOrigins.includes(origin) || isLoopbackOrigin(origin);
  if (allowed) {
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Vary', 'Origin');
    res.setHeader('Access-Control-Allow-Methods', 'GET,POST,PUT,OPTIONS');
    res.setHeader(
      'Access-Control-Allow-Headers',
      'Content-Type, Authorization, X-Faceme-Local-Token'
    );
    res.setHeader('Access-Control-Max-Age', '600');
    if (req.method === 'OPTIONS') {
      return res.status(204).end();
    }
    return next();
  }
  if (req.method === 'OPTIONS') {
    return res.status(403).json({ error: 'CORS origin not allowed', code: 'CORS_DENIED' });
  }
  if (req.path.startsWith('/api/')) {
    return res.status(403).json({ error: 'CORS origin not allowed', code: 'CORS_DENIED' });
  }
  return next();
}

module.exports = { corsMiddleware, isLoopbackOrigin };
