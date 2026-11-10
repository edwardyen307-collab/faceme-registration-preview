'use strict';

/**
 * Local one-click launcher (invoked by start.bat).
 * - No ExecutionPolicy Bypass
 * - Does not read/transmit .env passwords to remote tools
 * - Writes minimal diagnostics to runtime/launcher.log (no secrets)
 */

const fs = require('fs');
const path = require('path');
const http = require('http');
const { spawn, execFileSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..');
const APP_VERSION = 'v2026-11-09m';
const MIN_NODE_MAJOR = 18;
const DEFAULT_HOST = '127.0.0.1';
const DEFAULT_PORT = 8443;
const LOCAL_URL_PATH = '/?local=1';
const LOG_PATH = path.join(ROOT, 'runtime', 'launcher.log');

let serverChild = null;

function ensureRuntimeDir() {
  fs.mkdirSync(path.join(ROOT, 'runtime'), { recursive: true });
}

function diag(line) {
  try {
    ensureRuntimeDir();
    const stamp = new Date().toISOString();
    fs.appendFileSync(LOG_PATH, stamp + ' ' + String(line).replace(/\r?\n/g, ' ') + '\n', 'utf8');
  } catch (_) {
    /* ignore log failures */
  }
}

function log(msg) {
  console.log(msg);
  diag('INFO ' + msg);
}

function fail(msg, code) {
  console.error('\n[ERROR] ' + msg);
  diag('ERROR ' + msg + ' code=' + (code || 1));
  cleanupChild('fail');
  process.exit(code || 1);
}

function cleanupChild(reason) {
  if (!serverChild || serverChild.killed) return;
  diag('cleanupChild reason=' + reason + ' pid=' + serverChild.pid);
  try {
    if (process.platform === 'win32') {
      try {
        execFileSync(
          'taskkill',
          ['/PID', String(serverChild.pid), '/T', '/F'],
          { stdio: 'ignore' }
        );
      } catch (_) {
        try {
          serverChild.kill();
        } catch (_) {}
      }
    } else {
      serverChild.kill('SIGTERM');
    }
  } catch (_) {}
  serverChild = null;
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

/** Never log secret values — only whether keys exist. */
function envPresenceSummary(env) {
  return {
    hasAccount: Boolean(env.FACEME_ACCOUNT),
    hasPassword: Boolean(env.FACEME_PASSWORD),
    baseHost: (() => {
      try {
        return env.FACEME_BASE_URL ? new URL(env.FACEME_BASE_URL).host : '';
      } catch (_) {
        return '(invalid-url)';
      }
    })(),
    host: env.HOST || DEFAULT_HOST,
    port: env.PORT || String(DEFAULT_PORT),
    realMode: env.FACEME_REAL_MODE || '0',
    legal: env.FACEME_STATEMENT_LEGAL_CONFIRMED || '0',
    lanAccess: env.FACEME_LAN_ACCESS || '0'
  };
}

function assertProjectLayout() {
  const need = ['package.json', 'package-lock.json', 'server/index.js', 'index.html', 'app.js'];
  const missing = need.filter((rel) => !fs.existsSync(path.join(ROOT, rel)));
  if (missing.length) {
    fail(
      'Project files missing: ' +
        missing.join(', ') +
        '. Unzip the FULL archive (not a single file). Path: ' +
        ROOT,
      10
    );
  }
}

function ensureEnv() {
  const envPath = path.join(ROOT, '.env');
  const examplePath = path.join(ROOT, '.env.example');
  if (fs.existsSync(envPath)) {
    log('.env exists -> will NOT overwrite.');
    diag('env exists presence=' + JSON.stringify(envPresenceSummary(readEnvFile(envPath))));
    return { created: false, envPath };
  }
  if (!fs.existsSync(examplePath)) {
    fail('Missing .env.example; cannot create .env', 11);
  }
  fs.copyFileSync(examplePath, envPath);
  log('Created .env from .env.example (default FACEME_BASE_URL=https://127.0.0.1).');
  log('Fill FACEME_ACCOUNT / FACEME_PASSWORD in Notepad. Do not share this file.');
  diag('env created (no secret values logged)');

  if (process.platform === 'win32') {
    try {
      const user = process.env.USERNAME || '';
      if (user) {
        execFileSync(
          'icacls',
          [envPath, '/inheritance:r', '/grant:r', user + ':(R,W)'],
          { stdio: 'ignore' }
        );
        log('Attempted to restrict .env ACL to current user.');
      }
    } catch (_) {
      log('(hint) Could not tighten .env ACL automatically.');
    }
    try {
      spawn('notepad.exe', [envPath], { detached: true, stdio: 'ignore' }).unref();
      log('Opened Notepad for .env. You can edit while startup continues.');
    } catch (_) {
      log('Open .env manually: ' + envPath);
    }
  } else {
    log('Non-Windows: edit ' + envPath + ' manually.');
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
  log('Installing dependencies (npm ci)...');
  diag('npm ci start platform=' + process.platform);
  // On Windows, npm is npm.cmd — spawn with shell so .cmd works (same idea as "call npm.cmd" in bat).
  const npmCmd = process.platform === 'win32' ? 'npm.cmd' : 'npm';
  const args = ['ci', '--omit=dev'];
  const r = spawn(npmCmd, args, {
    cwd: ROOT,
    stdio: 'inherit',
    shell: process.platform === 'win32',
    windowsHide: true
  });
  return new Promise((resolve, reject) => {
    r.on('error', (e) => {
      reject(
        new Error(
          'Failed to start npm (' +
            npmCmd +
            '): ' +
            (e && e.message) +
            '. Is Node.js installed correctly?'
        )
      );
    });
    r.on('exit', (code) => {
      if (code !== 0) {
        reject(
          new Error(
            'npm ci failed (exit ' +
              code +
              '). Check network/proxy. Delete node_modules and retry start.bat. Full npm output is above.'
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
      diag('npm ci ok');
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


function printLanUrls(port) {
  try {
    const lan = require(path.join(ROOT, 'server', 'lan-access'));
    const urls = lan.phoneUrls(port);
    log('LAN access ON. Phone URL(s) on the same Wi-Fi:');
    if (urls.length) {
      urls.forEach((u) => log('  ' + u));
    } else {
      log('  (no RFC1918 IPv4 found — check the Wi-Fi adapter)');
    }
    log(lan.FIREWALL_NOTE);
  } catch (e) {
    log('LAN access ON, but could not list phone URLs: ' + ((e && e.message) || e));
  }
}

function openBrowser(url) {
  log('Opening browser: ' + url);
  if (process.platform === 'win32') {
    spawn('cmd', ['/c', 'start', '', url], {
      detached: true,
      stdio: 'ignore',
      windowsHide: true
    }).unref();
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
    return { state: 'foreign', detail: 'HTTP ' + res.status + ' (not this appVersion)' };
  }
  return { state: 'foreign', detail: 'unrecognized response' };
}

function startServerProcess() {
  const child = spawn(process.execPath, [path.join(ROOT, 'server', 'index.js')], {
    cwd: ROOT,
    stdio: 'inherit',
    env: process.env,
    detached: false,
    windowsHide: true
  });
  serverChild = child;
  child.on('exit', (code, signal) => {
    diag('server exit code=' + code + ' signal=' + signal);
    serverChild = null;
  });
  return child;
}

async function waitForHealth(host, port, attempts) {
  for (let i = 0; i < attempts; i++) {
    const p = await probeOurServer(host, port);
    if (p.state === 'ours' || p.state === 'foreign') return p;
    await new Promise((r) => setTimeout(r, 400));
  }
  return { state: 'down' };
}

async function main() {
  ensureRuntimeDir();
  diag('---- launcher start version=' + APP_VERSION + ' node=' + process.versions.node + ' platform=' + process.platform);
  log('Working directory: ' + ROOT);
  log('App version: ' + APP_VERSION);

  if (nodeMajor() < MIN_NODE_MAJOR) {
    fail(
      'Node.js too old (now ' +
        process.versions.node +
        '). Install LTS >= ' +
        MIN_NODE_MAJOR +
        ' from https://nodejs.org/',
      2
    );
  }

  assertProjectLayout();
  ensureEnv();

  const env = readEnvFile(path.join(ROOT, '.env'));
  const lanOn = env.FACEME_LAN_ACCESS === '1' || /^true$/i.test(env.FACEME_LAN_ACCESS || '');
  // Health + browser always use loopback. LAN flag binds 0.0.0.0 in the Node server, not here.
  const host = DEFAULT_HOST;
  const port = Number.parseInt(env.PORT || String(DEFAULT_PORT), 10) || DEFAULT_PORT;
  const pageUrl = 'http://' + host + ':' + port + LOCAL_URL_PATH;
  diag('listen probe host=' + host + ' port=' + port + ' lanAccess=' + (lanOn ? '1' : '0'));

  if (needNpmCi()) {
    try {
      await runNpmCi();
    } catch (e) {
      fail(e.message || String(e), 3);
    }
  } else {
    log('Dependencies OK; skip npm ci.');
  }

  const existing = await probeOurServer(host, port);
  if (existing.state === 'ours') {
    log('Service already running (' + APP_VERSION + '). Not starting a second copy.');
    openBrowser(pageUrl);
    log('Local URL (HTTP): ' + pageUrl);
    if (lanOn) printLanUrls(port);
    return;
  }
  if (existing.state === 'foreign') {
    fail(
      'Port ' +
        port +
        ' is used by another program (' +
        (existing.detail || '') +
        '). Close it or change PORT in .env. Browser was NOT opened.',
      4
    );
  }

  log('Starting thin backend...');
  const child = startServerProcess();
  let childExited = null;
  child.on('exit', (code, signal) => {
    childExited = { code, signal };
  });

  const ready = await waitForHealth(host, port, 40);
  if (childExited) {
    fail(
      'Node server exited early (code=' +
        childExited.code +
        ' signal=' +
        childExited.signal +
        '). Scroll up for the stack/error.',
      5
    );
  }
  if (ready.state !== 'ours') {
    cleanupChild('health-not-ours');
    if (ready.state === 'foreign') {
      fail('After start, port response is not this app health. Browser NOT opened.', 4);
    }
    fail(
      'Timed out waiting for /api/health (expected appVersion=' +
        APP_VERSION +
        '). Browser NOT opened.',
      5
    );
  }

  log('health OK: appVersion=' + ready.health.appVersion);
  openBrowser(pageUrl);
  log('Local URL (HTTP): ' + pageUrl);
  if (lanOn) printLanUrls(port);
  log('Keep this window open to see server logs. Closing it may stop the service.');

  process.on('SIGINT', () => {
    cleanupChild('SIGINT');
    process.exit(0);
  });
  process.on('SIGTERM', () => {
    cleanupChild('SIGTERM');
    process.exit(0);
  });

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
  assertProjectLayout,
  envPresenceSummary,
  ROOT,
  LOG_PATH
};

if (require.main === module) {
  main().catch((e) => fail(e && e.message ? e.message : String(e), 1));
}
