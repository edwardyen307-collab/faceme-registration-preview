'use strict';

const { Agent, FormData, fetch, buildConnector } = require('undici');
const { config } = require('../config');
const {
  parseSignInToken,
  parseQcResult,
  parseImportPersonId
} = require('./adapters');
const {
  groupListPath,
  groupListMethod,
  groupCreatePath,
  importGroupField,
  listRequestBody,
  createGroupRequestBody,
  parseGroupList,
  parseGroupListPage,
  parseCreatedGroup,
  validateGroupCreateFields,
  findGroupByName,
  MAX_LIST_PAGES,
  buildGroupBody,
  groupBodyEncodingOrder,
  rememberGroupBodyEncoding,
  getRememberedGroupBodyEncoding,
  resetGroupBodyEncodingMemory
} = require('./groups');
const { maskQcPayload } = require('./qc-explain');
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

async function postGroupWithEncoding(token, path, fields) {
  const order = groupBodyEncodingOrder();
  const attempts = [];
  let lastResult = null;
  for (const enc of order) {
    const built = buildGroupBody(fields, enc);
    const headers = Object.assign({ Authorization: token }, built.headers);
    const result = await upstream(path, {
      method: 'POST',
      headers: headers,
      body: built.body
    });
    attempts.push({
      encoding: built.encoding,
      contentType: built.contentType,
      status: result.status
    });
    lastResult = result;
    if (result.status === 415) {
      // Unsupported Media Type — try next encoding only
      continue;
    }
    // Any non-415 outcome stops (success or other error)
    rememberGroupBodyEncoding(built.encoding, { path: path, status: result.status });
    return {
      result: result,
      encoding: built.encoding,
      contentType: built.contentType,
      attempts: attempts
    };
  }
  // All encodings returned 415 (or order empty)
  return {
    result: lastResult || { status: 415, body: { errorMessage: 'HTTP 415 Unsupported Media Type' } },
    encoding: null,
    contentType: null,
    attempts: attempts
  };
}

async function listGroupsRaw(token) {
  const path = groupListPath();
  const method = groupListMethod();
  const pageSize = 100;
  const all = [];
  const seen = new Set();
  const attempted = [];
  let lastResult = null;
  let lastMasked = null;
  let pagesFetched = 0;
  let bodyEncoding = getRememberedGroupBodyEncoding();
  let contentType = null;

  if (method === 'GET') {
    // Rare override: GET list without body
    const result = await upstream(path, {
      method: 'GET',
      headers: { Authorization: token }
    });
    const page = parseGroupListPage(result.status, result.body, pageSize);
    return {
      groups: page.groups,
      result: result,
      attempted: [{ method: 'GET', status: result.status }],
      path: path,
      method: method,
      pagesFetched: 1,
      bodyEncoding: null,
      contentType: null,
      techDetails: page.techDetails
    };
  }

  for (let pageIndex = 0; pageIndex < MAX_LIST_PAGES; pageIndex++) {
    const body = listRequestBody(pageIndex);
    const pack = await postGroupWithEncoding(token, path, body);
    attempted.push({
      body: body,
      encodingAttempts: pack.attempts,
      encoding: pack.encoding,
      status: pack.result && pack.result.status
    });
    lastResult = pack.result;
    pagesFetched++;
    bodyEncoding = pack.encoding || bodyEncoding;
    contentType = pack.contentType || contentType;

    let page;
    try {
      page = parseGroupListPage(pack.result.status, pack.result.body, pageSize);
    } catch (parseErr) {
      parseErr.attempts = pack.attempts;
      parseErr.bodyEncoding = pack.encoding;
      if (pack.attempts && pack.attempts.length) {
        parseErr.message =
          (parseErr.message || '群組列表失敗') +
          '（嘗試編碼：' +
          pack.attempts.map((a) => a.encoding + '=' + a.status).join(', ') +
          '）';
      }
      throw parseErr;
    }
    lastMasked = page.techDetails;
    for (const g of page.groups) {
      const key = String(g.id || g.name).toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      all.push(g);
    }

    if (page.totalPages != null) {
      if (pageIndex + 1 >= page.totalPages) break;
    } else if (!page.maybeMore) {
      break;
    }
  }

  return {
    groups: all,
    result: lastResult,
    attempted: attempted,
    path: path,
    method: method,
    pagesFetched: pagesFetched,
    bodyEncoding: bodyEncoding,
    contentType: contentType,
    techDetails: lastMasked
  };
}

async function listGroups(token) {
  const pack = await listGroupsRaw(token);
  return pack.groups;
}

async function probeGroups(token) {
  try {
    const pack = await listGroupsRaw(token);
    const enc = pack.bodyEncoding || getRememberedGroupBodyEncoding();
    return {
      ok: true,
      path: pack.path,
      method: pack.method,
      httpStatus: pack.result && pack.result.status,
      pagesFetched: pack.pagesFetched,
      bodyEncoding: enc,
      contentType: pack.contentType || null,
      encodingRemembered: getRememberedGroupBodyEncoding(),
      attempted: pack.attempted,
      groups: pack.groups,
      parseError: null,
      techDetails: pack.techDetails,
      note:
        '只讀探測（POST /api/website/group/list，分頁最多 20 頁）。實際 body 編碼=' +
        (enc || '未知') +
        '。權杖未回傳。系統內建群組不可刪改。'
    };
  } catch (e) {
    return {
      ok: false,
      path: groupListPath(),
      method: groupListMethod(),
      httpStatus: e.status || null,
      bodyEncoding: getRememberedGroupBodyEncoding(),
      groups: null,
      parseError: { code: e.code || 'GROUP_LIST_FAILED', message: e.message || String(e) },
      techDetails: e.techDetails || null,
      attempted: e.attempts || null,
      note: '讀取群組失敗（fail closed）。請把技術細節貼給管理員。'
    };
  }
}

async function createGroup(token, name, color, patternId) {
  const fields = validateGroupCreateFields(name, color, patternId);
  const path = groupCreatePath();
  // Confirmed required: name, color, patternId — do NOT send type
  // Live Central: JSON → 415; try multipart → form → json (only on 415)
  const pack = await postGroupWithEncoding(
    token,
    path,
    createGroupRequestBody(fields.name, fields.color, fields.patternId)
  );
  let created;
  try {
    created = parseCreatedGroup(pack.result.status, pack.result.body, fields.name);
  } catch (createErr) {
    createErr.encodingAttempts = pack.attempts;
    createErr.bodyEncoding = pack.encoding;
    if (pack.attempts && pack.attempts.length) {
      createErr.message =
        (createErr.message || '建立群組失敗') +
        '（嘗試編碼：' +
        pack.attempts.map((a) => a.encoding + '=' + a.status).join(', ') +
        '）';
    }
    throw createErr;
  }
  if (!created.id) {
    // Re-list and resolve by name (fail-closed if still missing)
    const groups = await listGroups(token);
    const found = findGroupByName(groups, fields.name);
    if (!found || !found.id) {
      const err = new Error(
        '已建立群組「' + fields.name + '」但回應沒有 id，重新列表也找不到。請到 Central 確認後再匯入。'
      );
      err.code = 'GROUP_CREATE_ID_MISSING';
      err.status = 502;
      err.techDetails = created.techDetails || null;
      err.encodingAttempts = pack.attempts;
      throw err;
    }
    return {
      id: String(found.id),
      name: found.name || fields.name,
      type: found.type || null,
      techDetails: created.techDetails,
      resolvedViaList: true,
      bodyEncoding: pack.encoding || getRememberedGroupBodyEncoding()
    };
  }
  return {
    id: String(created.id),
    name: created.name || fields.name,
    techDetails: created.techDetails,
    resolvedViaList: false,
    bodyEncoding: pack.encoding || getRememberedGroupBodyEncoding()
  };
}

async function personImport(token, { name, employeeId, imageBuffer, filename, mime, groupId, information }) {
  const fd = new FormData();
  fd.append('name', name);
  if (employeeId) fd.append('employeeId', employeeId);
  // Official: groupId is int64. No aliases, no tags, no skipQC, no forceImport.
  const field = importGroupField(); // default groupId
  if (groupId == null || groupId === '') {
    const err = new Error('匯入缺少 groupId');
    err.code = 'GROUP_ID_REQUIRED';
    err.status = 400;
    throw err;
  }
  const gidNum = Number(groupId);
  if (!Number.isFinite(gidNum)) {
    const err = new Error('groupId 必須是數字');
    err.code = 'GROUP_ID_INVALID';
    err.status = 400;
    throw err;
  }
  fd.append(field, String(Math.trunc(gidNum)));
  if (information && typeof information === 'object') {
    fd.append('information', JSON.stringify(information));
  } else if (typeof information === 'string' && information.trim()) {
    fd.append('information', information.trim());
  }
  // snapshot: single image (official allows up to 5; we send one)
  fd.append('snapshot', blobPart(imageBuffer, mime), filename || 'face.jpg');
  const result = await upstream('/api/website/person/import', {
    method: 'POST',
    headers: {
      Authorization: token
    },
    body: fd
  });
  return parseImportPersonId(result.status, result.body, { baseUrl: config.facemeBaseUrl });
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
  listGroups,
  listGroupsRaw,
  probeGroups,
  createGroup,
  personImport,
  postGroupWithEncoding,
  resetGroupBodyEncodingMemory,
  getRememberedGroupBodyEncoding,
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
