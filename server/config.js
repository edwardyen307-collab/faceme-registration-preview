'use strict';

const path = require('path');
const { loadDotEnv } = require('./load-dotenv');
const { centralHostIsLoopback } = require('./env-file');

const envDiagnostics = loadDotEnv(path.join(__dirname, '..', '.env'));

function bool(name, defaultValue) {
  const raw = process.env[name];
  if (raw === undefined || raw === '') return defaultValue;
  return raw === '1' || /^true$/i.test(raw) || /^yes$/i.test(raw);
}

function int(name, defaultValue) {
  const n = Number.parseInt(process.env[name] || '', 10);
  return Number.isFinite(n) ? n : defaultValue;
}

const {
  CANONICAL_STATEMENT_VERSION,
  inspectEnvOverride
} = require('./statement-version');

const statementEnvInfo = inspectEnvOverride(process.env.FACEME_STATEMENT_VERSION);
const STATEMENT_VERSION = statementEnvInfo.canonical;

const realModeFlag = bool('FACEME_REAL_MODE', false);
const legalConfirmed = bool('FACEME_STATEMENT_LEGAL_CONFIRMED', false);
const realModeEnabled = realModeFlag && legalConfirmed;

const corsOrigins = String(process.env.CORS_ORIGINS || '')
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean);

const config = {
  host: process.env.HOST || '127.0.0.1',
  port: int('PORT', 8443),
  statementVersion: STATEMENT_VERSION,
  statementEnvIgnored: statementEnvInfo.ignored,
  statementEnvValue: statementEnvInfo.envValue,
  statementEnvWarning: statementEnvInfo.warning,
  realModeFlag,
  legalConfirmed,
  realModeEnabled,
  facemeBaseUrl: String(process.env.FACEME_BASE_URL || '').replace(/\/+$/, ''),
  facemeAccount: process.env.FACEME_ACCOUNT || '',
  facemePassword: process.env.FACEME_PASSWORD || '',
  skipTlsVerify: bool('FACEME_SKIP_TLS_VERIFY', false),
  consentTtlSeconds: int('CONSENT_TTL_SECONDS', 600),
  consentLogPath:
    process.env.CONSENT_LOG_PATH ||
    path.join(__dirname, '..', 'runtime', 'consent.jsonl'),
  corsOrigins,
  upstreamTimeoutMs: int('UPSTREAM_TIMEOUT_MS', 15000),
  maxUploadBytes: int('MAX_UPLOAD_BYTES', 8 * 1024 * 1024),
  rateLimitWindowMs: int('RATE_LIMIT_WINDOW_MS', 60000),
  rateLimitMax: int('RATE_LIMIT_MAX', 60),
  publicRoot: path.join(__dirname, '..'),
  appVersion: 'v2026-11-09f',
  envDiagnostics
};

// If Central is not loopback, never keep skip TLS on at runtime.
if (config.skipTlsVerify && !centralHostIsLoopback(config.facemeBaseUrl)) {
  config.skipTlsVerify = false;
  process.env.FACEME_SKIP_TLS_VERIFY = '0';
  envDiagnostics.warnings = envDiagnostics.warnings || [];
  envDiagnostics.warnings.push(
    'FACEME_SKIP_TLS_VERIFY 已在記憶體關閉：Central 位址不是 127.0.0.1／localhost／::1。略過憑證僅允許本機 Central。'
  );
}

function assertRealModeReady() {
  if (!config.realModeFlag) {
    const err = new Error('真實模式未啟用（FACEME_REAL_MODE≠1）');
    err.code = 'REAL_MODE_DISABLED';
    err.status = 503;
    throw err;
  }
  if (!config.legalConfirmed) {
    const err = new Error(
      '法務聲明尚未確認（FACEME_STATEMENT_LEGAL_CONFIRMED≠1）；預設不寫入 Central'
    );
    err.code = 'STATEMENT_NOT_CONFIRMED';
    err.status = 503;
    throw err;
  }
  if (!config.facemeBaseUrl) {
    const err = new Error('伺服器未設定 FACEME_BASE_URL');
    err.code = 'MISSING_BASE_URL';
    err.status = 503;
    throw err;
  }
  if (!config.facemeAccount || !config.facemePassword) {
    const err = new Error('伺服器未設定 Central 帳密');
    err.code = 'MISSING_CREDENTIALS';
    err.status = 503;
    throw err;
  }
}

function setFacemeBaseUrl(normalized) {
  const url = String(normalized || '').replace(/\/+$/, '');
  config.facemeBaseUrl = url;
  process.env.FACEME_BASE_URL = url;
}

function setSkipTlsVerify(enabled) {
  const on = Boolean(enabled);
  config.skipTlsVerify = on;
  process.env.FACEME_SKIP_TLS_VERIFY = on ? '1' : '0';
}

function canEnableSkipTlsVerify(baseUrl) {
  return centralHostIsLoopback(baseUrl || config.facemeBaseUrl);
}

module.exports = {
  config,
  assertRealModeReady,
  loadDotEnv,
  setFacemeBaseUrl,
  setSkipTlsVerify,
  canEnableSkipTlsVerify,
  statementEnvInfo,
  envDiagnostics
};
