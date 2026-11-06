'use strict';

/**
 * Windows / local one-click launcher (invoked by start.bat).
 * - No ExecutionPolicy Bypass
 * - Does not read or transmit .env passwords to any remote tool
 * - Does not call live Central except via the started local server APIs the user triggers
 */

const fs = require('fs');
const path = require('path');
const http = require('http');
const { spawn, execFileSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..');
const APP_VERSION = 'v2026-11-06c';
const MIN_NODE_MAJOR = 18;
const DEFAULT_HOST = '127.0.0.1';
const DEFAULT_PORT = 8443;
const LOCAL_URL_PATH = '/?local=1';

function log(msg) {
  console.log(msg);
}

function fail(msg, code) {
  console.error('\n[錯誤] ' + msg);
  process.exit(code || 1);
}

function nodeMajor() {
  const m = String(process.versions.node || '').split('.')[0];
  return Number.parseInt(m, 10) || 0;
}

function readEnvFile(filePath) {
  const out = {};
  if (!fs.existsSync(filePath)) return out;
  const text = fs.readFileSync(filePath, 'utf8');
  for (const line of text.split(/\r?\n/)) {
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
    out[key] = val;
  }
  return out;
}

function ensureEnv() {
  const envPath = path.join(ROOT, '.env');
  const examplePath = path.join(ROOT, '.env.example');
  if (fs.existsSync(envPath)) {
    log('已存在 .env → 不會覆蓋。');
    return { created: false, envPath };
  }
  if (!fs.existsSync(examplePath)) {
    fail('缺少 .env.example，無法建立 .env');
  }
  fs.copyFileSync(examplePath, envPath);
  log('已由 .env.example 建立新的 .env（預設 FACEME_BASE_URL=https://127.0.0.1）。');
  log('請在記事本填寫 FACEME_ACCOUNT / FACEME_PASSWORD（本機檔案，勿分享）。');
  log('注意：.env 含密碼風險；請鎖定電腦，勿提交 git / 雲端同步公開資料夾。');

  // Best-effort ACL tighten on Windows only
  if (process.platform === 'win32') {
    try {
      const user = process.env.USERNAME || process.env.USER || '';
      if (user) {
        execFileSync(
          'icacls',
          [envPath, '/inheritance:r', '/grant:r', user + ':(R,W)'],
          { stdio: 'ignore' }
        );
        log('已嘗試將 .env ACL 限為目前使用者讀寫（icacls）。');
      }
    } catch (_) {
      log('（提示）無法自動收緊 .env ACL，請手動確認檔案權限。');
    }
    try {
      spawn('notepad.exe', [envPath], { detached: true, stdio: 'ignore' }).unref();
      log('已開啟記事本編輯 .env。填好後可關閉記事本；服務仍會繼續啟動。');
    } catch (_) {
      log('無法自動開啟記事本，請手動編輯：' + envPath);
    }
  } else {
    log('非 Windows：請手動編輯 ' + envPath);
  }
  return { created: true, envPath };
}

function needNpmCi() {
  const nm = path.join(ROOT, 'node_modules');
  const lock = path.join(ROOT, 'package-lock.json');
  const pkg = path.join(ROOT, 'package.json');
  if (!fs.existsSync(nm) || !fs.existsSync(path.join(nm, 'express'))) return true;
  if (!fs.existsSync(lock)) return true;
  try {
    const lockM = fs.statSync(lock).mtimeMs;
    const stamp = path.join(nm, '.faceme_ci_stamp');
    if (!fs.existsSync(stamp)) return true;
    const stampM = Number(fs.readFileSync(stamp, 'utf8')) || 0;
    if (lockM > stampM) return true;
    if (fs.statSync(pkg).mtimeMs > stampM) return true;
  } catch (_) {
    return true;
  }
  return false;
}

function runNpmCi() {
  log('正在安裝依賴（npm ci）…');
  const npmCmd = process.platform === 'win32' ? 'npm.cmd' : 'npm';
  const r = spawn(npmCmd, ['ci', '--omit=dev'], {
    cwd: ROOT,
    stdio: 'inherit',
    shell: process.platform === 'win32'
  });
  return new Promise((resolve, reject) => {
    r.on('error', (e) => reject(e));
    r.on('exit', (code) => {
      if (code !== 0) {
        reject(
          new Error(
            'npm ci 失敗（代碼 ' +
              code +
              '）。請確認網路／公司代理，或刪除 node_modules 後再雙擊 start.bat。完整訊息見上方。'
          )
        );
        return;
      }
      try {
        fs.writeFileSync(
          path.join(ROOT, 'node_modules', '.faceme_ci_stamp'),
          String(Date.now()),
          'utf8'
        );
      } catch (_) {}
      resolve();
    });
  });
}

function httpGetJson(url, timeoutMs) {
  return new Promise((resolve) => {
    const req = http.get(url, { timeout: timeoutMs || 2000 }, (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => {
        const text = Buffer.concat(chunks).toString('utf8');
        let json = null;
        try {
          json = JSON.parse(text);
        } catch (_) {}
        resolve({ ok: true, status: res.statusCode, json, text });
      });
    });
    req.on('error', (err) => resolve({ ok: false, error: err }));
    req.on('timeout', () => {
      req.destroy();
      resolve({ ok: false, error: new Error('timeout') });
    });
  });
}

function openBrowser(url) {
  log('開啟瀏覽器：' + url);
  if (process.platform === 'win32') {
    spawn('cmd', ['/c', 'start', '', url], { detached: true, stdio: 'ignore' }).unref();
  } else if (process.platform === 'darwin') {
    spawn('open', [url], { detached: true, stdio: 'ignore' }).unref();
  } else {
    spawn('xdg-open', [url], { detached: true, stdio: 'ignore' }).unref();
  }
}

async function probeOurServer(host, port) {
  const url = 'http://' + host + ':' + port + '/api/health';
  const res = await httpGetJson(url, 1500);
  if (!res.ok) return { state: 'down' };
  if (res.status === 200 && res.json && res.json.appVersion === APP_VERSION) {
    return { state: 'ours', health: res.json };
  }
  if (res.status) {
    return { state: 'foreign', detail: 'HTTP ' + res.status + '（非本版 health）' };
  }
  return { state: 'foreign', detail: '無法辨識的回應' };
}

function startServerProcess() {
  const child = spawn(process.execPath, [path.join(ROOT, 'server', 'index.js')], {
    cwd: ROOT,
    stdio: 'inherit',
    env: process.env,
    detached: false
  });
  return child;
}

async function waitForHealth(host, port, attempts) {
  for (let i = 0; i < attempts; i++) {
    const p = await probeOurServer(host, port);
    if (p.state === 'ours') return p;
    if (p.state === 'foreign') return p;
    await new Promise((r) => setTimeout(r, 400));
  }
  return { state: 'down' };
}

async function main() {
  log('工作目錄：' + ROOT);
  if (nodeMajor() < MIN_NODE_MAJOR) {
    fail(
      'Node.js 版本過舊（目前 ' +
        process.versions.node +
        '）。請安裝官方 LTS（建議 ≥ ' +
        MIN_NODE_MAJOR +
        '）: https://nodejs.org/',
      2
    );
  }
  log('Node ' + process.versions.node + ' OK');

  ensureEnv();
  const env = readEnvFile(path.join(ROOT, '.env'));
  const host = env.HOST || DEFAULT_HOST;
  const port = Number.parseInt(env.PORT || String(DEFAULT_PORT), 10) || DEFAULT_PORT;
  const pageUrl = 'http://' + host + ':' + port + LOCAL_URL_PATH;

  if (needNpmCi()) {
    try {
      await runNpmCi();
    } catch (e) {
      fail(e.message || String(e), 3);
    }
  } else {
    log('依賴已就緒，略過 npm ci。');
  }

  const existing = await probeOurServer(host, port);
  if (existing.state === 'ours') {
    log('偵測到本版服務已在執行（' + APP_VERSION + '）。不會重複啟動。');
    openBrowser(pageUrl);
    log('本機網址：' + pageUrl + ' （HTTP，非 HTTPS）');
    return;
  }
  if (existing.state === 'foreign') {
    fail(
      '連接埠 ' +
        port +
        ' 已被其他程式占用（' +
        (existing.detail || '') +
        '）。請關閉占用程式或改 .env 的 PORT 後重試。不會開啟瀏覽器以免誤判成功。',
      4
    );
  }

  log('啟動薄後端…');
  const child = startServerProcess();
  let childExited = null;
  child.on('exit', (code, signal) => {
    childExited = { code, signal };
  });

  const ready = await waitForHealth(host, port, 40);
  if (childExited) {
    fail(
      'Node 服務已結束（code=' +
        childExited.code +
        ' signal=' +
        childExited.signal +
        '）。請向上捲動查看錯誤。',
      5
    );
  }
  if (ready.state !== 'ours') {
    try {
      child.kill();
    } catch (_) {}
    if (ready.state === 'foreign') {
      fail(
        '啟動後連接埠回應不是本版 health。可能被其他服務搶佔。未開啟瀏覽器。',
        4
      );
    }
    fail('等待 /api/health 逾時（預期 appVersion=' + APP_VERSION + '）。未開啟瀏覽器。', 5);
  }

  log('health OK：appVersion=' + ready.health.appVersion);
  openBrowser(pageUrl);
  log('本機網址：' + pageUrl + ' （HTTP，非 HTTPS）');
  log('此視窗會保持開啟以顯示服務日誌；關閉視窗可能結束服務。');

  // Keep launcher attached to server stdio
  await new Promise((resolve) => {
    child.on('exit', resolve);
  });
  process.exit(child.exitCode || 0);
}

module.exports = {
  APP_VERSION,
  MIN_NODE_MAJOR,
  needNpmCi,
  readEnvFile,
  probeOurServer,
  nodeMajor,
  ROOT
};

if (require.main === module) {
  main().catch((e) => fail(e && e.message ? e.message : String(e), 1));
}
