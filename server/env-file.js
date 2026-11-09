'use strict';

const fs = require('fs');
const path = require('path');

const ENV_PATH = path.join(__dirname, '..', '.env');
const BAK_PATH = path.join(__dirname, '..', '.env.bak');
const ENV_TXT_PATH = path.join(__dirname, '..', '.env.txt');

const MAX_URL_LEN = 200;

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
  if (/[<>"']/.test(u.hostname)) {
    return { ok: false, code: 'BAD_HOST', message: '主機名稱無效' };
  }
  let normalized = 'https://' + u.host;
  normalized = normalized.replace(/\/+$/, '');
  return { ok: true, normalized };
}

function centralHostIsLoopback(baseUrl) {
  try {
    let h = new URL(String(baseUrl || '')).hostname.toLowerCase();
    // URL.hostname may be [::1] or ::1 depending on Node; strip brackets
    if (h.startsWith('[') && h.endsWith(']')) h = h.slice(1, -1);
    if (h === 'localhost' || h === '127.0.0.1' || h === '::1') return true;
    return false;
  } catch (_) {
    return false;
  }
}

function readEnvText() {
  if (!fs.existsSync(ENV_PATH)) return '';
  let text = fs.readFileSync(ENV_PATH, 'utf8');
  if (text.charCodeAt(0) === 0xfeff) text = text.slice(1);
  return text;
}

function atomicWriteEnv(out) {
  const prev = fs.existsSync(ENV_PATH) ? fs.readFileSync(ENV_PATH, 'utf8') : '';
  if (prev) fs.writeFileSync(BAK_PATH, prev, 'utf8');
  const body = out.endsWith('\n') ? out : out + '\n';
  const tmp = ENV_PATH + '.' + process.pid + '.' + Date.now() + '.tmp';
  fs.writeFileSync(tmp, body, 'utf8');
  fs.renameSync(tmp, ENV_PATH);
  return { path: ENV_PATH, bak: prev ? BAK_PATH : null };
}

/**
 * Replace ALL non-comment lines for key with a single assignment; preserve other lines.
 */
function upsertEnvKey(key, value) {
  if (!/^[A-Z0-9_]+$/.test(key)) {
    const err = new Error('無效的環境變數名稱');
    err.code = 'BAD_KEY';
    err.status = 400;
    throw err;
  }
  const prev = readEnvText();
  const lines = prev.length ? prev.split(/\r?\n/) : [];
  const nextLines = [];
  let wrote = false;
  for (const line of lines) {
    if (!line.trim() || /^\s*#/.test(line)) {
      nextLines.push(line);
      continue;
    }
    const eq = line.indexOf('=');
    if (eq <= 0) {
      nextLines.push(line);
      continue;
    }
    const k = line.slice(0, eq).trim();
    if (k === key) {
      if (!wrote) {
        nextLines.push(key + '=' + value);
        wrote = true;
      }
      // drop duplicate key lines
      continue;
    }
    nextLines.push(line);
  }
  if (!wrote) {
    if (nextLines.length && nextLines[nextLines.length - 1] !== '') nextLines.push('');
    nextLines.push(key + '=' + value);
  }
  const written = atomicWriteEnv(nextLines.join('\n'));
  return { ...written, key, value };
}

function upsertFacemeBaseUrl(normalizedUrl) {
  const v = validateCentralBaseUrl(normalizedUrl);
  if (!v.ok) {
    const err = new Error(v.message);
    err.code = v.code;
    err.status = 400;
    throw err;
  }
  return { ...upsertEnvKey('FACEME_BASE_URL', v.normalized), value: v.normalized };
}

function upsertSkipTlsVerify(enabled) {
  return upsertEnvKey('FACEME_SKIP_TLS_VERIFY', enabled ? '1' : '0');
}

module.exports = {
  ENV_PATH,
  BAK_PATH,
  ENV_TXT_PATH,
  MAX_URL_LEN,
  validateCentralBaseUrl,
  centralHostIsLoopback,
  readEnvText,
  upsertEnvKey,
  upsertFacemeBaseUrl,
  upsertSkipTlsVerify
};
