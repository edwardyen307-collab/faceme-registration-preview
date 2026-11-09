'use strict';

/**
 * Extract human-readable QC failure reasons from Central responses.
 *
 * Canonical condition format observed 2026-11-09 from live Central:
 *   quality_result + condition.{face_size,angle,occlusion,color,single_face,mask}
 *   In condition, true = that check PASSED, false = FAILED.
 * Numeric / alias heuristics run ONLY when no condition object is present.
 */

const fs = require('fs');
const path = require('path');

const QC_LOG_PATH = path.join(__dirname, '..', '..', 'runtime', 'qc.log');
const UPSTREAM_LOG_PATH = path.join(__dirname, '..', '..', 'runtime', 'upstream.log');

const SECRET_KEY_RE =
  /token|password|passwd|secret|cookie|authorization|auth|bearer|session|credential|api[_-]?key|private|feature|embedding|template|descriptor|vector|biometric|snapshot|image|photo|picture|base64|binary|raw|blob|file|content/i;

const MAX_DEPTH = 8;
const MAX_STRING = 160;
const MAX_ARRAY = 20;
const MAX_KEYS = 80;

function isPlainObject(v) {
  return v !== null && typeof v === 'object' && !Array.isArray(v) && !Buffer.isBuffer(v);
}

function normKey(k) {
  return String(k || '')
    .replace(/([a-z])([A-Z])/g, '$1_$2')
    .replace(/[^a-zA-Z0-9]+/g, '_')
    .toLowerCase()
    .replace(/^_+|_+$/g, '');
}

function keyMatches(norm, aliases) {
  for (const a of aliases) {
    if (norm === a || norm.endsWith('_' + a) || norm.startsWith(a + '_') || norm.includes('_' + a + '_')) {
      return true;
    }
  }
  return false;
}

function toNumber(v) {
  if (typeof v === 'number' && Number.isFinite(v)) return v;
  if (typeof v === 'boolean') return v ? 1 : 0;
  if (typeof v === 'string' && v.trim() !== '' && /^-?\d+(\.\d+)?$/.test(v.trim())) {
    const n = Number(v.trim());
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

function looksTruthyFail(v) {
  if (v === true || v === 1) return true;
  if (typeof v === 'string' && /^(true|yes|y|1|fail|failed|bad|low|poor|reject|rejected)$/i.test(v.trim())) {
    return true;
  }
  return false;
}

/** Convert pose value to degrees (guess radians when |v|<=π+ε). */
function toDegrees(v) {
  const n = toNumber(v);
  if (n == null) return null;
  if (Math.abs(n) <= 3.2) return (n * 180) / Math.PI;
  return n;
}

function directionYaw(deg) {
  if (deg > 0) return '右';
  if (deg < 0) return '左';
  return '';
}
function directionPitch(deg) {
  if (deg > 0) return '上';
  if (deg < 0) return '下';
  return '';
}

function collectPaths(obj, out, prefix, depth, keyBudget) {
  if (keyBudget.count >= MAX_KEYS) return;
  if (depth > MAX_DEPTH) return;
  if (Array.isArray(obj)) {
    const lim = Math.min(obj.length, MAX_ARRAY);
    for (let i = 0; i < lim; i++) {
      collectPaths(obj[i], out, prefix + '[' + i + ']', depth + 1, keyBudget);
    }
    return;
  }
  if (!isPlainObject(obj)) return;
  for (const [k, v] of Object.entries(obj)) {
    if (keyBudget.count >= MAX_KEYS) return;
    const nk = normKey(k);
    const p = prefix ? prefix + '.' + k : k;
    keyBudget.count++;
    out.push({ path: p, key: k, norm: nk, value: v });
    if (isPlainObject(v) || Array.isArray(v)) {
      collectPaths(v, out, p, depth + 1, keyBudget);
    }
  }
}

function findFirst(nodes, aliases, predicate) {
  for (const n of nodes) {
    if (!keyMatches(n.norm, aliases)) continue;
    if (predicate && !predicate(n.value, n)) continue;
    return n;
  }
  return null;
}

function findAll(nodes, aliases) {
  return nodes.filter((n) => keyMatches(n.norm, aliases));
}

/**
 * Mask Central QC body for UI / logs.
 * Keeps numbers, booleans, short non-secret strings, nested structure.
 * Strips tokens, cookies, passwords, images/base64, feature vectors.
 */
function maskQcPayload(body) {
  const seen = new WeakSet();
  let keyCount = 0;

  function mask(v, depth, parentKey) {
    if (depth > MAX_DEPTH) return '[…]';
    if (v == null) return v;
    if (typeof v === 'number' || typeof v === 'boolean') return v;
    if (typeof v === 'string') {
      const pk = normKey(parentKey || '');
      if (SECRET_KEY_RE.test(pk)) return '[redacted]';
      if (v.length > MAX_STRING) {
        if (/^[A-Za-z0-9+/=\s]+$/.test(v) && v.length > 64) return '[redacted-long]';
        return v.slice(0, 48) + '…[' + v.length + ' chars]';
      }
      if (/^(eyJ|[A-Za-z0-9+/]{40,}={0,2})$/.test(v.trim())) return '[redacted]';
      return v;
    }
    if (Buffer.isBuffer(v)) return '[binary ' + v.length + ' bytes]';
    if (Array.isArray(v)) {
      if (v.length && typeof v[0] === 'number' && v.length > 16) {
        return '[vector len=' + v.length + ']';
      }
      return v.slice(0, MAX_ARRAY).map((x, i) => mask(x, depth + 1, parentKey + '[' + i + ']'));
    }
    if (isPlainObject(v)) {
      if (seen.has(v)) return '[cycle]';
      seen.add(v);
      const out = {};
      for (const [k, val] of Object.entries(v)) {
        keyCount++;
        if (keyCount > MAX_KEYS) {
          out['…'] = 'truncated';
          break;
        }
        if (SECRET_KEY_RE.test(normKey(k))) {
          out[k] = '[redacted]';
          continue;
        }
        out[k] = mask(val, depth + 1, k);
      }
      return out;
    }
    return String(v).slice(0, 40);
  }

  let root = body;
  if (typeof body === 'string') {
    try {
      root = JSON.parse(body);
    } catch (_) {
      return { _raw: mask(String(body), 0, 'raw') };
    }
  }
  return mask(root, 0, '');
}

function appendQcLog(masked, meta) {
  const line =
    new Date().toISOString() +
    ' QC ' +
    JSON.stringify({
      pass: meta && meta.pass,
      code: meta && meta.code,
      reasonCount: meta && meta.reasonCount,
      httpStatus: meta && meta.httpStatus,
      masked: masked
    });
  for (const p of [QC_LOG_PATH, UPSTREAM_LOG_PATH]) {
    try {
      fs.mkdirSync(path.dirname(p), { recursive: true });
      fs.appendFileSync(p, line.replace(/\r?\n/g, ' ') + '\n', 'utf8');
    } catch (_) {}
  }
}

function pushReason(list, id, text, hint) {
  if (list.some((r) => r.id === id)) return;
  list.push({ id: id, text: text, hint: hint || '' });
}

/**
 * Map observed Central condition flags (true=pass, false=fail) → ZH reasons.
 */
function explainConditionFlags(condition) {
  const reasons = [];
  if (!condition || typeof condition !== 'object') return reasons;
  const map = {
    face_size: {
      id: 'face_size',
      text: '臉部大小不合格（太小或太大）',
      hint: '請調整與鏡頭的距離，讓整張臉清楚入鏡、不要過近或過遠'
    },
    angle: {
      id: 'angle',
      text: '臉部角度不正',
      hint: '請正面直視鏡頭，不要左右轉頭或過度抬頭／低頭'
    },
    occlusion: {
      id: 'occlusion',
      text: '臉部有遮擋',
      hint: '請拿開遮住臉的物品（手、帽子、瀏海等），讓整張臉清楚'
    },
    color: {
      id: 'color',
      text: '顏色或光線異常',
      hint: '請到光線均勻處拍攝，避免過暗、過曝或嚴重偏色'
    },
    single_face: {
      id: 'single_face',
      text: '偵測到不只一張臉（或未正確偵測單人）',
      hint: '請只拍一人，避免背景出現其他人臉'
    },
    mask: {
      id: 'mask',
      text: '偵測到口罩',
      hint: '註冊請暫時拿開口罩，露出完整臉部'
    }
  };
  for (const [key, meta] of Object.entries(map)) {
    if (!Object.prototype.hasOwnProperty.call(condition, key)) continue;
    const v = condition[key];
    // true = pass → skip; false = fail → report; non-boolean → treat as unreadable item
    if (v === true) continue;
    if (v === false) {
      pushReason(reasons, meta.id, meta.text, meta.hint);
      continue;
    }
    pushReason(
      reasons,
      meta.id + '_unreadable',
      '無法判讀條件「' + key + '」（值不是 true/false）',
      '請重拍一張；若持續發生請保留技術細節給管理員'
    );
  }
  return reasons;
}

/**
 * Build Traditional Chinese reasons + hints from a QC JSON object.
 * Prefer observed condition flags; numeric heuristics only without condition.
 */
function explainQcFailure(obj, parseMeta) {
  const reasons = [];
  if (!obj || typeof obj !== 'object') {
    return {
      reasons: [
        {
          id: 'unparsed',
          text: '無法判讀 Central 的品質檢查回應',
          hint: '請換一張清楚的正面照片後再試；若持續失敗請保留技術細節給管理員'
        }
      ]
    };
  }

  if (parseMeta && parseMeta.reason === 'quality_result_unreadable') {
    pushReason(
      reasons,
      'quality_result_unreadable',
      '無法判讀品質結果（quality_result 不是布林值）',
      '請重試；若持續發生請把技術細節交給管理員對照 Central 版本'
    );
    return { reasons };
  }

  // Observed Central format: condition booleans (true=OK, false=fail)
  if (obj.condition && typeof obj.condition === 'object' && !Array.isArray(obj.condition)) {
    const fromCond = explainConditionFlags(obj.condition);
    for (const r of fromCond) reasons.push(r);
    if (reasons.length === 0 && obj.quality_result === false) {
      pushReason(
        reasons,
        'quality_result_false',
        '品質檢查未通過（未標示具體不合格項目）',
        '請改拍一張：單人、正面、光線均勻、臉清楚無遮擋'
      );
    }
    if (reasons.length === 0) {
      pushReason(
        reasons,
        'generic',
        '人臉品質未達標準',
        '請改拍一張清楚正面照'
      );
    }
    return { reasons };
  }

  // ---- Fallback heuristics ONLY when no condition object ----
  const nodes = [];
  collectPaths(obj, nodes, '', 0, { count: 0 });

  const faceCountNode =
    findFirst(nodes, ['face_count', 'facecount', 'num_faces', 'face_num', 'faces_count'], (v) => toNumber(v) != null) ||
    findFirst(nodes, ['faces'], (v) => Array.isArray(v));
  if (faceCountNode) {
    let count = toNumber(faceCountNode.value);
    if (count == null && Array.isArray(faceCountNode.value)) count = faceCountNode.value.length;
    if (count === 0) {
      pushReason(reasons, 'no_face', '偵測不到人臉', '請確認臉在畫面中央、光線足夠，並正面面對鏡頭');
    } else if (count != null && count > 1) {
      pushReason(reasons, 'multi_face', '偵測到 ' + count + ' 張臉', '請只拍一人，避免背景出現其他人臉');
    }
  }

  const scoreNode = findFirst(
    nodes,
    ['quality_score', 'face_quality', 'quality', 'score', 'qc_score'],
    (v) => typeof v === 'number' || (typeof v === 'string' && toNumber(v) != null)
  );
  const thrNode = findFirst(
    nodes,
    ['quality_threshold', 'min_quality', 'threshold', 'score_threshold', 'quality_min'],
    (v) => toNumber(v) != null
  );
  if (scoreNode) {
    const score = toNumber(scoreNode.value);
    const thr = thrNode ? toNumber(thrNode.value) : null;
    if (thr != null && score != null && score < thr) {
      pushReason(reasons, 'quality_low', '品質分數 ' + trimNum(score) + ' 低於門檻 ' + trimNum(thr), '請靠近一點、保持清晰對焦，並避免過暗或過曝');
    } else if (score != null && score < 0.45 && (thr == null || thr <= 1)) {
      pushReason(reasons, 'quality_low', '品質分數偏低（' + trimNum(score) + '）', '請改拍一張更清楚、光線均勻的正面照');
    }
  }

  const blurNode = findFirst(nodes, ['blur', 'blur_score', 'is_blur', 'blurry', 'fuzzy'], (v) => typeof v === 'number' || typeof v === 'string');
  const sharpNode = findFirst(nodes, ['sharpness', 'clarity', 'sharp_score'], (v) => toNumber(v) != null);
  if (blurNode) {
    const bn = toNumber(blurNode.value);
    if ((bn != null && bn > 0.5 && bn <= 1) || (bn != null && bn > 50) || (typeof blurNode.value === 'string' && /blur|fuzzy|bad/i.test(blurNode.value))) {
      pushReason(reasons, 'blur', '畫面模糊', '請固定手機／相機後再拍，避免晃動');
    }
  }
  if (sharpNode) {
    const s = toNumber(sharpNode.value);
    if (s != null && ((s < 0.4 && s >= 0) || (s < 40 && s > 1))) {
      pushReason(reasons, 'sharpness', '清晰度不足', '請對準臉部、避免晃動，必要時擦拭鏡頭');
    }
  }

  const yawNode = findFirst(nodes, ['yaw', 'pose_yaw', 'head_yaw', 'face_yaw'], (v) => toNumber(v) != null);
  const pitchNode = findFirst(nodes, ['pitch', 'pose_pitch', 'head_pitch', 'face_pitch'], (v) => toNumber(v) != null);
  const rollNode = findFirst(nodes, ['roll', 'pose_roll', 'head_roll', 'face_roll'], (v) => toNumber(v) != null);
  const yawDeg = yawNode ? toDegrees(yawNode.value) : null;
  const pitchDeg = pitchNode ? toDegrees(pitchNode.value) : null;
  const rollDeg = rollNode ? toDegrees(rollNode.value) : null;
  const POSE_LIMIT = 12;
  if (yawDeg != null && Math.abs(yawDeg) >= POSE_LIMIT) {
    pushReason(reasons, 'pose_yaw', '臉偏' + directionYaw(yawDeg) + '約 ' + Math.round(Math.abs(yawDeg)) + '°', '請正面直視鏡頭，不要左右轉頭');
  }
  if (pitchDeg != null && Math.abs(pitchDeg) >= POSE_LIMIT) {
    pushReason(reasons, 'pose_pitch', '臉偏' + directionPitch(pitchDeg) + '約 ' + Math.round(Math.abs(pitchDeg)) + '°', '請平視鏡頭，不要過度抬頭或低頭');
  }
  if (rollDeg != null && Math.abs(rollDeg) >= POSE_LIMIT) {
    pushReason(reasons, 'pose_roll', '頭部傾斜約 ' + Math.round(Math.abs(rollDeg)) + '°', '請把臉擺正，兩眼連線儘量水平');
  }

  const brightNode = findFirst(
    nodes,
    ['brightness', 'exposure', 'lighting', 'luminance', 'lightness', 'illumination'],
    (v) => toNumber(v) != null || typeof v === 'string'
  );
  if (brightNode) {
    const b = toNumber(brightNode.value);
    const s = typeof brightNode.value === 'string' ? brightNode.value.toLowerCase() : '';
    if (/dark|low|under|dim|too_?dark/.test(s) || (b != null && b < 0.35 && b >= 0) || (b != null && b < 40 && b > 1)) {
      pushReason(reasons, 'dark', '光線太暗', '請到光線均勻處拍攝，避免逆光或陰影遮臉');
    } else if (/bright|over|high|too_?bright|over.?expos/.test(s) || (b != null && b > 0.85 && b <= 1.5) || (b != null && b > 220)) {
      pushReason(reasons, 'bright', '光線過亮／過曝', '請避免強光直射或背光，改到光線柔和處');
    }
  }

  // NOTE: do NOT treat boolean occlusion/mask/face_size as "problem=true" —
  // that polarity is wrong for observed Central condition flags.

  const iodNode = findFirst(
    nodes,
    ['iod', 'inter_ocular', 'interocular', 'eye_distance', 'pupil_distance', 'eye_dist'],
    (v) => toNumber(v) != null
  );
  if (iodNode) {
    const iod = toNumber(iodNode.value);
    if (iod != null && iod > 0 && iod < 32) {
      pushReason(reasons, 'iod_small', '臉部解析度不足（雙眼間距約 ' + Math.round(iod) + ' 像素）', '請靠近拍攝或提高相機解析度');
    }
  }

  const msgNode = findFirst(nodes, ['message', 'msg', 'error_message', 'fail_reason', 'reject_reason', 'reason', 'detail', 'description'], (v) => typeof v === 'string' && v.trim());
  if (msgNode && typeof msgNode.value === 'string') {
    const m = msgNode.value.trim().slice(0, 120);
    if (m && !/^(fail|failed|error|false|null)$/i.test(m)) {
      pushReason(reasons, 'central_message', 'Central 訊息：' + m, '請依上述訊息調整後重拍');
    }
  }

  if (reasons.length === 0) {
    pushReason(
      reasons,
      'generic',
      '人臉品質未達標準（未能對應到具體欄位）',
      '請改拍一張：單人、正面、光線均勻、臉清楚無遮擋。可展開技術細節供管理員對照'
    );
  }

  return { reasons };
}

function trimNum(n) {
  if (!Number.isFinite(n)) return String(n);
  const t = Math.round(n * 1000) / 1000;
  return String(t);
}

function buildQcFailurePayload(status, body, parseMeta) {
  const obj =
    body && typeof body === 'object' && !Buffer.isBuffer(body)
      ? body
      : typeof body === 'string'
        ? (() => {
            try {
              return JSON.parse(body);
            } catch (_) {
              return null;
            }
          })()
        : null;
  const explained = explainQcFailure(obj || {}, parseMeta || {});
  const masked = maskQcPayload(obj != null ? obj : body);
  const code = (parseMeta && parseMeta.code) || 'QC_FAIL';
  appendQcLog(masked, {
    pass: false,
    code: code,
    reasonCount: explained.reasons.length,
    httpStatus: status
  });
  return {
    pass: false,
    reason: (parseMeta && parseMeta.reason) || 'qc_fail',
    code: code,
    reasons: explained.reasons,
    techDetails: masked
  };
}

function buildImportFailurePayload(status, body, parseMeta) {
  const obj =
    body && typeof body === 'object' && !Buffer.isBuffer(body)
      ? body
      : typeof body === 'string'
        ? (() => {
            try {
              return JSON.parse(body);
            } catch (_) {
              return null;
            }
          })()
        : null;
  const masked = maskQcPayload(obj != null ? obj : body);
  const msg = (parseMeta && parseMeta.message) || 'Central 匯入失敗';
  const reasons = [];
  if (obj && typeof obj === 'object') {
    const m =
      (typeof obj.message === 'string' && obj.message) ||
      (typeof obj.msg === 'string' && obj.msg) ||
      (typeof obj.error === 'string' && obj.error) ||
      (obj.data && typeof obj.data.message === 'string' && obj.data.message) ||
      null;
    if (m) {
      reasons.push({
        id: 'import_message',
        text: 'Central 匯入訊息：' + String(m).slice(0, 160),
        hint: '請確認此人尚未重複註冊，或稍後再試；細節見技術資訊'
      });
    }
    const code =
      obj.code != null
        ? obj.code
        : obj.errorCode != null
          ? obj.errorCode
          : obj.errCode != null
            ? obj.errCode
            : null;
    if (code != null && reasons.length === 0) {
      reasons.push({
        id: 'import_code',
        text: '匯入失敗（代碼 ' + String(code).slice(0, 40) + '）',
        hint: '請稍後再試或聯絡管理員；勿重複連續送出'
      });
    }
  }
  if (reasons.length === 0) {
    reasons.push({
      id: 'import_failed',
      text: msg,
      hint: '品質檢查已通過但匯入未完成；請查看技術細節或稍後再試，勿假設已寫入 Central'
    });
  }
  try {
    appendQcLog(masked, {
      pass: false,
      code: (parseMeta && parseMeta.code) || 'IMPORT_FAILED',
      reasonCount: reasons.length,
      httpStatus: status
    });
  } catch (_) {}
  return { reasons: reasons, techDetails: masked };
}

module.exports = {
  maskQcPayload,
  explainQcFailure,
  explainConditionFlags,
  buildQcFailurePayload,
  buildImportFailurePayload,
  appendQcLog,
  QC_LOG_PATH,
  SECRET_KEY_RE,
  toDegrees,
  normKey
};
