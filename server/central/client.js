'use strict';

const { Agent, FormData, fetch, buildConnector } = require('undici');
const { config } = require('../config');
const {
  parseSignInToken,
  parseQcResult,
  parseImportPersonId
} = require('./adapters');
const {
  buildTlsSocketOptions,
  sanitizeConnectOptions,
  explainTlsFailure,
  hostIsIp
} = require('../tls-options');
const { makeUpstreamError, diagnoseUpstreamFailure, sanitizeUrlForDisplay } = require('../upstream-errors');

let agent = null;

function getAgent() {
  if (agent) return agent;
  // TLS verify skip is SCOPED to this upstream Agent only — never set
  // process.env.NODE_TLS_REJECT_UNAUTHORIZED.
  // Node forbids TLS servername=IP; strip it when host/servername is an IP.
  const baseConnector = buildConnector({
    rejectUnauthorized: !config.skipTlsVerify
  });
  const connect = (options, callback) => {
    const opts = sanitizeConnectOptions(options);
    return baseConnector(opts, callback);
  };
  agent = new Agent({
    connect,
    headersTimeout: config.upstreamTimeoutMs,
    bodyTimeout: config.upstreamTimeoutMs
  });
  return agent;
}

function resetAgentForTests() {
  if (agent) {
    try { agent.close(); } catch (_) {}
    agent = null;
  }
}

/** Call after FACEME_BASE_URL changes so next request uses new target / TLS settings. */
function resetUpstreamAgent() {
  resetAgentForTests();
}

function blobPart(buffer, mime) {
  // undici FormData recognizes Blob + filename (3rd append arg)
  return new Blob([buffer], { type: mime || 'application/octet-stream' });
}

async function upstream(pathname, options) {
  const base = config.facemeBaseUrl;
  if (!base) {
    const err = new Error('FACEME_BASE_URL 未設定');
    err.code = 'MISSING_BASE_URL';
    err.status = 503;
    throw err;
  }
  const url = base + pathname;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), config.upstreamTimeoutMs);
  try {
    const res = await fetch(url, {
      ...options,
      dispatcher: getAgent(),
      signal: controller.signal
    });
    const ct = res.headers.get('content-type') || '';
    let body;
    if (ct.includes('application/json')) {
      body = await res.json().catch(() => null);
    } else {
      const text = await res.text();
      try {
        body = JSON.parse(text);
      } catch (_) {
        body = text;
      }
    }
    return { status: res.status, body, contentType: ct };
  } catch (e) {
    if (e.name === 'AbortError') {
      const err = new Error(
        '上游逾時。嘗試連線：' +
          sanitizeUrlForDisplay(url) +
          '（原始代碼：TIMEOUT）'
      );
      err.code = 'UPSTREAM_TIMEOUT';
      err.status = 504;
      throw err;
    }
    throw makeUpstreamError(e, url, 502);
  } finally {
    clearTimeout(timer);
  }
}

async function signIn() {
  const params = new URLSearchParams();
  params.set('account', config.facemeAccount);
  params.set('password', config.facemePassword);
  const result = await upstream('/api/website/account/signIn', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded'
    },
    body: params.toString()
  });
  return parseSignInToken(result.status, result.body, result.contentType);
}

async function snapshotQc(token, imageBuffer, filename, mime) {
  const fd = new FormData();
  fd.append('image', blobPart(imageBuffer, mime), filename || 'face.jpg');
  const result = await upstream('/api/website/snapshot/qc', {
    method: 'POST',
    headers: {
      // Spec: Authorization is the raw token (no "Bearer " prefix)
      Authorization: token
    },
    body: fd
  });
  return parseQcResult(result.status, result.body);
}

async function personImport(token, { name, employeeId, imageBuffer, filename, mime }) {
  const fd = new FormData();
  fd.append('name', name);
  if (employeeId) fd.append('employeeId', employeeId);
  fd.append('snapshot', blobPart(imageBuffer, mime), filename || 'face.jpg');
  const result = await upstream('/api/website/person/import', {
    method: 'POST',
    headers: {
      Authorization: token
    },
    body: fd
  });
  return parseImportPersonId(result.status, result.body);
}


const net = require('net');
const tls = require('tls');
const { URL } = require('url');

/**
 * Read-only connectivity probe (no QC / import).
 * Never logs token or password.
 */
async function connectionProbe(options) {
  const attemptLogin = Boolean(options && options.attemptLogin);
  const steps = [];
  const base = config.facemeBaseUrl;
  if (!base) {
    return {
      ok: false,
      realModeEnabled: config.realModeEnabled,
      skipTlsVerify: config.skipTlsVerify,
      steps: [{ name: 'config', ok: false, detail: 'FACEME_BASE_URL 未設定' }]
    };
  }

  let parsed;
  try {
    parsed = new URL(base);
  } catch (_) {
    return {
      ok: false,
      realModeEnabled: config.realModeEnabled,
      skipTlsVerify: config.skipTlsVerify,
      steps: [{ name: 'config', ok: false, detail: 'FACEME_BASE_URL 無效' }]
    };
  }

  const host = parsed.hostname;
  const port = parsed.port
    ? Number(parsed.port)
    : parsed.protocol === 'http:'
      ? 80
      : 443;

  steps.push({
    name: 'config',
    ok: true,
    detail:
      '目標 ' +
      parsed.protocol +
      '//' +
      host +
      ':' +
      port +
      '（不保證 127.0.0.1 可用；憑證 SAN／主機名須符合）'
  });

  // TCP
  const tcpOk = await new Promise((resolve) => {
    const socket = net.connect({ host, port });
    const timer = setTimeout(() => {
      socket.destroy();
      resolve(false);
    }, Math.min(config.upstreamTimeoutMs, 5000));
    socket.on('connect', () => {
      clearTimeout(timer);
      socket.end();
      resolve(true);
    });
    socket.on('error', () => {
      clearTimeout(timer);
      resolve(false);
    });
  });
  steps.push({
    name: 'tcp',
    ok: tcpOk,
    detail: tcpOk ? 'TCP 連線成功' : 'TCP 連線失敗（服務未聽此位址／防火牆）'
  });
  if (!tcpOk) {
    return {
      ok: false,
      realModeEnabled: config.realModeEnabled,
      skipTlsVerify: config.skipTlsVerify,
      steps
    };
  }

  // TLS (https only)
  if (parsed.protocol === 'https:') {
    const tlsResult = await new Promise((resolve) => {
      let socket;
      try {
        const tlsOpts = buildTlsSocketOptions({
          host,
          port,
          rejectUnauthorized: !config.skipTlsVerify
        });
        socket = tls.connect(tlsOpts);
      } catch (e) {
        resolve({
          ok: false,
          detail: explainTlsFailure(e, host)
        });
        return;
      }
      const timer = setTimeout(() => {
        socket.destroy();
        resolve({ ok: false, detail: 'TLS 握手逾時' });
      }, Math.min(config.upstreamTimeoutMs, 5000));
      socket.on('secureConnect', () => {
        clearTimeout(timer);
        const authorized = socket.authorized;
        const authErr = socket.authorizationError;
        socket.end();
        if (!config.skipTlsVerify && !authorized) {
          resolve({
            ok: false,
            detail: explainTlsFailure(
              { code: String(authErr || 'UNAUTHORIZED'), message: String(authErr || 'unauthorized') },
              host
            )
          });
          return;
        }
        const snNote = hostIsIp(host)
          ? '（目標為 IP，未設定 TLS servername/SNI）'
          : '';
        resolve({
          ok: true,
          detail: config.skipTlsVerify
            ? 'TLS 已連線（目前跳過憑證驗證 — 有 MITM 風險）' + snNote
            : 'TLS 握手成功且憑證通過驗證' + snNote
        });
      });
      socket.on('error', (e) => {
        clearTimeout(timer);
        resolve({
          ok: false,
          detail: explainTlsFailure(e, host)
        });
      });
    });
    steps.push({ name: 'tls', ok: tlsResult.ok, detail: tlsResult.detail });
    if (!tlsResult.ok) {
      return {
        ok: false,
        realModeEnabled: config.realModeEnabled,
        skipTlsVerify: config.skipTlsVerify,
        steps
      };
    }
  } else {
    steps.push({
      name: 'tls',
      ok: true,
      detail: '目標為 http，略過 TLS'
    });
  }

  if (!attemptLogin) {
    steps.push({
      name: 'login',
      ok: true,
      detail: '未要求登入測試（只做連線）。此測試不寫入 Central、不做 QC／import。'
    });
    return {
      ok: steps.every((s) => s.ok),
      realModeEnabled: config.realModeEnabled,
      skipTlsVerify: config.skipTlsVerify,
      steps
    };
  }

  if (!config.facemeAccount || !config.facemePassword) {
    steps.push({
      name: 'login',
      ok: false,
      detail: '.env 未填 FACEME_ACCOUNT／FACEME_PASSWORD，無法做登入測試'
    });
    return {
      ok: false,
      realModeEnabled: config.realModeEnabled,
      skipTlsVerify: config.skipTlsVerify,
      steps
    };
  }

  try {
    await signIn();
    steps.push({
      name: 'login',
      ok: true,
      detail:
        'signIn 成功（token 不記錄、不回傳）。未執行 QC／person import。realMode 閘門未改變。'
    });
  } catch (e) {
    const diag = diagnoseUpstreamFailure(
      e,
      config.facemeBaseUrl + '/api/website/account/signIn'
    );
    steps.push({
      name: 'login',
      ok: false,
      detail: '登入測試失敗：' + (e && e.message && !/fetch failed/i.test(e.message) ? e.message + ' — ' : '') + diag.message
    });
  }

  return {
    ok: steps.every((s) => s.ok),
    realModeEnabled: config.realModeEnabled,
    skipTlsVerify: config.skipTlsVerify,
    steps
  };
}

module.exports = {
  signIn,
  snapshotQc,
  personImport,
  upstream,
  connectionProbe,
  resetAgentForTests,
  resetUpstreamAgent,
  getAgent,
  buildTlsSocketOptions,
  hostIsIp,
  diagnoseUpstreamFailure,
  makeUpstreamError
};
