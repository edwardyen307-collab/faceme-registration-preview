'use strict';

const { config } = require('../config');
const { classifyHost, originIsSameHost, classifyIp, parseHostHeader } = require('../lan-access');

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
  let allowed = isLoopbackOrigin(origin);
  if (!allowed && config.lanAccess && originIsSameHost(origin, req.headers.host, config.port) === true) {
    const h = parseHostHeader(req.headers.host);
    allowed = classifyHost(req.headers.host) === 'private' && classifyIp(h.hostname) === 'private';
  }
  // CORS_ORIGINS (e.g. GitHub Pages) only when talking to loopback Host — never to LAN Host
  if (!allowed && classifyHost(req.headers.host) === 'loopback' && config.corsOrigins.includes(origin)) {
    allowed = true;
  }
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
