'use strict';

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { config } = require('./config');

/** @type {Map<string, { statementVersion: string, createdAt: number, expiresAt: number, used: boolean }>} */
const tickets = new Map();

function ensureLogDir() {
  const dir = path.dirname(path.resolve(config.consentLogPath));
  fs.mkdirSync(dir, { recursive: true });
}

function appendAudit(event, fields) {
  ensureLogDir();
  const row = {
    ts: new Date().toISOString(),
    event,
    statementVersion: fields.statementVersion,
    ticketIdPrefix: fields.ticketId ? String(fields.ticketId).slice(0, 8) : undefined,
    ok: fields.ok,
    reason: fields.reason,
    // Explicitly omit photos, tokens, passwords, full ticket, PII names
  };
  fs.appendFileSync(config.consentLogPath, JSON.stringify(row) + '\n', 'utf8');
}

function issueTicket(statementVersion) {
  if (statementVersion !== config.statementVersion) {
    const err = new Error('聲明版本不符');
    err.code = 'STATEMENT_MISMATCH';
    err.status = 400;
    throw err;
  }
  const ticketId = crypto.randomBytes(32).toString('hex');
  const createdAt = Date.now();
  const expiresAt = createdAt + config.consentTtlSeconds * 1000;
  tickets.set(ticketId, {
    statementVersion,
    createdAt,
    expiresAt,
    used: false
  });
  appendAudit('consent_issued', {
    statementVersion,
    ticketId,
    ok: true
  });
  return {
    ticket: ticketId,
    expiresAt: new Date(expiresAt).toISOString(),
    statementVersion
  };
}

function consumeTicket(ticketId, expectedStatementVersion) {
  if (!ticketId || typeof ticketId !== 'string' || ticketId.length < 32) {
    const err = new Error('缺少或無效的同意票證');
    err.code = 'CONSENT_MISSING';
    err.status = 403;
    throw err;
  }
  const row = tickets.get(ticketId);
  if (!row) {
    appendAudit('consent_reject', {
      statementVersion: expectedStatementVersion,
      ticketId,
      ok: false,
      reason: 'unknown_or_expired_cleared'
    });
    const err = new Error('同意票證無效或已過期');
    err.code = 'CONSENT_INVALID';
    err.status = 403;
    throw err;
  }
  if (row.used) {
    appendAudit('consent_reject', {
      statementVersion: row.statementVersion,
      ticketId,
      ok: false,
      reason: 'replay'
    });
    const err = new Error('同意票證已使用（禁止重放）');
    err.code = 'CONSENT_REPLAY';
    err.status = 403;
    throw err;
  }
  if (Date.now() > row.expiresAt) {
    tickets.delete(ticketId);
    appendAudit('consent_reject', {
      statementVersion: row.statementVersion,
      ticketId,
      ok: false,
      reason: 'expired'
    });
    const err = new Error('同意票證已過期，請重新同意');
    err.code = 'CONSENT_EXPIRED';
    err.status = 403;
    throw err;
  }
  if (row.statementVersion !== expectedStatementVersion) {
    appendAudit('consent_reject', {
      statementVersion: row.statementVersion,
      ticketId,
      ok: false,
      reason: 'mismatch'
    });
    const err = new Error('同意票證與目前聲明版本不符');
    err.code = 'CONSENT_VERSION_MISMATCH';
    err.status = 403;
    throw err;
  }
  row.used = true;
  tickets.set(ticketId, row);
  appendAudit('consent_consumed', {
    statementVersion: row.statementVersion,
    ticketId,
    ok: true
  });
  return row;
}

/** Test helper */
function _resetForTests() {
  tickets.clear();
}

module.exports = {
  issueTicket,
  consumeTicket,
  appendAudit,
  _resetForTests
};
