'use strict';

const { Agent, FormData, fetch } = require('undici');
const { config } = require('../config');
const {
  parseSignInToken,
  parseQcResult,
  parseImportPersonId
} = require('./adapters');

let agent = null;

function getAgent() {
  if (agent) return agent;
  // TLS verify skip is SCOPED to this upstream Agent only — never set
  // process.env.NODE_TLS_REJECT_UNAUTHORIZED.
  const connect = config.skipTlsVerify
    ? { rejectUnauthorized: false }
    : undefined;
  agent = new Agent({
    connect,
    headersTimeout: config.upstreamTimeoutMs,
    bodyTimeout: config.upstreamTimeoutMs
  });
  return agent;
}

function resetAgentForTests() {
  if (agent) {
    agent.close();
    agent = null;
  }
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
      const err = new Error('上游逾時');
      err.code = 'UPSTREAM_TIMEOUT';
      err.status = 504;
      throw err;
    }
    const err = new Error('無法連線上游');
    err.code = 'UPSTREAM_UNREACHABLE';
    err.status = 502;
    throw err;
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

module.exports = {
  signIn,
  snapshotQc,
  personImport,
  upstream,
  resetAgentForTests,
  getAgent
};
