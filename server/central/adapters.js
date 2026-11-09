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
  buildImportFailurePayload,
  maskQcPayload,
  appendQcLog
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
 * Same-host check for Central detail links (Exists similar person).
 * Only allow http(s) URLs whose host matches FACEME_BASE_URL host.
 */
function sameHostDetailUrl(candidate, baseUrl) {
  if (!candidate || !baseUrl) return null;
  try {
    const u = new URL(String(candidate));
    const b = new URL(String(baseUrl));
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return null;
    if (u.username || u.password) return null;
    if (u.hostname.toLowerCase() !== b.hostname.toLowerCase()) return null;
    return u.toString();
  } catch (_) {
    return null;
  }
}

function extractSimilarPerson(obj) {
  if (!obj || typeof obj !== 'object') return { id: null, detail: null, message: null };
  const nested = obj.data && typeof obj.data === 'object' ? obj.data : obj;
  const message =
    (typeof obj.message === 'string' && obj.message) ||
    (typeof obj.msg === 'string' && obj.msg) ||
    (typeof obj.error === 'string' && obj.error) ||
    (typeof nested.message === 'string' && nested.message) ||
    null;
  const id =
    nested.personId != null
      ? nested.personId
      : nested.similarPersonId != null
        ? nested.similarPersonId
        : nested.id != null
          ? nested.id
          : obj.personId != null
            ? obj.personId
            : null;
  const detail =
    (typeof nested.detail === 'string' && nested.detail) ||
    (typeof nested.url === 'string' && nested.url) ||
    (typeof nested.link === 'string' && nested.link) ||
    (typeof obj.detail === 'string' && obj.detail) ||
    (typeof obj.url === 'string' && obj.url) ||
    null;
  return { id: id != null ? String(id) : null, detail, message };
}

function isExistsSimilarPerson(status, obj) {
  if (status !== 406 && status !== 409) {
    // still detect by message on other 4xx
    if (status < 400 || status >= 500) return false;
  }
  const { message } = extractSimilarPerson(obj);
  if (message && /exists\s*similar\s*person/i.test(message)) return true;
  if (message && /相似/.test(message)) return true;
  if (status === 406) return true; // observed Central uses 406 for this case
  return false;
}

/**
 * Import success → { personId, techDetails }.
 * Failures attach ZH reasons + masked techDetails.
 * Always logs masked Central body to runtime logs.
 */
function parseImportPersonId(status, body, options) {
  const baseUrl = (options && options.baseUrl) || '';
  const obj = asObject(body);
  const masked = maskQcPayload(obj != null ? obj : body);
  try {
    appendQcLog(masked, {
      pass: status >= 200 && status < 300,
      code: 'IMPORT_RESPONSE',
      reasonCount: 0,
      httpStatus: status
    });
  } catch (_) {}

  function fail(message, code, extra) {
    let payload;
    if (extra && extra.reasons) {
      payload = { reasons: extra.reasons, techDetails: masked };
    } else {
      payload = buildImportFailurePayload(status, body, { code: code, message: message });
      payload.techDetails = masked;
    }
    const err = new Error(message);
    err.code = code;
    err.status = extra && extra.status != null ? extra.status : 502;
    err.reasons = payload.reasons;
    err.techDetails = payload.techDetails;
    if (extra && extra.similarPersonId) err.similarPersonId = extra.similarPersonId;
    if (extra && extra.detailUrl) err.detailUrl = extra.detailUrl;
    throw err;
  }

  if (status < 200 || status >= 300) {
    if (isExistsSimilarPerson(status, obj || {})) {
      const sim = extractSimilarPerson(obj || {});
      const safeUrl = sameHostDetailUrl(sim.detail, baseUrl);
      const idPart = sim.id ? '（相似人員 #' + sim.id + '）' : '';
      const msg = '此人已註冊過' + idPart;
      const reasons = [
        {
          id: 'exists_similar_person',
          text: msg,
          hint: safeUrl
            ? '可開啟 Central 人員頁確認：' + safeUrl
            : sim.id
              ? '請到 Central 人員列表搜尋 #' + sim.id + ' 確認（詳情網址主機不符，已隱藏連結）'
              : '請到 Central 人員列表確認是否已有相似人臉'
        }
      ];
      fail(msg, 'IMPORT_EXISTS_SIMILAR', {
        status: 409,
        reasons,
        similarPersonId: sim.id,
        detailUrl: safeUrl
      });
    }
    fail('Central 匯入失敗（HTTP ' + status + '）', 'IMPORT_FAILED');
  }
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
  return { personId: String(personId), techDetails: masked };
}

function buildUserDetailUrl(baseUrl, personId) {
  try {
    const b = new URL(String(baseUrl));
    b.pathname = '/user-detail';
    b.search = '?id=' + encodeURIComponent(String(personId));
    b.hash = '';
    return b.toString();
  } catch (_) {
    return null;
  }
}

module.exports = {
  parseSignInToken,
  parseQcResult,
  parseImportPersonId,
  sameHostDetailUrl,
  extractSimilarPerson,
  isExistsSimilarPerson,
  buildUserDetailUrl,
  asObject,
  buildQcFailurePayload,
  buildImportFailurePayload
};
