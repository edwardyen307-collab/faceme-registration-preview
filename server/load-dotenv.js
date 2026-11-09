'use strict';

const fs = require('fs');
const path = require('path');
const { ENV_PATH, ENV_TXT_PATH } = require('./env-file');

/**
 * Parse .env text → { map, keyCounts }.
 * Last occurrence wins. Strips BOM, trims, unwraps quotes.
 */
function parseEnvText(text) {
  let raw = String(text || '');
  if (raw.charCodeAt(0) === 0xfeff) raw = raw.slice(1);
  const map = Object.create(null);
  const keyCounts = Object.create(null);
  for (const line of raw.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eq = trimmed.indexOf('=');
    if (eq <= 0) continue;
    const key = trimmed.slice(0, eq).trim();
    let val = trimmed.slice(eq + 1).trim();
    if (
      (val.startsWith('"') && val.endsWith('"')) ||
      (val.startsWith("'") && val.endsWith("'"))
    ) {
      val = val.slice(1, -1);
    }
    if (!key) continue;
    keyCounts[key] = (keyCounts[key] || 0) + 1;
    map[key] = val;
  }
  return { map, keyCounts };
}

/**
 * Load .env into process.env.
 * - Within file: last key wins
 * - Keys already present in process.env before load are NOT overwritten (system/user env wins)
 *   and are reported in diagnostics.systemOwnedKeys
 */
function loadDotEnv(filePath) {
  const resolved = path.resolve(filePath || ENV_PATH);
  const diag = {
    envPath: resolved,
    envFound: false,
    envTxtFound: fs.existsSync(ENV_TXT_PATH),
    duplicateKeys: {},
    systemOwnedKeys: [],
    appliedKeys: [],
    warnings: []
  };

  if (!fs.existsSync(resolved)) {
    if (diag.envTxtFound) {
      diag.warnings.push(
        '找不到 .env，但發現 .env.txt。Windows 記事本「另存新檔」常會多出 .txt。請把檔名改成正好是「.env」（不要 .env.txt）。'
      );
    }
    return diag;
  }

  diag.envFound = true;
  const text = fs.readFileSync(resolved, 'utf8');
  const { map, keyCounts } = parseEnvText(text);
  for (const [k, n] of Object.entries(keyCounts)) {
    if (n > 1) diag.duplicateKeys[k] = n;
  }

  const preExisting = Object.create(null);
  for (const k of Object.keys(map)) {
    if (Object.prototype.hasOwnProperty.call(process.env, k) && process.env[k] !== undefined) {
      preExisting[k] = true;
    }
  }

  for (const [k, v] of Object.entries(map)) {
    if (preExisting[k]) {
      diag.systemOwnedKeys.push(k);
      continue;
    }
    process.env[k] = v;
    diag.appliedKeys.push(k);
  }

  if (diag.systemOwnedKeys.length) {
    diag.warnings.push(
      '下列變數在啟動前就已存在於系統／使用者環境變數，因此 .env 裡的同名設定不會生效：' +
        diag.systemOwnedKeys.join(', ') +
        '。請到 Windows「系統內容 → 進階 → 環境變數」刪除它們，或開啟新的命令視窗後再 start.bat。'
    );
  }
  if (diag.duplicateKeys.FACEME_SKIP_TLS_VERIFY) {
    diag.warnings.push(
      '.env 裡 FACEME_SKIP_TLS_VERIFY 出現 ' +
        diag.duplicateKeys.FACEME_SKIP_TLS_VERIFY +
        ' 次；已改為「最後一筆生效」。建議用網頁開關寫回，只留一行。'
    );
  }
  if (diag.envTxtFound) {
    diag.warnings.push(
      '資料夾同時存在 .env.txt；程式只讀 .env。若您改的是 .env.txt，請改檔名或把內容合併進 .env。'
    );
  }

  return diag;
}

module.exports = { loadDotEnv, parseEnvText, ENV_PATH, ENV_TXT_PATH };
