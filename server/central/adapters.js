'use strict';

/**
 * Response adapters for FaceMe Security Central.
 *
 * IMPORTANT: Shapes below are ASSUMED from the operator-provided API brief
 * (not live-verified in this environment). Fail closed on unknown shapes.
 * Adjust fixtures + adapters after intranet verification against:
 *   https://192.168.32.220/swagger-ui/doc.html
 */

function asObject(body) {
  if (body && typeof body === 'object' && !Buffer.isBuffer(body)) return body;
  if (typeof body === 'string') {
    try {
      return JSON.parse(body);
    } catch (_) {
      return null;
    }
  }
  return null;
}

/**
 * Parse signIn response → token string.
 * Assumed candidates (first match wins): { token }, { data: { token } }, { accessToken }.
 * Plain non-JSON short string rejected (too ambiguous). HTTP 200 alone is NOT success.
 */
function parseSignInToken(status, body, contentType) {
  if (status < 200 || status >= 300) {
    const err = new Error('Central 登入失敗');
    err.code = 'LOGIN_FAILED';
    err.status = 502;
    throw err;
  }
  const obj = asObject(body);
  if (!obj) {
    const err = new Error('Central 登入回應格式未知（fail closed）');
    err.code = 'LOGIN_SHAPE_UNKNOWN';
    err.status = 502;
    throw err;
  }
  const token =
    (typeof obj.token === 'string' && obj.token) ||
    (obj.data && typeof obj.data.token === 'string' && obj.data.token) ||
    (typeof obj.accessToken === 'string' && obj.accessToken) ||
    null;
  if (!token || token.length < 8) {
    const err = new Error('Central 登入回應缺少可用 token（fail closed）');
    err.code = 'LOGIN_TOKEN_MISSING';
    err.status = 502;
    throw err;
  }
  return token;
}

const { buildQcFailurePayload } = require('./qc-explain');

/**
 * QC must explicitly pass. HTTP 200 alone is NOT pass.
 * Assumed pass signals (any one):
 *   { pass: true } | { success: true } | { data: { pass: true } } | { result: "PASS"|"pass"|"ok" }
 * Assumed fail: pass===false, success===false, result FAIL/fail, or unknown.
 * Failures include Traditional-Chinese reasons + masked techDetails (see qc-explain.js).
 * Field names are loosely matched — NOT live-verified against Central swagger.
 */
function parseQcResult(status, body) {
  function fail(meta) {
    return buildQcFailurePayload(status, body, meta);
  }
  if (status < 200 || status >= 300) {
    return fail({ reason: 'http_error', code: 'QC_HTTP_ERROR' });
  }
  const obj = asObject(body);
  if (!obj) {
    return fail({ reason: 'unknown_shape', code: 'QC_SHAPE_UNKNOWN' });
  }
  if (obj.pass === true) return { pass: true, reason: 'pass_true' };
  if (obj.success === true && obj.pass !== false) {
    if (obj.result && /fail/i.test(String(obj.result))) {
      return fail({ reason: 'result_fail', code: 'QC_FAIL' });
    }
    return { pass: true, reason: 'success_true' };
  }
  if (obj.data && obj.data.pass === true) return { pass: true, reason: 'data_pass_true' };
  if (typeof obj.result === 'string' && /^(PASS|pass|ok|OK)$/.test(obj.result)) {
    return { pass: true, reason: 'result_pass' };
  }
  if (obj.pass === false || obj.success === false) {
    return fail({ reason: 'explicit_fail', code: 'QC_FAIL' });
  }
  if (typeof obj.result === 'string' && /fail/i.test(obj.result)) {
    return fail({ reason: 'result_fail', code: 'QC_FAIL' });
  }
  return fail({ reason: 'unknown_shape', code: 'QC_SHAPE_UNKNOWN' });
}

/**
 * Import success → personId.
 * Assumed: { personId } | { data: { personId } } | { id } when clearly person import context.
 * HTTP 200 alone is NOT enough without an id field.
 */
function parseImportPersonId(status, body) {
  if (status < 200 || status >= 300) {
    const err = new Error('Central 匯入失敗');
    err.code = 'IMPORT_FAILED';
    err.status = 502;
    throw err;
  }
  const obj = asObject(body);
  if (!obj) {
    const err = new Error('Central 匯入回應格式未知（fail closed）');
    err.code = 'IMPORT_SHAPE_UNKNOWN';
    err.status = 502;
    throw err;
  }
  const personId =
    (obj.personId != null && String(obj.personId)) ||
    (obj.data && obj.data.personId != null && String(obj.data.personId)) ||
    (obj.id != null && String(obj.id)) ||
    null;
  if (!personId) {
    const err = new Error('Central 匯入回應缺少 personId（fail closed）');
    err.code = 'IMPORT_PERSON_ID_MISSING';
    err.status = 502;
    throw err;
  }
  return personId;
}

module.exports = {
  parseSignInToken,
  parseQcResult,
  parseImportPersonId,
  asObject,
  buildQcFailurePayload
};
