'use strict';

/**
 * Opt-in same-LAN access for the registration page and registration APIs.
 * Settings / .env writes stay loopback-only. Public IPs are always rejected.
 */

const os = require('os');
const { config } = require('./config');

const SETTINGS_PATH_PREFIXES = ['/api/local-settings', '/api/person-admin'];
const SETTINGS_PATHS = { '/api/connection-test': true };
// Read-only group list is used by the registration form on LAN/phone.
// /api/groups/probe stays loopback-only (admin diagnostic).
const LAN_API_PATHS = {
  '/api/health': true,
  '/api/consent': true,
  '/api/register': true,
  '/api/groups': true
};

function stripIpv6Brackets(h) {
  const s = String(h || '').trim().toLowerCase();
  if (s.startsWith('[') && s.endsWith(']')) return s.slice(1, -1);
  return s;
}

function normalizeIp(addr) {
  if (!addr) return '';
  let a = String(addr).trim().toLowerCase();
  if (a.startsWith('::ffff:')) a = a.slice(7);
  return stripIpv6Brackets(a);
}

function isLoopbackIp(addr) {
  const a = normalizeIp(addr);
  if (!a) return false;
  if (a === '127.0.0.1' || a === '::1' || a === 'localhost') return true;
  if (/^127\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(a)) return true;
  return false;
}

function ipv4Parts(addr) {
  const m = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(String(addr || ''));
  if (!m) return null;
  const parts = [Number(m[1]), Number(m[2]), Number(m[3]), Number(m[4])];
  if (parts.some((n) => n > 255)) return null;
  return parts;
}

/** RFC1918 10/8, 172.16/12, 192.168/16, plus IPv4 link-local 169.254/16. */
function isPrivateLanIpv4(addr) {
  const p = ipv4Parts(normalizeIp(addr));
  if (!p) return false;
  if (p[0] === 10) return true;
  if (p[0] === 192 && p[1] === 168) return true;
  if (p[0] === 172 && p[1] >= 16 && p[1] <= 31) return true;
  if (p[0] === 169 && p[1] === 254) return true;
  return false;
}

function isLinkLocalOrUniqueLocalIpv6(addr) {
  const a = normalizeIp(addr);
  if (!a || a.indexOf(':') === -1) return false;
  // fe80::/10 link-local; fc00::/7 unique local
  if (a === '::1') return false;
  if (/^fe[89ab][0-9a-f]:/i.test(a) || a.startsWith('fe80:')) return true;
  if (/^f[cd][0-9a-f]{2}:/i.test(a)) return true;
  return false;
}

function isPrivateLanIp(addr) {
  return isPrivateLanIpv4(addr) || isLinkLocalOrUniqueLocalIpv6(addr);
}

function classifyIp(addr) {
  if (isLoopbackIp(addr)) return 'loopback';
  if (isPrivateLanIp(addr)) return 'private';
  if (!addr) return 'invalid';
  return 'public';
}

function parseHostHeader(hostHeader) {
  if (!hostHeader) return { hostname: '', port: null, raw: '' };
  let raw = String(hostHeader).split(',')[0].trim().toLowerCase();
  if (!raw) return { hostname: '', port: null, raw: '' };
  let hostname = raw;
  let port = null;
  if (raw.startsWith('[')) {
    const end = raw.indexOf(']');
    if (end !== -1) {
      hostname = raw.slice(1, end);
      const rest = raw.slice(end + 1);
      if (rest.charAt(0) === ':') port = rest.slice(1);
    }
  } else if (/^[\d.]+(?::\d+)?$/.test(raw) || raw.indexOf(':') !== -1) {
    // IPv4 or hostname[:port] — only split on last : if no more than one colon (not raw ipv6)
    if ((raw.match(/:/g) || []).length === 1) {
      const i = raw.lastIndexOf(':');
      hostname = raw.slice(0, i);
      port = raw.slice(i + 1);
    }
  }
  hostname = stripIpv6Brackets(hostname);
  return { hostname: hostname, port: port, raw: raw };
}

function classifyHost(hostHeader) {
  const { hostname } = parseHostHeader(hostHeader);
  if (!hostname) return 'invalid';
  if (hostname === 'localhost') return 'loopback';
  return classifyIp(hostname);
}

function originHostInfo(origin) {
  if (!origin) return null;
  try {
    const u = new URL(origin);
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return { ok: false };
    return {
      ok: true,
      protocol: u.protocol,
      hostname: u.hostname.toLowerCase().replace(/^\[|\]$/g, ''),
      port: u.port || (u.protocol === 'https:' ? '443' : '80')
    };
  } catch (_) {
    return { ok: false };
  }
}

function originIsSameHost(origin, hostHeader, expectedPort) {
  const info = originHostInfo(origin);
  if (!info) return null;
  if (!info.ok) return false;
  const parsed = parseHostHeader(hostHeader);
  if (info.hostname !== parsed.hostname) return false;
  const hostPort = parsed.port || String(expectedPort || '');
  const originPort = info.port;
  if (hostPort && originPort && String(hostPort) !== String(originPort)) return false;
  return true;
}

function isSettingsPath(pathname) {
  const p = String(pathname || '');
  if (SETTINGS_PATHS[p]) return true;
  for (const pre of SETTINGS_PATH_PREFIXES) {
    if (p === pre || p.startsWith(pre + '/')) return true;
  }
  return false;
}

function isLanAllowedPath(pathname) {
  const p = String(pathname || '');
  if (isSettingsPath(p)) return false;
  if (p.startsWith('/api/')) return Boolean(LAN_API_PATHS[p]);
  return true;
}

function remoteAddress(req) {
  return (req.socket && req.socket.remoteAddress) || '';
}

/**
 * Access decision for a request.
 * Returns { ok: true } or { ok: false, status, code, message }.
 */
function evaluateAccess(req) {
  const pathName = (req.originalUrl || req.url || req.path || '').split('?')[0];
  const host = req.headers && req.headers.host;
  const remote = remoteAddress(req);
  const hostClass = classifyHost(host);
  const remoteClass = classifyIp(remote);

  if (remoteClass === 'public' || hostClass === 'public') {
    return {
      ok: false,
      status: 403,
      code: 'PUBLIC_IP_DENIED',
      message: '不接受來自或指向公網位址的連線'
    };
  }
  if (hostClass === 'invalid') {
    return {
      ok: false,
      status: 403,
      code: 'BAD_HOST',
      message: 'Host 無效'
    };
  }

  const loopbackPair = hostClass === 'loopback' && remoteClass === 'loopback';
  if (loopbackPair) {
    const origin = req.headers && req.headers.origin;
    if (origin) {
      const same = originIsSameHost(origin, host, config.port);
      const oHost = originHostInfo(origin);
      const originLoopback = oHost && oHost.ok && classifyIp(oHost.hostname === 'localhost' ? '127.0.0.1' : oHost.hostname) === 'loopback';
      if (same === false && !originLoopback) {
        return {
          ok: false,
          status: 403,
          code: 'BAD_ORIGIN',
          message: '跨站 Origin 已拒絕'
        };
      }
    }
    return { ok: true, scope: 'loopback' };
  }

  // LAN client must not spoof loopback Host
  if (hostClass === 'loopback' && remoteClass !== 'loopback') {
    return {
      ok: false,
      status: 403,
      code: 'BAD_HOST',
      message: 'Host 必須與連線來源一致'
    };
  }

  const lanPair =
    hostClass === 'private' && (remoteClass === 'private' || remoteClass === 'loopback');

  if (!config.lanAccess) {
    return {
      ok: false,
      status: 403,
      code: 'LAN_DISABLED',
      message: '區網連線未開啟。請在本機 127.0.0.1 的連線設定中開啟「手機連線（區網）」。'
    };
  }

  if (!lanPair) {
    return {
      ok: false,
      status: 403,
      code: 'LAN_DENIED',
      message: '僅允許區網私有位址（RFC1918／link-local）或本機 loopback'
    };
  }

  if (isSettingsPath(pathName)) {
    return {
      ok: false,
      status: 403,
      code: 'NOT_LOOPBACK',
      message: '設定與診斷僅本機 loopback 可使用'
    };
  }

  if (!isLanAllowedPath(pathName)) {
    return {
      ok: false,
      status: 403,
      code: 'LAN_PATH_DENIED',
      message: '此 API 不開放區網存取'
    };
  }

  const origin = req.headers && req.headers.origin;
  if (origin) {
    const same = originIsSameHost(origin, host, config.port);
    if (same !== true) {
      return {
        ok: false,
        status: 403,
        code: 'BAD_ORIGIN',
        message: '跨站 Origin 已拒絕'
      };
    }
  }

  return { ok: true, scope: 'lan' };
}

function accessGateMiddleware(req, res, next) {
  const decision = evaluateAccess(req);
  if (decision.ok) return next();
  const err = new Error(decision.message);
  err.code = decision.code;
  err.status = decision.status || 403;
  next(err);
}

/** IPv4 LAN addresses for display (RFC1918 only, skip loopback / link-local / internal). */
function listLanIpv4Addresses() {
  const out = [];
  const ifaces = os.networkInterfaces() || {};
  for (const name of Object.keys(ifaces)) {
    for (const info of ifaces[name] || []) {
      if (!info || info.internal) continue;
      if ((info.family !== 'IPv4' && info.family !== 4) || info.family === 'IPv6' || info.family === 6) {
        // Node 18: family is number 4 or string 'IPv4'
      }
      const fam = info.family;
      const isV4 = fam === 'IPv4' || fam === 4;
      if (!isV4) continue;
      const addr = info.address;
      const p = ipv4Parts(addr);
      if (!p) continue;
      if (p[0] === 127 || (p[0] === 169 && p[1] === 254)) continue;
      if (!isPrivateLanIpv4(addr)) continue;
      if (out.indexOf(addr) === -1) out.push(addr);
    }
  }
  return out;
}

function phoneUrls(port) {
  const p = Number(port) || Number(config.port) || 8443;
  return listLanIpv4Addresses().map((ip) => 'http://' + ip + ':' + p + '/');
}

function listenHost() {
  return config.lanAccess ? '0.0.0.0' : '127.0.0.1';
}

const FIREWALL_NOTE =
  '第一次對區網監聽時，Windows 可能跳出「Windows 安全性警訊」。請只允許「私人網路」，不要勾選「公用網路」。本程式不會自動修改防火牆。用完請關閉「手機連線（區網）」。';

/**
 * True only when both the TCP peer and the Host header are loopback.
 * LAN Host (even from a loopback socket in tests) is not a local admin page.
 */
function isLoopbackPageRequest(req) {
  const host = req && req.headers && req.headers.host;
  const remote = remoteAddress(req || {});
  return classifyHost(host) === 'loopback' && classifyIp(remote) === 'loopback';
}

/**
 * Strip local-only markup (admin / PC QR card) from HTML served to LAN or Pages-like clients.
 * Markers: <!-- faceme-local-only:NAME:start --> ... <!-- faceme-local-only:NAME:end -->
 */
function stripLocalOnlyHtml(html) {
  return String(html || '').replace(
    /<!--\s*faceme-local-only:[^:]+:start\s*-->[\s\S]*?<!--\s*faceme-local-only:[^:]+:end\s*-->/g,
    ''
  );
}

module.exports = {
  SETTINGS_PATHS,
  LAN_API_PATHS,
  normalizeIp,
  isLoopbackIp,
  isPrivateLanIpv4,
  isPrivateLanIp,
  classifyIp,
  classifyHost,
  parseHostHeader,
  originIsSameHost,
  isSettingsPath,
  isLanAllowedPath,
  evaluateAccess,
  accessGateMiddleware,
  isLoopbackPageRequest,
  stripLocalOnlyHtml,
  listLanIpv4Addresses,
  phoneUrls,
  listenHost,
  FIREWALL_NOTE
};
