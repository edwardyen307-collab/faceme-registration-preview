'use strict';

const fs = require('fs');
const path = require('path');
const os = require('os');

const ENV_PATH = path.join(__dirname, '..', '.env');
const BAK_PATH = path.join(__dirname, '..', '.env.bak');

const MAX_URL_LEN = 200;

/**
 * Validate Central base URL: https only, host/IP + optional port, no path/query/userinfo.
 * @returns {{ ok: true, normalized: string } | { ok: false, code: string, message: string }}
 */
function validateCentralBaseUrl(raw) {
  const s = String(raw || '').trim();
  if (!s) {
    return { ok: false, code: 'EMPTY', message: 'FACEME_BASE_URL 不可空白' };
  }
  if (s.length > MAX_URL_LEN) {
    return { ok: false, code: 'TOO_LONG', message: '網址過長（上限 ' + MAX_URL_LEN + '）' };
  }
  if (/\s/.test(s)) {
    return { ok: false, code: 'WHITESPACE', message: '網址不可含空白' };
  }
  let u;
  try {
    u = new URL(s);
  } catch (_) {
    return { ok: false, code: 'INVALID_URL', message: '網址格式無效' };
  }
  if (u.protocol !== 'https:') {
    return { ok: false, code: 'HTTPS_REQUIRED', message: '僅接受 https://' };
  }
  if (u.username || u.password) {
    return { ok: false, code: 'NO_USERINFO', message: '不可在網址內夾帶帳密' };
  }
  if (u.pathname && u.pathname !== '/') {
    return { ok: false, code: 'NO_PATH', message: '不可含路徑' };
  }
  if (u.search || u.hash) {
    return { ok: false, code: 'NO_QUERY', message: '不可含查詢字串或雜湊' };
  }
  if (!u.hostname) {
    return { ok: false, code: 'NO_HOST', message: '缺少主機名稱' };
  }
  // Reject weird hosts
  if (/[<>"']/.test(u.hostname)) {
    return { ok: false, code: 'BAD_HOST', message: '主機名稱無效' };
  }
  let normalized = 'https://' + u.host; // host includes brackets for IPv6 + port
  normalized = normalized.replace(/\/+$/, '');
  return { ok: true, normalized };
}

function readEnvText() {
  if (!fs.existsSync(ENV_PATH)) return '';
  return fs.readFileSync(ENV_PATH, 'utf8');
}

/**
 * Replace or append FACEME_BASE_URL=... keeping all other lines intact (including passwords).
 */
function upsertFacemeBaseUrl(normalizedUrl) {
  const v = validateCentralBaseUrl(normalizedUrl);
  if (!v.ok) {
    const err = new Error(v.message);
    err.code = v.code;
    err.status = 400;
    throw err;
  }
  const prev = readEnvText();
  const lines = prev.length ? prev.split(/\r?\n/) : [];
  let found = false;
  const nextLines = lines.map((line) => {
    if (/^\s*#/.test(line) || !line.trim()) return line;
    const m = line.match(/^\s*FACEME_BASE_URL\s*=/);
    if (!m) return line;
    found = true;
    return 'FACEME_BASE_URL=' + v.normalized;
  });
  if (!found) {
    if (nextLines.length && nextLines[nextLines.length - 1] !== '') {
      nextLines.push('');
    }
    nextLines.push('FACEME_BASE_URL=' + v.normalized);
  }
  const next = nextLines.join('\n');
  // Ensure trailing newline
  const out = next.endsWith('\n') ? next : next + '\n';

  // backup then atomic write
  if (prev) {
    fs.writeFileSync(BAK_PATH, prev, 'utf8');
  }
  const tmp = ENV_PATH + '.' + process.pid + '.' + Date.now() + '.tmp';
  fs.writeFileSync(tmp, out, 'utf8');
  fs.renameSync(tmp, ENV_PATH);
  return { path: ENV_PATH, bak: prev ? BAK_PATH : null, value: v.normalized };
}

module.exports = {
  ENV_PATH,
  BAK_PATH,
  MAX_URL_LEN,
  validateCentralBaseUrl,
  readEnvText,
  upsertFacemeBaseUrl
};
