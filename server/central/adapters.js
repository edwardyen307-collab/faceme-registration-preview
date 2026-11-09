'use strict';

/**
 * Response adapters for FaceMe Security Central.
 *
 * QC shape (quality_result + condition): observed 2026-11-09 from live Central.
 * Other shapes still fail-closed / loosely matched. Import personId still assumed.
 * Swagger: https://192.168.32.220/swagger-ui/doc.html
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

const {
  buildQcFailurePayload,
  buildImportFailurePayload
} = require('./qc-explain');

/**
 * QC must explicitly pass. HTTP 200 alone is NOT pass.
 *
 * Canonical (observed 2026-11-09 live Central):
 *   { quality_result: true|false, condition: { face_size, angle, occlusion, color, single_face, mask } }
 *   quality_result === true → pass
 *   quality_result === false → fail; condition.* true=item OK, false=item failed
 *   quality_result present but not boolean → fail-closed (無法判讀)
 *
 * Legacy fixtures still accepted: pass/success/result PASS.
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

  if (Object.prototype.hasOwnProperty.call(obj, 'quality_result')) {
    if (obj.quality_result === true) {
      return { pass: true, reason: 'quality_result_true' };
    }
    if (obj.quality_result === false) {
      return fail({ reason: 'quality_result_false', code: 'QC_FAIL' });
    }
    return fail({ reason: 'quality_result_unreadable', code: 'QC_SHAPE_UNKNOWN' });
  }

  // Looks like observed Central format but quality_result missing → fail-closed
  if (obj.condition && typeof obj.condition === 'object' && !Array.isArray(obj.condition)) {
    return fail({ reason: 'quality_result_unreadable', code: 'QC_SHAPE_UNKNOWN' });
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
 * Assumed: { personId } | { data: { personId } } | { id }.
 * Failures attach ZH reasons + masked techDetails.
 */
function parseImportPersonId(status, body) {
  function fail(message, code) {
    const payload = buildImportFailurePayload(status, body, { code: code, message: message });
    const err = new Error(message);
    err.code = code;
    err.status = 502;
    err.reasons = payload.reasons;
    err.techDetails = payload.techDetails;
    throw err;
  }
  if (status < 200 || status >= 300) {
    fail('Central 匯入失敗（HTTP ' + status + '）', 'IMPORT_FAILED');
  }
  const obj = asObject(body);
  if (!obj) {
    fail('Central 匯入回應格式未知（fail closed）', 'IMPORT_SHAPE_UNKNOWN');
  }
  const personId =
    (obj.personId != null && String(obj.personId)) ||
    (obj.data && obj.data.personId != null && String(obj.data.personId)) ||
    (obj.id != null && String(obj.id)) ||
    null;
  if (!personId) {
    fail('Central 匯入回應缺少 personId（fail closed）', 'IMPORT_PERSON_ID_MISSING');
  }
  return personId;
}

module.exports = {
  parseSignInToken,
  parseQcResult,
  parseImportPersonId,
  asObject,
  buildQcFailurePayload,
  buildImportFailurePayload
};
