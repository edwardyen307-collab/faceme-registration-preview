'use strict';

/**
 * FaceMe Security Central — group list / create adapters.
 *
 * STATUS: GUESSED (not live-verified against intranet swagger).
 * Observed product uses `/api/website/...` (signIn, snapshot/qc, person/import).
 * Related FaceOS device docs use `groupId` on person create, but different base paths.
 *
 * Override via .env if intranet swagger differs:
 *   FACEME_GROUP_LIST_PATH=/api/website/group
 *   FACEME_GROUP_CREATE_PATH=/api/website/group
 *   FACEME_GROUP_CREATE_METHOD=POST
 *   FACEME_IMPORT_GROUP_FIELD=groupId   (also tries groupIds / groups)
 */

const DEFAULT_LIST_PATH = '/api/website/group';
const DEFAULT_CREATE_PATH = '/api/website/group';
const DEFAULT_IMPORT_FIELD = 'groupId';

function groupListPath() {
  return String(process.env.FACEME_GROUP_LIST_PATH || DEFAULT_LIST_PATH).trim() || DEFAULT_LIST_PATH;
}
function groupCreatePath() {
  return String(process.env.FACEME_GROUP_CREATE_PATH || DEFAULT_CREATE_PATH).trim() || DEFAULT_CREATE_PATH;
}
function importGroupField() {
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

/**
 * Normalize various Central list shapes → [{id,name}]
 * GUESSED shapes: array | {data:[]} | {groups:[]} | {entity:[]} | {entity:{content:[]}} | {content:[]}
 */
function parseGroupList(status, body) {
  if (status < 200 || status >= 300) {
    const err = new Error('無法取得 Central 群組列表（HTTP ' + status + '）');
    err.code = 'GROUP_LIST_HTTP';
    err.status = 502;
    throw err;
  }
  const obj = asObject(body);
  let rows = null;
  if (Array.isArray(obj)) rows = obj;
  else if (obj && Array.isArray(obj.data)) rows = obj.data;
  else if (obj && Array.isArray(obj.groups)) rows = obj.groups;
  else if (obj && Array.isArray(obj.entity)) rows = obj.entity;
  else if (obj && obj.entity && Array.isArray(obj.entity.content)) rows = obj.entity.content;
  else if (obj && Array.isArray(obj.content)) rows = obj.content;
  else if (obj && obj.data && Array.isArray(obj.data.content)) rows = obj.data.content;
  else if (obj && Array.isArray(obj.result)) rows = obj.result;

  if (!rows) {
    const err = new Error(
      'Central 群組列表格式無法判讀（fail closed）。請對照 swagger 調整 FACEME_GROUP_LIST_PATH／解析器。'
    );
    err.code = 'GROUP_LIST_SHAPE';
    err.status = 502;
    throw err;
  }

  const out = [];
  const seen = new Set();
  for (const row of rows) {
    const id = pickId(row);
    const name = pickName(row) || (id ? String(id) : null);
    if (!id && !name) continue;
    const key = String(id || name).toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ id: id || name, name: name || String(id) });
  }
  return out;
}

/**
 * Parse create-group response → {id,name}
 * GUESSED: {id,name} | {groupId,name} | {data:{...}} | {entity:{...}}
 */
function parseCreatedGroup(status, body, fallbackName) {
  if (status < 200 || status >= 300) {
    const obj = asObject(body);
    const msg =
      (obj && (obj.message || obj.msg || obj.error)) ||
      '建立群組失敗（HTTP ' + status + '）';
    const err = new Error(String(msg));
    err.code = 'GROUP_CREATE_FAILED';
    err.status = 502;
    throw err;
  }
  const obj = asObject(body) || {};
  const nested = obj.data || obj.entity || obj.group || obj;
  const id = pickId(nested) || pickId(obj);
  const name = pickName(nested) || pickName(obj) || fallbackName;
  if (!id && !name) {
    const err = new Error('建立群組回應缺少 id／name（fail closed）');
    err.code = 'GROUP_CREATE_SHAPE';
    err.status = 502;
    throw err;
  }
  return { id: id || name, name: name || String(id) };
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

module.exports = {
  DEFAULT_LIST_PATH,
  DEFAULT_CREATE_PATH,
  DEFAULT_IMPORT_FIELD,
  groupListPath,
  groupCreatePath,
  importGroupField,
  parseGroupList,
  parseCreatedGroup,
  findGroupByName,
  asObject
};
