#!/usr/bin/env node
'use strict';

var fs = require('fs');
var path = require('path');
var http = require('http');
var https = require('https');
var net = require('net');
var tls = require('tls');

var root = path.join(__dirname, '..');
var failures = [];

function ok(name, cond, detail) {
  if (cond) console.log('PASS  ' + name);
  else {
    console.log('FAIL  ' + name + (detail ? ' — ' + detail : ''));
    failures.push(name);
  }
}

function read(rel) {
  return fs.readFileSync(path.join(root, rel), 'utf8');
}

var indexHtml = read('index.html');
var registerHtml = read('register.html');
var css = read('styles.css');
var js = read('app.js');
var envExample = read('.env.example');
var readme = read('README.md');
var startBat = read('start.bat');
var launcher = read('scripts/windows-launcher.js');
var ps1 = read('setup-and-start.ps1');

ok('version v2026-11-06c in pages', /v2026-11-06c/.test(indexHtml) && /v2026-11-06c/.test(registerHtml));
ok('statement draft c', /v2026-11-06c-draft/.test(js) && /v2026-11-06c-draft/.test(indexHtml));
ok('env example FACEME_BASE_URL is 127.0.0.1', /^FACEME_BASE_URL=https:\/\/127\.0\.0\.1$/m.test(envExample));
ok('env example real mode off', /^FACEME_REAL_MODE=0$/m.test(envExample));
ok('env example legal confirm off', /^FACEME_STATEMENT_LEGAL_CONFIRMED=0$/m.test(envExample));
ok('start.bat exists and calls node launcher', /windows-launcher\.js/.test(startBat) && /nodejs\.org/.test(startBat));
ok('start.bat no ExecutionPolicy Bypass', !/ExecutionPolicy\s+Bypass/i.test(startBat));
ok('ps1 invokes launcher and does not invoke Bypass flag', /windows-launcher\.js/.test(ps1) && !/powershell[^\n]*-ExecutionPolicy\s+Bypass/i.test(ps1+startBat) && /Does NOT use -ExecutionPolicy Bypass/i.test(ps1));
ok('launcher never sets NODE_TLS_REJECT_UNAUTHORIZED', !/NODE_TLS_REJECT_UNAUTHORIZED/.test(launcher));
ok('README three steps + zip URL main', /三步開始/.test(readme) && /archive\/refs\/heads\/main\.zip/.test(readme));
ok('README says HTTP not HTTPS for local page', /http:\/\/127\.0\.0\.1:8443/.test(readme) && /不是 HTTPS/.test(readme));
ok('README notes 127.0.0.1 not guaranteed for Central', /不保證/.test(readme) || /NOT guaranteed/i.test(envExample));
ok('same-origin + conn test UI', /api-base-same-origin/.test(indexHtml) && /btn-conn-test/.test(indexHtml));
ok('gitignore .env', /\.env/.test(read('.gitignore')));

var JSDOM = require('jsdom').JSDOM;

function loadFront(htmlFile, url, beforeEval) {
  var dom = new JSDOM(read(htmlFile), {
    url: url || 'https://edwardyen307-collab.github.io/faceme-registration-preview/' + htmlFile,
    runScripts: 'outside-only',
    pretendToBeVisual: true
  });
  var window = dom.window;
  if (beforeEval) beforeEval(window);
  window.eval(read('app.js'));
  window.document.dispatchEvent(new window.Event('DOMContentLoaded'));
  return { dom: dom, window: window, document: window.document };
}

(function frontendMock() {
  var page = loadFront('index.html');
  ok('pages mock by default', page.window.FaceMePreview.isRealMode() === false);
  page.window.FaceMePreview.setApiBase('http://127.0.0.1:8443');
  ok('setting api base enables backend mode flag', page.window.FaceMePreview.isRealMode() === true);
  page.window.FaceMePreview.setApiBase('');
  ok('clear returns mock', page.window.FaceMePreview.isRealMode() === false);
  page.dom.window.close();
})();

(function localOneClick() {
  var page = loadFront(
    'index.html',
    'http://127.0.0.1:8443/?local=1'
  );
  ok(
    'local=1 auto same-origin api base',
    page.window.FaceMePreview.getApiBase() === 'http://127.0.0.1:8443'
  );
  ok('local=1 is backend mode not empty mock', page.window.FaceMePreview.isRealMode() === true);
  page.dom.window.close();
})();

function adapterTests() {
  var adapters = require(path.join(root, 'server/central/adapters'));
  ok('signIn token', !!adapters.parseSignInToken(200, { token: 'fake-token-for-tests-only-not-real' }));
  ok('QC unknown fail closed', adapters.parseQcResult(200, { x: 1 }).pass === false);
}

async function sleep(ms) {
  return new Promise(function (r) {
    setTimeout(r, ms);
  });
}

async function frontendAsyncChecks() {
  var fetches = [];
  var page = loadFront('index.html', 'https://edwardyen307-collab.github.io/x/', function (window) {
    window.fetch = function (url, opts) {
      fetches.push({ url: String(url), opts: opts });
      return Promise.reject(new Error('network down'));
    };
  });
  page.window.FaceMePreview.setApiBase('https://proxy.intranet.example');
  var checkbox = page.document.getElementById('consent-check');
  checkbox.checked = true;
  checkbox.dispatchEvent(new page.window.Event('change', { bubbles: true }));
  var nav = [];
  page.window.FaceMePreview.navigateTo = function (url) {
    nav.push(url);
  };
  page.document.getElementById('consent-form').dispatchEvent(
    new page.window.Event('submit', { bubbles: true, cancelable: true })
  );
  await sleep(40);
  ok('real mode no mock fallback on consent fail', nav.length === 0 && !page.window.FaceMePreview.hasMockConsent());
  page.dom.window.close();
}

async function httpIntegration() {
  process.env.HOST = '127.0.0.1';
  process.env.PORT = '0';
  process.env.FACEME_STATEMENT_VERSION = 'v2026-11-06c-draft';
  process.env.FACEME_REAL_MODE = '0';
  process.env.FACEME_STATEMENT_LEGAL_CONFIRMED = '0';
  process.env.FACEME_ACCOUNT = 'test-account';
  process.env.FACEME_PASSWORD = 'test-password-not-real';
  process.env.CONSENT_TTL_SECONDS = '60';
  process.env.CONSENT_LOG_PATH = path.join(root, 'runtime', 'test-consent.jsonl');
  process.env.CORS_ORIGINS = '';
  process.env.UPSTREAM_TIMEOUT_MS = '2000';
  process.env.RATE_LIMIT_MAX = '1000';
  process.env.FACEME_SKIP_TLS_VERIFY = '0';

  var loginHits = 0;
  var importHits = 0;
  var qcHits = 0;
  var upstream = http.createServer(function (req, res) {
    var chunks = [];
    req.on('data', function (c) {
      chunks.push(c);
    });
    req.on('end', function () {
      if (req.url === '/api/website/account/signIn') {
        loginHits++;
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ token: 'fake-token-for-tests-only-not-real' }));
        return;
      }
      if (req.url === '/api/website/snapshot/qc') {
        qcHits++;
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ pass: true }));
        return;
      }
      if (req.url === '/api/website/person/import') {
        importHits++;
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ personId: 'P-FAKE-001' }));
        return;
      }
      res.writeHead(404);
      res.end();
    });
  });
  await new Promise(function (r) {
    upstream.listen(0, '127.0.0.1', r);
  });
  var upPort = upstream.address().port;
  process.env.FACEME_BASE_URL = 'http://127.0.0.1:' + upPort;

  Object.keys(require.cache).forEach(function (k) {
    if (k.indexOf(path.join(root, 'server')) !== -1) delete require.cache[k];
  });
  var { createApp, config } = require(path.join(root, 'server/index'));
  ok('appVersion c', config.appVersion === 'v2026-11-06c');
  ok('realMode stays disabled by default in this test env', config.realModeEnabled === false);

  var app = createApp();
  var server = await new Promise(function (resolve) {
    var s = app.listen(0, '127.0.0.1', function () {
      resolve(s);
    });
  });
  var port = server.address().port;
  var base = 'http://127.0.0.1:' + port;

  function req(method, urlPath, bodyObj) {
    var body = bodyObj ? JSON.stringify(bodyObj) : null;
    return new Promise(function (resolve, reject) {
      var r = http.request(
        {
          hostname: '127.0.0.1',
          port: port,
          path: urlPath,
          method: method,
          headers: body
            ? {
                'Content-Type': 'application/json',
                'Content-Length': Buffer.byteLength(body)
              }
            : {}
        },
        function (res) {
          var chunks = [];
          res.on('data', function (c) {
            chunks.push(c);
          });
          res.on('end', function () {
            var text = Buffer.concat(chunks).toString('utf8');
            var json = null;
            try {
              json = JSON.parse(text);
            } catch (_) {}
            resolve({ status: res.statusCode, json: json, text: text });
          });
        }
      );
      r.on('error', reject);
      if (body) r.write(body);
      r.end();
    });
  }

  var health = await req('GET', '/api/health');
  ok('health version c', health.status === 200 && health.json.appVersion === 'v2026-11-06c');
  ok('health not claiming central ok', !/Central 連線成功/.test(JSON.stringify(health.json)));

  var beforeLogin = loginHits;
  var beforeQc = qcHits;
  var beforeImport = importHits;
  var ct = await req('POST', '/api/connection-test', { attemptLogin: false });
  ok('connection-test without login ok tcp', ct.status === 200 && ct.json.ok === true);
  ok('connection-test distinct note', /連線測試/.test(ct.json.note || '') || /≠/.test(ct.json.note || ''));
  ok('connection-test no login when not requested', loginHits === beforeLogin);
  ok('connection-test never QC/import', qcHits === beforeQc && importHits === beforeImport);

  var ctLogin = await req('POST', '/api/connection-test', { attemptLogin: true });
  ok('connection-test login path', ctLogin.status === 200 && ctLogin.json.ok === true);
  ok('connection-test login increments signIn only', loginHits === beforeLogin + 1);
  ok('connection-test login still no QC/import', qcHits === beforeQc && importHits === beforeImport);
  ok(
    'connection-test response has no token/password fields',
    !/fake-token|test-password|FACEME_PASSWORD/i.test(ctLogin.text)
  );

  // register still blocked when real mode off
  var reg = await req('POST', '/api/register', {});
  // multipart empty may 400/503 — assert not 200 success write
  ok('register not success while real mode off', reg.status !== 200);

  // launcher helpers
  var launch = require(path.join(root, 'scripts/windows-launcher.js'));
  ok('launcher APP_VERSION matches', launch.APP_VERSION === 'v2026-11-06c');
  var probeDown = await launch.probeOurServer('127.0.0.1', 1);
  ok('probe down on closed port', probeDown.state === 'down');
  var probeOurs = await launch.probeOurServer('127.0.0.1', port);
  ok('probe detects our health', probeOurs.state === 'ours');

  // foreign port: start tiny server without our health shape
  var foreign = http.createServer(function (req, res) {
    res.end('hello');
  });
  await new Promise(function (r) {
    foreign.listen(0, '127.0.0.1', r);
  });
  var fport = foreign.address().port;
  var probeForeign = await launch.probeOurServer('127.0.0.1', fport);
  ok('probe foreign not ours', probeForeign.state === 'foreign');
  foreign.close();

  server.close();
  upstream.close();
}

(async function main() {
  try {
    adapterTests();
    await frontendAsyncChecks();
    await httpIntegration();
  } catch (e) {
    console.error(e);
    failures.push('exception:' + (e && e.message));
  }
  console.log('');
  if (failures.length) {
    console.error(failures.length + ' failed:', failures.join(', '));
    process.exit(1);
  }
  console.log('All checks passed.');
  console.log('NOTE: Windows start.bat / MOTW / notepad / icacls were NOT executed on this Linux runner.');
  process.exit(0);
})();
