'use strict';

const fs = require('fs');
const path = require('path');

const FILE = path.join(__dirname, '..', 'statement-version.json');

function readCanonical() {
  const raw = fs.readFileSync(FILE, 'utf8');
  const data = JSON.parse(raw);
  const v = data && data.statementVersion;
  if (!v || typeof v !== 'string') {
    throw new Error('statement-version.json missing statementVersion');
  }
  return v;
}

const CANONICAL_STATEMENT_VERSION = readCanonical();

/**
 * If .env sets FACEME_STATEMENT_VERSION differently, we IGNORE it for gating
 * (do not rewrite .env). Callers should surface a plain-language warning.
 */
function inspectEnvOverride(envValue) {
  const fromEnv = envValue == null || envValue === '' ? null : String(envValue).trim();
  if (!fromEnv) {
    return {
      canonical: CANONICAL_STATEMENT_VERSION,
      envValue: null,
      ignored: false,
      warning: null
    };
  }
  if (fromEnv === CANONICAL_STATEMENT_VERSION) {
    return {
      canonical: CANONICAL_STATEMENT_VERSION,
      envValue: fromEnv,
      ignored: false,
      warning: null
    };
  }
  return {
    canonical: CANONICAL_STATEMENT_VERSION,
    envValue: fromEnv,
    ignored: true,
    warning:
      '偵測到 .env 裡的 FACEME_STATEMENT_VERSION=' +
      fromEnv +
      ' 與程式內建聲明版本 ' +
      CANONICAL_STATEMENT_VERSION +
      ' 不同。此覆寫值已被忽略（不會改寫您的 .env）。' +
      '請刪除或註解 .env 中 FACEME_STATEMENT_VERSION 那一行，避免混淆。' +
      '聲明版本只在個資聲明全文改動時才更新，不會跟著程式版號變。'
  };
}

module.exports = {
  CANONICAL_STATEMENT_VERSION,
  FILE,
  readCanonical,
  inspectEnvOverride
};
