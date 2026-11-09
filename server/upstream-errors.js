'use strict';

const fs = require('fs');
const path = require('path');
const { explainTlsFailure } = require('./tls-options');

const LOG_PATH = path.join(__dirname, '..', 'runtime', 'upstream.log');

function ensureLogDir() {
  try {
    fs.mkdirSync(path.dirname(LOG_PATH), { recursive: true });
  } catch (_) {}
}

function appendUpstreamLog(line) {
  try {
    ensureLogDir();
    fs.appendFileSync(
      LOG_PATH,
      new Date().toISOString() + ' ' + String(line).replace(/\r?\n/g, ' ') + '\n',
      'utf8'
    );
  } catch (_) {}
  try {
    console.warn('[upstream] ' + line);
  } catch (_) {}
}

/** Strip userinfo from URL for display/logs. */
function sanitizeUrlForDisplay(rawUrl) {
  try {
    const u = new URL(String(rawUrl || ''));
    u.username = '';
    u.password = '';
    return u.toString();
  } catch (_) {
    return String(rawUrl || '').replace(/\/\/[^/@]+@/g, '//');
  }
}

/**
 * Flatten undici TypeError("fetch failed") → cause → AggregateError.errors.
 * @returns {{ codes: string[], messages: string[], nodes: object[] }}
 */
function collectErrorChain(err) {
  const codes = [];
  const messages = [];
  const nodes = [];
  const seen = new Set();

  function walk(e, depth) {
    if (!e || depth > 8) return;
    if (typeof e !== 'object' && typeof e !== 'function') {
      messages.push(String(e));
      return;
    }
    if (seen.has(e)) return;
    seen.add(e);
    nodes.push(e);
    if (e.code) codes.push(String(e.code));
    if (e.message) messages.push(String(e.message));
    if (e.cause) walk(e.cause, depth + 1);
    if (Array.isArray(e.errors)) {
      for (const sub of e.errors) walk(sub, depth + 1);
    }
  }

  walk(err, 0);
  return { codes: unique(codes), messages: unique(messages), nodes };
}

function unique(arr) {
  const out = [];
  const s = new Set();
  for (const x of arr) {
    if (!s.has(x)) {
      s.add(x);
      out.push(x);
    }
  }
  return out;
}

function firstMatchingCode(codes, list) {
  for (const c of list) {
    if (codes.includes(c)) return c;
  }
  return null;
}

/**
 * Build plain-language diagnosis for upstream connect/fetch failures.
 * Never includes credentials.
 */
function diagnoseUpstreamFailure(err, attemptedUrl) {
  const safeUrl = sanitizeUrlForDisplay(attemptedUrl);
  const chain = collectErrorChain(err);
  const codes = chain.codes;
  const joinedMsg = chain.messages.join(' | ');

  let kind = 'UNKNOWN';
  let advice = '';

  const tlsCode = firstMatchingCode(codes, [
    'DEPTH_ZERO_SELF_SIGNED_CERT',
    'SELF_SIGNED_CERT_IN_CHAIN',
    'UNABLE_TO_VERIFY_LEAF_SIGNATURE',
    'ERR_TLS_CERT_ALTNAME_INVALID',
    'CERT_HAS_EXPIRED',
    'ERR_TLS_CERT_ALTNAME_INVALID',
    'CERT_UNTRUSTED',
    'UNABLE_TO_GET_ISSUER_CERT',
    'UNABLE_TO_GET_ISSUER_CERT_LOCALLY'
  ]);

  if (codes.includes('ECONNREFUSED')) {
    kind = 'ECONNREFUSED';
    advice =
      '連線被拒絕：這個位址／連接埠沒有服務在聽。' +
      '請確認 FaceMe Central 是否已啟動，以及 FACEME_BASE_URL 的主機與連接埠是否正確' +
      '（例如 https://127.0.0.1 預設走 443；若 Central 在其他埠請寫成 https://127.0.0.1:埠號）。';
  } else if (codes.includes('ENOTFOUND') || codes.includes('EAI_AGAIN')) {
    kind = 'ENOTFOUND';
    advice =
      '找不到主機名稱（DNS）。請檢查 FACEME_BASE_URL 是否打錯，或改用 IP／正確主機名。';
  } else if (
    codes.includes('ETIMEDOUT') ||
    codes.includes('UND_ERR_CONNECT_TIMEOUT') ||
    codes.includes('UND_ERR_HEADERS_TIMEOUT') ||
    codes.includes('UND_ERR_BODY_TIMEOUT') ||
    /timeout/i.test(joinedMsg)
  ) {
    kind = 'TIMEOUT';
    advice =
      '連線逾時：對方沒有在時限內回應。請確認 Central 有開、防火牆未擋，以及位址／埠正確。';
  } else if (tlsCode || /certificate|SSL|TLS|self.?signed|altname/i.test(joinedMsg)) {
    kind = tlsCode || 'TLS_CERT';
    let host = '';
    try {
      host = new URL(safeUrl).hostname;
    } catch (_) {
      host = 'Central';
    }
    advice = explainTlsFailure(
      { code: tlsCode || codes[0] || 'TLS', message: joinedMsg },
      host
    );
  } else if (
    codes.includes('EPROTO') ||
    /wrong version number|SSL routines|EPROTO/i.test(joinedMsg)
  ) {
    kind = 'EPROTO';
    advice =
      '通訊協定不符（常見於 http／https 弄反）。若 Central 只提供 HTTP，請不要用 https://；' +
      '若是 HTTPS，請確認連接埠是 TLS 埠而非明文 HTTP 埠。';
  } else if (
    codes.includes('ERR_INVALID_ARG_VALUE') &&
    /servername/i.test(joinedMsg)
  ) {
    kind = 'ERR_INVALID_ARG_VALUE';
    advice =
      'TLS servername 不可設為 IP。請更新到含此修正的版本；若已是新版仍出現，請回報。';
  } else if (/fetch failed/i.test(String((err && err.message) || ''))) {
    kind = 'FETCH_FAILED';
    advice =
      '連線失敗（fetch failed）。' +
      (codes.length
        ? '底層代碼：' + codes.join(', ') + '。'
        : '未能解析更細的系統錯誤。') +
      '請檢查 Central 是否在線、網址與連接埠、以及防火牆。';
  } else {
    kind = codes[0] || 'UPSTREAM_UNREACHABLE';
    advice =
      '無法連線上游。' +
      (codes.length ? '代碼：' + codes.join(', ') + '。' : '') +
      (joinedMsg ? '細節：' + joinedMsg.slice(0, 240) : '');
  }

  const codeSummary = codes.length ? codes.join(',') : kind;
  const message =
    advice +
    ' 嘗試連線：' +
    safeUrl +
    '（原始代碼：' +
    codeSummary +
    '）';

  return {
    message,
    code: kind,
    codes,
    safeUrl,
    rawMessages: chain.messages
  };
}

function makeUpstreamError(err, attemptedUrl, httpStatus) {
  const diag = diagnoseUpstreamFailure(err, attemptedUrl);
  appendUpstreamLog(
    diag.code +
      ' url=' +
      diag.safeUrl +
      ' codes=' +
      diag.codes.join('|') +
      ' msg=' +
      diag.message.slice(0, 500)
  );
  const out = new Error(diag.message);
  out.code = diag.code;
  out.status = httpStatus || 502;
  out.codes = diag.codes;
  out.safeUrl = diag.safeUrl;
  return out;
}

module.exports = {
  LOG_PATH,
  sanitizeUrlForDisplay,
  collectErrorChain,
  diagnoseUpstreamFailure,
  makeUpstreamError,
  appendUpstreamLog
};
