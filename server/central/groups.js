'use strict';

/**
 * FaceMe Security Central — group list / create adapters.
 *
 * Paths (swagger 2026-11-09):
 *   POST /api/website/group/list
 *   POST /api/website/group/create
 *
 * List body (confirmed): pageIndex, pageSize, orderBy, optional type.
 * Create body (confirmed required): name, color, patternId — no type.
 * Import person field (confirmed): groupId (int64) only.
 *
 * Body encoding (v2026-11-09k): live Central returns HTTP 415 for JSON on
 * group/list + group/create. Default try order: multipart → form → json.
 * Only 415 triggers the next encoding. Override: FACEME_GROUP_BODY_ENCODING.
 */

const { maskQcPayload, appendQcLog } = require('./qc-explain');

const DEFAULT_LIST_PATH = '/api/website/group/list';
const DEFAULT_LIST_METHOD = 'POST';
const DEFAULT_CREATE_PATH = '/api/website/group/create';
const DEFAULT_IMPORT_FIELD = 'groupId';

const RESERVED_GROUP_NAMES = ['VIP', 'EMPLOYEE', 'BLOCKLIST'];

const GROUP_COLORS = [
  '#C54C82',
  '#EC729C',
  '#F4AEBA',
  '#8064A2',
  '#800080',
  '#002060',
  '#1F4E79',
  '#2F5597',
  '#0070C0',
  '#00A4DE',
  '#00B050',
  '#92D050',
  '#548235',
  '#61B292',
  '#AED09E',
  '#C00000',
  '#FF6B3D',
  '#E2D779',
  '#C55A11',
  '#843C0C',
  '#000000',
  '#303030',
  '#5F5C74',
  '#A6A6B4',
  '#BFBFBF'
];

const DEFAULT_COLOR = '#0070C0';
const DEFAULT_PATTERN_ID = 1;
const MAX_LIST_PAGES = 20;

const GROUP_TYPES = ['VIP', 'NORMAL', 'EMPLOYEE', 'BLOCKLIST', 'VISITOR', 'EXCEPTION'];

function groupListPath() {
  return String(process.env.FACEME_GROUP_LIST_PATH || DEFAULT_LIST_PATH).trim() || DEFAULT_LIST_PATH;
}
function groupListMethod() {
  const m = String(process.env.FACEME_GROUP_LIST_METHOD || DEFAULT_LIST_METHOD)
    .trim()
    .toUpperCase();
  return m === 'GET' ? 'GET' : 'POST';
}
function groupCreatePath() {
  return String(process.env.FACEME_GROUP_CREATE_PATH || DEFAULT_CREATE_PATH).trim() || DEFAULT_CREATE_PATH;
}
function importGroupField() {
  // Official field is groupId; env may override only if needed
  return String(process.env.FACEME_IMPORT_GROUP_FIELD || DEFAULT_IMPORT_FIELD).trim() || DEFAULT_IMPORT_FIELD;
}

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

function pickId(row) {
  if (row == null) return null;
  if (typeof row === 'string' || typeof row === 'number') return String(row);
  const id =
    row.id != null
      ? row.id
      : row.groupId != null
        ? row.groupId
        : row.group_id != null
          ? row.group_id
          : row.uuid != null
            ? row.uuid
            : null;
  return id != null ? String(id) : null;
}

function pickName(row) {
  if (row == null || typeof row !== 'object') return null;
  const n =
    (typeof row.name === 'string' && row.name) ||
    (typeof row.groupName === 'string' && row.groupName) ||
    (typeof row.group_name === 'string' && row.group_name) ||
    (typeof row.title === 'string' && row.title) ||
    null;
  return n ? String(n).trim() : null;
}

function pickType(row) {
  if (row == null || typeof row !== 'object') return null;
  const t =
    (typeof row.type === 'string' && row.type) ||
    (typeof row.groupType === 'string' && row.groupType) ||
    (typeof row.group_type === 'string' && row.group_type) ||
    null;
  return t ? String(t).trim() : null;
}

function extractRows(obj) {
  if (!obj) return null;
  if (Array.isArray(obj)) return obj;
  const candidates = [
    obj.data,
    obj.data && obj.data.list,
    obj.data && obj.data.groups,
    obj.data && obj.data.content,
    obj.data && obj.data.records,
    obj.list,
    obj.groups,
    obj.result,
    obj.records,
    obj.content,
    obj.entity,
    obj.entity && obj.entity.content,
    obj.entity && obj.entity.list,
    obj.items
  ];
  for (const c of candidates) {
    if (Array.isArray(c)) return c;
  }
  return null;
}

function extractTotalPages(obj, pageSize, rowCount) {
  if (!obj || typeof obj !== 'object') return null;
  const roots = [obj, obj.data, obj.entity].filter(Boolean);
  for (const r of roots) {
    for (const k of ['totalPages', 'total_pages', 'pageCount', 'pages']) {
      if (r[k] != null && Number.isFinite(Number(r[k]))) return Number(r[k]);
    }
    for (const k of ['total', 'totalCount', 'totalElements', 'count']) {
      if (r[k] != null && Number.isFinite(Number(r[k])) && pageSize > 0) {
        return Math.ceil(Number(r[k]) / pageSize);
      }
    }
  }
  // If fewer rows than pageSize, assume last page
  if (rowCount < pageSize) return null; // signal: stop after this page via caller
  return null;
}

function listRequestBody(pageIndex) {
  return {
    pageIndex: pageIndex,
    pageSize: 100,
    orderBy: 'name:asc'
  };
}

/**
 * Parse one list page → {groups, techDetails, maybeMore}
 */
function parseGroupListPage(status, body, pageSize) {
  const masked = maskQcPayload(asObject(body) != null ? asObject(body) : body);
  if (status < 200 || status >= 300) {
    try {
      appendQcLog(masked, { pass: false, code: 'GROUP_LIST_HTTP', reasonCount: 0, httpStatus: status });
    } catch (_) {}
    const err = new Error('無法取得 Central 群組列表（HTTP ' + status + '）');
    err.code = 'GROUP_LIST_HTTP';
    err.status = 502;
    err.techDetails = masked;
    throw err;
  }
  const obj = asObject(body);
  const rows = extractRows(obj);
  if (!rows) {
    try {
      appendQcLog(masked, { pass: false, code: 'GROUP_LIST_SHAPE', reasonCount: 0, httpStatus: status });
    } catch (_) {}
    const err = new Error(
      'Central 群組列表格式無法判讀（fail closed）。請用「測試讀取群組」把遮罩後回應貼給管理員。'
    );
    err.code = 'GROUP_LIST_SHAPE';
    err.status = 502;
    err.techDetails = masked;
    throw err;
  }
  const groups = [];
  for (const row of rows) {
    const id = pickId(row);
    const name = pickName(row) || (id ? String(id) : null);
    if (!id && !name) continue;
    groups.push({
      id: id || name,
      name: name || String(id),
      type: pickType(row)
    });
  }
  const totalPages = extractTotalPages(obj, pageSize, rows.length);
  const maybeMore = totalPages != null ? null : rows.length >= pageSize;
  return { groups, techDetails: masked, totalPages, maybeMore, rowCount: rows.length };
}

/** Legacy single-shot parse used by tests */
function parseGroupList(status, body) {
  const page = parseGroupListPage(status, body, 100);
  return { groups: page.groups, techDetails: page.techDetails, rawStatus: status };
}

function validateGroupCreateFields(name, color, patternId) {
  const n = String(name == null ? '' : name).trim();
  if (!n) {
    const err = new Error('群組名稱為必填');
    err.code = 'GROUP_REQUIRED';
    err.status = 400;
    throw err;
  }
  if (n.length > 64) {
    const err = new Error('群組名稱過長（上限 64 字）');
    err.code = 'GROUP_TOO_LONG';
    err.status = 400;
    throw err;
  }
  const upper = n.toUpperCase();
  if (RESERVED_GROUP_NAMES.indexOf(upper) !== -1) {
    const err = new Error(
      '「' + n + '」是系統保留群組名稱，不能用來建立新群組。請換一個名稱。'
    );
    err.code = 'GROUP_NAME_RESERVED';
    err.status = 400;
    throw err;
  }
  const c = String(color == null ? DEFAULT_COLOR : color).trim().toUpperCase();
  const allowed = GROUP_COLORS.map((x) => x.toUpperCase());
  if (allowed.indexOf(c) === -1) {
    const err = new Error('群組顏色不在允許清單內，請從色塊中選擇');
    err.code = 'GROUP_COLOR_INVALID';
    err.status = 400;
    throw err;
  }
  // normalize to canonical casing from list
  const canonicalColor = GROUP_COLORS[allowed.indexOf(c)];
  const p = Number.parseInt(patternId, 10);
  if (!Number.isFinite(p) || p < 1 || p > 20) {
    const err = new Error('圖示編號必須是 1 到 20 的整數');
    err.code = 'GROUP_PATTERN_INVALID';
    err.status = 400;
    throw err;
  }
  return { name: n, color: canonicalColor, patternId: p };
}

function parseCreatedGroup(status, body, fallbackName) {
  const masked = maskQcPayload(asObject(body) != null ? asObject(body) : body);
  if (status < 200 || status >= 300) {
    try {
      appendQcLog(masked, { pass: false, code: 'GROUP_CREATE_FAILED', reasonCount: 0, httpStatus: status });
    } catch (_) {}
    const obj = asObject(body);
    const msg =
      (obj && (obj.message || obj.msg || obj.error)) ||
      '建立群組失敗（HTTP ' + status + '）';
    const err = new Error(String(msg));
    err.code = 'GROUP_CREATE_FAILED';
    err.status = 502;
    err.techDetails = masked;
    throw err;
  }
  const obj = asObject(body) || {};
  const nested = obj.data || obj.entity || obj.group || obj.result || obj;
  const id = pickId(nested) || pickId(obj);
  const name = pickName(nested) || pickName(obj) || fallbackName;
  return {
    id: id != null ? String(id) : null,
    name: name || fallbackName || null,
    techDetails: masked
  };
}

function findGroupByName(groups, name) {
  const n = String(name || '')
    .trim()
    .toLowerCase();
  if (!n) return null;
  for (const g of groups || []) {
    if (String(g.name || '').trim().toLowerCase() === n) return g;
    if (String(g.id || '').trim().toLowerCase() === n) return g;
  }
  return null;
}

function displayGroupLabel(g) {
  const name = (g && g.name) || '';
  const type = g && g.type ? String(g.type) : '';
  return type ? name + '（' + type + '）' : name;
}

/** Preferred encodings for group list/create (live Central: JSON → 415). */
const GROUP_BODY_ENCODINGS = ['multipart', 'form', 'json'];

/** Process-lifetime remembered encoding that first succeeded (shared list+create). */
let rememberedGroupBodyEncoding = null;

function normalizeGroupBodyEncoding(raw) {
  const s = String(raw == null ? '' : raw)
    .trim()
    .toLowerCase();
  if (s === 'multipart' || s === 'multipart/form-data') return 'multipart';
  if (s === 'form' || s === 'urlencoded' || s === 'application/x-www-form-urlencoded') return 'form';
  if (s === 'json' || s === 'application/json') return 'json';
  return null;
}

function envGroupBodyEncoding() {
  return normalizeGroupBodyEncoding(process.env.FACEME_GROUP_BODY_ENCODING);
}

function getRememberedGroupBodyEncoding() {
  return rememberedGroupBodyEncoding;
}

function resetGroupBodyEncodingMemory() {
  rememberedGroupBodyEncoding = null;
}

function rememberGroupBodyEncoding(encoding, meta) {
  const enc = normalizeGroupBodyEncoding(encoding);
  if (!enc) return;
  const changed = rememberedGroupBodyEncoding !== enc;
  rememberedGroupBodyEncoding = enc;
  if (changed) {
    const where = (meta && meta.path) || 'group';
    const line =
      'group body encoding locked=' +
      enc +
      ' path=' +
      where +
      (meta && meta.status != null ? ' status=' + meta.status : '');
    try {
      // Lazy require to avoid cycles; log to upstream.log + console
      require('../upstream-errors').appendUpstreamLog(line);
    } catch (_) {
      try {
        console.warn('[upstream] ' + line);
      } catch (_) {}
    }
  }
}

/**
 * Encoding try order for this process.
 * Env override → only that encoding.
 * Else remembered first, then remaining defaults (multipart → form → json).
 */
function groupBodyEncodingOrder() {
  const forced = envGroupBodyEncoding();
  if (forced) return [forced];
  const order = GROUP_BODY_ENCODINGS.slice();
  const remembered = rememberedGroupBodyEncoding;
  if (remembered && order.indexOf(remembered) !== -1) {
    return [remembered].concat(order.filter((e) => e !== remembered));
  }
  return order;
}

function fieldsToStringMap(fields) {
  const out = {};
  const src = fields && typeof fields === 'object' ? fields : {};
  for (const k of Object.keys(src)) {
    const v = src[k];
    if (v == null) continue;
    out[k] = typeof v === 'string' ? v : String(v);
  }
  return out;
}

/**
 * Build fetch body + headers for a group API call.
 * multipart: undici FormData (do NOT set Content-Type — boundary is automatic)
 * form: application/x-www-form-urlencoded (same family as signIn)
 * json: application/json
 */
function buildGroupBody(fields, encoding) {
  const enc = normalizeGroupBodyEncoding(encoding) || 'multipart';
  const map = fieldsToStringMap(fields);
  if (enc === 'multipart') {
    const { FormData } = require('undici');
    const fd = new FormData();
    for (const k of Object.keys(map)) fd.append(k, map[k]);
    return {
      encoding: 'multipart',
      contentType: 'multipart/form-data',
      headers: {}, // let undici set multipart boundary
      body: fd
    };
  }
  if (enc === 'form') {
    const params = new URLSearchParams();
    for (const k of Object.keys(map)) params.set(k, map[k]);
    return {
      encoding: 'form',
      contentType: 'application/x-www-form-urlencoded',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: params.toString()
    };
  }
  return {
    encoding: 'json',
    contentType: 'application/json',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(fields && typeof fields === 'object' ? fields : {})
  };
}

function createGroupRequestBody(name, color, patternId) {
  return { name: name, color: color, patternId: patternId };
}


module.exports = {
  DEFAULT_LIST_PATH,
  DEFAULT_LIST_METHOD,
  DEFAULT_CREATE_PATH,
  DEFAULT_IMPORT_FIELD,
  DEFAULT_COLOR,
  DEFAULT_PATTERN_ID,
  MAX_LIST_PAGES,
  RESERVED_GROUP_NAMES,
  GROUP_COLORS,
  GROUP_TYPES,
  GROUP_BODY_ENCODINGS,
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
  displayGroupLabel,
  extractRows,
  asObject,
  pickId,
  pickName,
  pickType,
  normalizeGroupBodyEncoding,
  envGroupBodyEncoding,
  getRememberedGroupBodyEncoding,
  resetGroupBodyEncodingMemory,
  rememberGroupBodyEncoding,
  groupBodyEncodingOrder,
  buildGroupBody
};
