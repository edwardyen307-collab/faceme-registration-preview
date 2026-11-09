'use strict';

const net = require('net');

/**
 * Strip brackets from IPv6 host forms like [::1].
 */
function normalizeHost(host) {
  const h = String(host || '').trim();
  if (h.startsWith('[') && h.endsWith(']')) return h.slice(1, -1);
  return h;
}

/**
 * True when host is IPv4 or IPv6 (Node net.isIP).
 */
function hostIsIp(host) {
  return net.isIP(normalizeHost(host)) !== 0;
}

/**
 * Build tls.connect / connector options.
 * Node forbids options.servername being an IP (ERR_INVALID_ARG_VALUE).
 * Only set servername for DNS hostnames.
 *
 * @param {{ host: string, port: number|string, rejectUnauthorized?: boolean }} opts
 */
function buildTlsSocketOptions(opts) {
  const host = normalizeHost(opts.host);
  const out = {
    host,
    port: Number(opts.port),
    rejectUnauthorized: opts.rejectUnauthorized !== false
  };
  if (!hostIsIp(host)) {
    out.servername = host;
  }
  // When host is IP: omit servername entirely (SNI not used for IP literals).
  return out;
}

/**
 * Sanitize undici/TLS connect options in-place copy: drop servername if it is an IP.
 */
function sanitizeConnectOptions(options) {
  const opts = Object.assign({}, options || {});
  const candidates = [opts.servername, opts.hostname, opts.host]
    .filter(Boolean)
    .map(normalizeHost);
  const ipLike = candidates.find((h) => net.isIP(h) !== 0);
  if (ipLike) {
    delete opts.servername;
  } else if (opts.servername && net.isIP(normalizeHost(opts.servername)) !== 0) {
    delete opts.servername;
  }
  return opts;
}

/**
 * Plain-language TLS / certificate failure hint (no auto skip).
 */
function explainTlsFailure(err, host) {
  const msg = (err && err.message) || String(err || '');
  const code = (err && err.code) || '';
  if (code === 'ERR_INVALID_ARG_VALUE' && /servername/i.test(msg)) {
    return (
      '內部錯誤：不應把 IP 當作 TLS servername（已應修正）。請更新到最新版後重試。'
    );
  }
  if (
    code === 'UNABLE_TO_VERIFY_LEAF_SIGNATURE' ||
    code === 'CERT_HAS_EXPIRED' ||
    code === 'DEPTH_ZERO_SELF_SIGNED_CERT' ||
    code === 'SELF_SIGNED_CERT_IN_CHAIN' ||
    code === 'ERR_TLS_CERT_ALTNAME_INVALID' ||
    /self[- ]signed|unable to verify|altname|certificate/i.test(msg)
  ) {
    return (
      '這是「憑證不被信任／名稱不符」的問題（不是帳密錯）。' +
      'Central 的 HTTPS 憑證可能是自簽，或憑證 SAN 不含「' +
      host +
      '」。' +
      '建議：① 改用憑證上的主機名作為 FACEME_BASE_URL；② 把發證 CA 匯入系統信任；' +
      '③ 僅在明白中間人風險時，才在 .env 設 FACEME_SKIP_TLS_VERIFY=1（預設不要開）。' +
      '本程式不會自動略過驗證。 技術訊息：' +
      (code || msg)
    );
  }
  return 'TLS 連線失敗：' + (code ? code + ' — ' : '') + msg;
}

module.exports = {
  normalizeHost,
  hostIsIp,
  buildTlsSocketOptions,
  sanitizeConnectOptions,
  explainTlsFailure
};
