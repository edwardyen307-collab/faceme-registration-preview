'use strict';

/**
 * 找人／補群組 — loopback-only person admin helpers (v2026-11-09n).
 *
 * Central endpoints (API Document v8):
 *   POST /api/website/group/member/list  (x-www-form-urlencoded)
 *   POST /api/website/person/query       (x-www-form-urlencoded) personId
 *   POST /api/website/person/update      (multipart/form-data)   personId, groupId
 *
 * UNVERIFIED on live Central: whether member/list without groupId returns
 * ungrouped persons; how person/query represents "no group"; whether
 * person/update replaces the existing group.
 */

const fs = require('fs');
const path = require('path');
const { maskQcPayload } = require('./qc-explain');

const MEMBER_LIST_PATH = '/api/website/group/member/list';
const PERSON_QUERY_PATH = '/api/website/person/query';
const PERSON_UPDATE_PATH = '/api/website/person/update';
const MEMBER_PAGE_SIZE = 100;
const MAX_MEMBER_PAGES = 50;
const MAX_SCAN_RANGE = 200;
const LOG_PATH = path.join(__dirname, '..', '..', 'runtime', 'person-admin.log');

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

function hasGroupId(g) {
  return g && typeof g === 'object' && !Array.isArray(g) && g.groupId != null && g.groupId !== '';
}

function normalizeGroupEntry(g) {
  return {
    groupId: String(g.groupId),
    name: typeof g.name === 'string' ? g.name : null,
    type: typeof g.type === 'string' ? g.type : null
  };
}

/**
 * Classify a person's group field.
 * grouped: object with groupId, or array containing ≥1 object with groupId
 * ungrouped: null, missing, [], {} / object without groupId, array of such
 * unknown: any other type (string, number, boolean)
 */
function classifyPersonGroup(person) {
  if (!person || typeof person !== 'object') {
    return { status: 'unknown', groups: [], raw: 'no-person' };
  }
  const hasGroupKey = Object.prototype.hasOwnProperty.call(person, 'group');
  const g = hasGroupKey ? person.group : person.groups;
  if (!hasGroupKey && !Object.prototype.hasOwnProperty.call(person, 'groups')) {
    return { status: 'ungrouped', groups: [], raw: 'missing' };
  }
  if (g == null) return { status: 'ungrouped', groups: [], raw: 'null' };
  if (Array.isArray(g)) {
    const groups = g.filter(hasGroupId).map(normalizeGroupEntry);
    if (groups.length) return { status: 'grouped', groups: groups, raw: 'array' };
    if (g.every((x) => x == null || (typeof x === 'object' && !hasGroupId(x)))) {
      return { status: 'ungrouped', groups: [], raw: g.length ? 'array-no-groupId' : 'empty-array' };
    }
    return { status: 'unknown', groups: [], raw: 'array-other' };
  }
  if (typeof g === 'object') {
    if (hasGroupId(g)) return { status: 'grouped', groups: [normalizeGroupEntry(g)], raw: 'object' };
    return { status: 'ungrouped', groups: [], raw: 'object-no-groupId' };
  }
  return { status: 'unknown', groups: [], raw: typeof g };
}

function pickPersonId(row) {
  if (!row || typeof row !== 'object') return null;
  const v = row.personId != null ? row.personId : row.id != null ? row.id : null;
  return v != null && v !== '' ? String(v) : null;
}

function summarizePerson(row, baseUrl) {
  const personId = pickPersonId(row);
  const cls = classifyPersonGroup(row);
  return {
    personId: personId,
    name: row && typeof row.name === 'string' ? row.name : null,
    employeeId: row && row.employeeId != null ? String(row.employeeId) : null,
    groupStatus: cls.status,
    groupShape: cls.raw,
    groups: cls.groups,
    detailUrl: personId ? buildDetailUrl(baseUrl, personId) : null
  };
}

function buildDetailUrl(baseUrl, personId) {
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

function centralError(message, code, status, techDetails) {
  const err = new Error(message);
  err.code = code;
  err.status = status || 502;
  if (techDetails !== undefined) err.techDetails = techDetails;
  return err;
}

function errorText(obj, fallback) {
  return String((obj && (obj.errorMessage || obj.message || obj.msg || obj.error)) || fallback);
}

/** Parse one member/list page. */
function parseMemberListPage(status, body, baseUrl) {
  const obj = asObject(body);
  const masked = maskQcPayload(obj != null ? obj : body);
  if (status < 200 || status >= 300) {
    throw centralError(
      '讀取成員列表失敗（HTTP ' + status + '）：' + errorText(obj, ''),
      'MEMBER_LIST_HTTP',
      502,
      masked
    );
  }
  let rows = null;
  if (obj && Array.isArray(obj.results)) rows = obj.results;
  else if (obj && obj.data && Array.isArray(obj.data.results)) rows = obj.data.results;
  else if (obj && Array.isArray(obj.data)) rows = obj.data;
  else if (Array.isArray(obj)) rows = obj;
  if (!rows) {
    throw centralError('成員列表格式無法判讀（fail closed）', 'MEMBER_LIST_SHAPE', 502, masked);
  }
  let totalSize = null;
  for (const r of [obj, obj && obj.data].filter(Boolean)) {
    if (r.totalSize != null && Number.isFinite(Number(r.totalSize))) {
      totalSize = Number(r.totalSize);
      break;
    }
  }
  return {
    persons: rows.map((r) => summarizePerson(r, baseUrl)),
    totalSize: totalSize,
    rowCount: rows.length,
    techDetails: masked
  };
}

/** Parse person/query. Returns null for not-found (404 or empty / no personId). */
function parsePersonQuery(status, body, baseUrl) {
  const obj = asObject(body);
  const masked = maskQcPayload(obj != null ? obj : body);
  if (status === 404) return null;
  if (status < 200 || status >= 300) {
    const msg = errorText(obj, '');
    if (status === 400 && /not\s*found|not\s*exist|no such|找不到|不存在/i.test(msg)) return null;
    throw centralError(
      '查詢人員失敗（HTTP ' + status + '）' + (msg ? '：' + msg : ''),
      'PERSON_QUERY_HTTP',
      status === 400 ? 400 : 502,
      masked
    );
  }
  if (!obj) return null;
  const person = obj.personId != null || obj.name != null ? obj : obj.data && typeof obj.data === 'object' ? obj.data : obj;
  if (!pickPersonId(person)) return null;
  const s = summarizePerson(person, baseUrl);
  s.techDetails = masked;
  return s;
}

function parsePersonUpdate(status, body) {
  const obj = asObject(body);
  const masked = maskQcPayload(obj != null ? obj : body);
  if (status < 200 || status >= 300) {
    throw centralError(
      '更新人員群組失敗（HTTP ' + status + '）' + (errorText(obj, '') ? '：' + errorText(obj, '') : ''),
      'PERSON_UPDATE_FAILED',
      502,
      masked
    );
  }
  const pid =
    (obj && obj.personId != null && String(obj.personId)) ||
    (obj && obj.data && obj.data.personId != null && String(obj.data.personId)) ||
    null;
  return { personId: pid, techDetails: masked };
}

/** Plain-language hint if the no-groupId list looks like only grouped people. */
function memberListHint(persons) {
  if (!persons.length) {
    return 'Central 沒有回傳任何人。Central 可能不會列出未分組的人，請改用編號查詢或範圍掃描。';
  }
  const ungrouped = persons.filter((p) => p.groupStatus === 'ungrouped').length;
  const unknown = persons.filter((p) => p.groupStatus === 'unknown').length;
  if (ungrouped === 0 && unknown === 0) {
    return '列表裡全部都有群組。Central 可能不會列出未分組的人，請改用編號查詢或範圍掃描。';
  }
  return null;
}

function validatePersonId(raw) {
  const s = String(raw == null ? '' : raw).trim();
  if (!/^\d{1,18}$/.test(s) || Number(s) < 1) {
    throw centralError('人員編號必須是正整數', 'PERSON_ID_INVALID', 400);
  }
  return s;
}

function validateGroupIdForUpdate(raw) {
  const s = String(raw == null ? '' : raw).trim();
  if (!/^\d{1,10}$/.test(s) || Number(s) < 1) {
    throw centralError('群組編號必須是正整數', 'GROUP_ID_INVALID', 400);
  }
  return s;
}

function validateScanRange(fromRaw, toRaw) {
  const a = Number(validatePersonId(fromRaw));
  const b = Number(validatePersonId(toRaw));
  if (b < a) throw centralError('範圍結尾必須 ≥ 開頭', 'SCAN_RANGE_INVALID', 400);
  if (b - a + 1 > MAX_SCAN_RANGE) {
    throw centralError('一次最多掃描 ' + MAX_SCAN_RANGE + ' 個編號', 'SCAN_RANGE_TOO_LARGE', 400);
  }
  return { from: a, to: b };
}

/** Form body supporting repeated keys (arrays). */
function buildFormBody(fields) {
  const params = new URLSearchParams();
  for (const k of Object.keys(fields || {})) {
    const v = fields[k];
    if (v == null) continue;
    if (Array.isArray(v)) v.forEach((x) => params.append(k, String(x)));
    else params.append(k, String(v));
  }
  return params.toString();
}

function appendLog(entry) {
  try {
    fs.mkdirSync(path.dirname(LOG_PATH), { recursive: true });
    const safe = {};
    for (const k of Object.keys(entry || {})) {
      if (/token|password|image|snapshot|face/i.test(k)) continue;
      safe[k] = entry[k];
    }
    fs.appendFileSync(LOG_PATH, new Date().toISOString() + ' ' + JSON.stringify(safe) + '\n', 'utf8');
  } catch (_) {}
}

function createPersonAdminClient(deps) {
  const upstream = deps.upstream;
  const getBaseUrl = deps.getBaseUrl;
  const FormDataCtor = deps.FormData;
  const delayMs = deps.scanDelayMs == null ? 120 : deps.scanDelayMs;

  async function postForm(token, p, fields) {
    return upstream(p, {
      method: 'POST',
      headers: { Authorization: token, 'Content-Type': 'application/x-www-form-urlencoded' },
      body: buildFormBody(fields)
    });
  }

  async function listMembersWithoutGroup(token) {
    const all = [];
    const seen = new Set();
    let firstPageMasked = null;
    let totalSize = null;
    let pages = 0;
    for (let pageIndex = 0; pageIndex < MAX_MEMBER_PAGES; pageIndex++) {
      const result = await postForm(token, MEMBER_LIST_PATH, {
        pageIndex: pageIndex,
        pageSize: MEMBER_PAGE_SIZE
      });
      const page = parseMemberListPage(result.status, result.body, getBaseUrl());
      pages++;
      if (pageIndex === 0) firstPageMasked = page.techDetails;
      if (page.totalSize != null) totalSize = page.totalSize;
      for (const p of page.persons) {
        const key = p.personId || JSON.stringify(p);
        if (seen.has(key)) continue;
        seen.add(key);
        all.push(p);
      }
      if (page.rowCount === 0) break;
      if (totalSize != null && all.length >= totalSize) break;
      if (totalSize == null && page.rowCount < MEMBER_PAGE_SIZE) break;
    }
    const counts = { grouped: 0, ungrouped: 0, unknown: 0 };
    all.forEach((p) => counts[p.groupStatus]++);
    return {
      persons: all,
      ungrouped: all.filter((p) => p.groupStatus !== 'grouped'),
      counts: counts,
      totalSize: totalSize,
      pagesFetched: pages,
      truncated: pages >= MAX_MEMBER_PAGES,
      hint: memberListHint(all),
      firstPageRaw: firstPageMasked
    };
  }

  async function queryPerson(token, personId) {
    const id = validatePersonId(personId);
    const result = await postForm(token, PERSON_QUERY_PATH, { personId: id });
    return parsePersonQuery(result.status, result.body, getBaseUrl());
  }

  async function scanRange(token, fromRaw, toRaw) {
    const r = validateScanRange(fromRaw, toRaw);
    const found = [];
    let checked = 0;
    let errors = 0;
    for (let id = r.from; id <= r.to; id++) {
      checked++;
      try {
        const p = await queryPerson(token, id);
        if (p && p.groupStatus !== 'grouped') {
          delete p.techDetails;
          found.push(p);
        }
      } catch (e) {
        errors++;
        if (e && (e.status === 401 || e.status === 403)) throw e;
      }
      if (delayMs > 0 && id < r.to) await new Promise((res) => setTimeout(res, delayMs));
    }
    return { from: r.from, to: r.to, checked: checked, errors: errors, ungrouped: found };
  }

  async function updatePersonGroup(token, personId, groupId) {
    const pid = validatePersonId(personId);
    const gid = validateGroupIdForUpdate(groupId);
    const fields = { personId: pid, groupId: gid }; // never tagId / recordId
    const attempts = [];
    const order = ['multipart', 'form'];
    let last = null;
    for (const enc of order) {
      let opts;
      if (enc === 'multipart') {
        const fd = new FormDataCtor();
        fd.append('personId', pid);
        fd.append('groupId', gid);
        opts = { method: 'POST', headers: { Authorization: token }, body: fd };
      } else {
        opts = {
          method: 'POST',
          headers: { Authorization: token, 'Content-Type': 'application/x-www-form-urlencoded' },
          body: buildFormBody(fields)
        };
      }
      const result = await upstream(PERSON_UPDATE_PATH, opts);
      attempts.push({ encoding: enc, status: result.status });
      last = result;
      if (result.status === 415) continue;
      const parsed = parsePersonUpdate(result.status, result.body);
      parsed.encoding = enc;
      parsed.attempts = attempts;
      return parsed;
    }
    const err = centralError('Central 不接受 multipart 與 form 編碼（HTTP 415）', 'PERSON_UPDATE_415', 502,
      maskQcPayload(last && last.body));
    err.attempts = attempts;
    throw err;
  }

  return { listMembersWithoutGroup, queryPerson, scanRange, updatePersonGroup };
}

module.exports = {
  MEMBER_LIST_PATH,
  PERSON_QUERY_PATH,
  PERSON_UPDATE_PATH,
  MAX_MEMBER_PAGES,
  MAX_SCAN_RANGE,
  LOG_PATH,
  classifyPersonGroup,
  summarizePerson,
  parseMemberListPage,
  parsePersonQuery,
  parsePersonUpdate,
  memberListHint,
  validatePersonId,
  validateGroupIdForUpdate,
  validateScanRange,
  buildFormBody,
  appendLog,
  createPersonAdminClient
};
