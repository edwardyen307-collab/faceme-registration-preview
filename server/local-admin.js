'use strict';

const crypto = require('crypto');
const { config } = require('./config');

/** One-time token for this process; never written to .env */
const localAdminToken = crypto.randomBytes(24).toString('hex');

function remoteIsLoopback(req) {
  const ra = req.socket && req.socket.remoteAddress;
  if (!ra) return false;
  return (
    ra === '127.0.0.1' ||
    ra === '::1' ||
    ra === '::ffff:127.0.0.1'
  );
}

function hostIsLoopback(hostHeader) {
  if (!hostHeader) return false;
  const host = String(hostHeader).split(',')[0].trim().toLowerCase();
  // allow 127.0.0.1[:port] or localhost[:port] or [::1][:port]
  if (/^127\.0\.0\.1(?::\d+)?$/.test(host)) return true;
  if (/^localhost(?::\d+)?$/.test(host)) return true;
  if (/^\[::1\](?::\d+)?$/.test(host)) return true;
  return false;
}

function originIsLoopback(origin, req) {
  if (!origin) {
    // Same-origin navigations / some tools omit Origin; require Sec-Fetch-Site same-origin or no Origin for GET only handled by caller
    return null; // unknown
  }
  try {
    const u = new URL(origin);
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return false;
    const h = u.hostname.toLowerCase();
    return h === '127.0.0.1' || h === 'localhost' || h === '::1';
  } catch (_) {
    return false;
  }
}

function expectPort() {
  return Number(config.port) || 8443;
}

/**
 * Strict gate for local settings APIs.
 * - TCP peer must be loopback (anti DNS rebinding / remote hit)
 * - Host must be loopback name
 * - Origin if present must be loopback
 * - For mutating methods: require matching X-Faceme-Local-Token
 */
function assertLocalAdmin(req, { mutate } = { mutate: false }) {
  if (!remoteIsLoopback(req)) {
    const err = new Error('僅本機 loopback 可使用此功能');
    err.code = 'NOT_LOOPBACK';
    err.status = 403;
    throw err;
  }
  if (!hostIsLoopback(req.headers.host)) {
    const err = new Error('Host 必須為 127.0.0.1 或 localhost（防 DNS rebinding）');
    err.code = 'BAD_HOST';
    err.status = 403;
    throw err;
  }
  const originCheck = originIsLoopback(req.headers.origin, req);
  if (originCheck === false) {
    const err = new Error('跨站 Origin 已拒絕');
    err.code = 'BAD_ORIGIN';
    err.status = 403;
    throw err;
  }
  if (mutate) {
    // CSRF: require custom header token (not sent by simple form cross-site)
    const tok = req.headers['x-faceme-local-token'];
    if (!tok || tok !== localAdminToken) {
      const err = new Error('缺少或無效的本機管理 token');
      err.code = 'BAD_TOKEN';
      err.status = 403;
      throw err;
    }
    // Prefer same-origin fetch metadata when browser sends it
    const sfs = req.headers['sec-fetch-site'];
    if (sfs && sfs !== 'same-origin' && sfs !== 'none') {
      const err = new Error('Sec-Fetch-Site 非同源');
      err.code = 'BAD_FETCH_SITE';
      err.status = 403;
      throw err;
    }
    // If Origin present must match; if absent (some same-origin) token still required
  }
}

module.exports = {
  localAdminToken,
  remoteIsLoopback,
  hostIsLoopback,
  originIsLoopback,
  assertLocalAdmin,
  expectPort
};
