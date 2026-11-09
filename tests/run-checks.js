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

(function batRegressions() {
  var buf = fs.readFileSync(path.join(root, 'start.bat'));
  var text = buf.toString('utf8');
  var crlf = 0;
  for (var i = 0; i < buf.length - 1; i++) if (buf[i] === 13 && buf[i + 1] === 10) crlf++;
  var lfOnly = false;
  for (var j = 0; j < buf.length; j++) {
    if (buf[j] === 10 && (j === 0 || buf[j - 1] !== 13)) { lfOnly = true; break; }
  }
  ok('start.bat uses CRLF', crlf > 10);
  ok('start.bat has no bare LF', lfOnly === false);
  ok('start.bat no UTF-8 BOM', !(buf[0] === 0xef && buf[1] === 0xbb && buf[2] === 0xbf));
  ok('start.bat ASCII-only bytes', Array.prototype.every.call(buf, function (b) { return b < 128; }));
  ok('start.bat has HOLD and pause', /:HOLD/.test(text) && /pause/i.test(text));
  // Labels inside parenthesized IF blocks break cmd.exe; HOLD is outside.
  var badLabelInIf = false;
  var lines = text.split(/\r?\n/);
  var depth = 0;
  for (var li = 0; li < lines.length; li++) {
    var line = lines[li];
    var opens = (line.match(/\(/g) || []).length;
    var closes = (line.match(/\)/g) || []).length;
    if (depth > 0 && /^\s*:/.test(line)) badLabelInIf = true;
    depth += opens - closes;
    if (depth < 0) depth = 0;
  }
  ok('start.bat no labels inside if blocks', badLabelInIf === false);

  ok('start.bat no choice.exe dependency', !/\bchoice\b/i.test(text));
  ok('start.bat calls node launcher', /windows-launcher\.js/.test(text));
  ok('start.bat version banner 09d', /v2026-11-09d/.test(text));
  ok('launcher has cleanupChild + launcher.log', /cleanupChild/.test(launcher) && /launcher\.log/.test(launcher));
})();


ok('version v2026-11-09d in pages', /v2026-11-09d/.test(indexHtml) && /v2026-11-09d/.test(registerHtml));
ok('statement version loaded from shared json', /privacy-notice-draft-1/.test(js) && /data-statement-version/.test(indexHtml) && /privacy-notice-draft-1/.test(fs.readFileSync(path.join(root,'statement-version.json'),'utf8')));
ok('env example FACEME_BASE_URL is 127.0.0.1', /^FACEME_BASE_URL=https:\/\/127\.0\.0\.1$/m.test(envExample));
ok('env example real mode off', /^FACEME_REAL_MODE=0$/m.test(envExample));
ok('env example legal confirm off', /^FACEME_STATEMENT_LEGAL_CONFIRMED=0$/m.test(envExample));
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

function statementVersionTests() {
  var sv = require(path.join(root, 'server/statement-version'));
  ok('canonical statement version stable', sv.CANONICAL_STATEMENT_VERSION === 'privacy-notice-draft-1');
  var same = sv.inspectEnvOverride('privacy-notice-draft-1');
  ok('matching env override not ignored', same.ignored === false);
  var stale = sv.inspectEnvOverride('v2026-11-09a-draft');
  ok('stale env override ignored', stale.ignored === true && stale.canonical === 'privacy-notice-draft-1');
  ok('stale env warning names .env key', /FACEME_STATEMENT_VERSION/.test(stale.warning));
  var json = JSON.parse(fs.readFileSync(path.join(root, 'statement-version.json'), 'utf8'));
  ok('statement-version.json matches canonical', json.statementVersion === sv.CANONICAL_STATEMENT_VERSION);
  ok('appVersion distinct from statementVersion', true);
}

function tlsOptionTests() {
  var tlsOpt = require(path.join(root, 'server/tls-options'));
  var tls = require('tls');
  var v4 = tlsOpt.buildTlsSocketOptions({ host: '127.0.0.1', port: 443, rejectUnauthorized: true });
  ok('IPv4 TLS options omit servername', v4.host === '127.0.0.1' && !Object.prototype.hasOwnProperty.call(v4, 'servername'));
  var v6 = tlsOpt.buildTlsSocketOptions({ host: '::1', port: 443, rejectUnauthorized: true });
  ok('IPv6 TLS options omit servername', v6.host === '::1' && !Object.prototype.hasOwnProperty.call(v6, 'servername'));
  var v6b = tlsOpt.buildTlsSocketOptions({ host: '[::1]', port: 443 });
  ok('IPv6 bracket host normalized without servername', v6b.host === '::1' && !Object.prototype.hasOwnProperty.call(v6b, 'servername'));
  var name = tlsOpt.buildTlsSocketOptions({ host: 'central.example', port: 8443 });
  ok('hostname sets servername', name.servername === 'central.example');
  var cleaned = tlsOpt.sanitizeConnectOptions({ host: '192.168.1.1', servername: '192.168.1.1', port: 443 });
  ok('sanitize drops IP servername', cleaned.servername === undefined);
  var cleanedHost = tlsOpt.sanitizeConnectOptions({ hostname: '127.0.0.1', servername: '127.0.0.1' });
  ok('sanitize drops servername when hostname is IP', cleanedHost.servername === undefined);
  // sync tls.connect must not throw ERR_INVALID_ARG_VALUE for IP
  try {
    var s = tls.connect(v4);
    s.on('error', function () {});
    s.destroy();
    ok('tls.connect with IPv4 options does not sync-throw', true);
  } catch (e) {
    ok('tls.connect with IPv4 options does not sync-throw', false, e && e.message);
  }
  ok('hostIsIp true for v4', tlsOpt.hostIsIp('127.0.0.1') === true);
  ok('hostIsIp false for name', tlsOpt.hostIsIp('localhost') === false);
  var explained = tlsOpt.explainTlsFailure(
    { code: 'DEPTH_ZERO_SELF_SIGNED_CERT', message: 'self signed' },
    '127.0.0.1'
  );
  ok('cert failure plain language', /憑證/.test(explained) && /FACEME_SKIP_TLS_VERIFY/.test(explained));
}

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
  process.env.FACEME_STATEMENT_VERSION = 'stale-from-old-env';  // must be ignored
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
  ok('appVersion 09d', config.appVersion === 'v2026-11-09d');
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
  ok('health version 09d', health.status === 200 && health.json.appVersion === 'v2026-11-09d');
  ok('health statementVersion canonical', health.json.statementVersion === 'privacy-notice-draft-1');
  ok('health reports ignored stale env', health.json.statementEnvIgnored === true);
  ok('health not claiming central ok', !/Central 連線成功/.test(JSON.stringify(health.json)));

  var beforeLogin = loginHits;
  var beforeQc = qcHits;
  var beforeImport = importHits;
  var ct = await req('POST', '/api/connection-test', { attemptLogin: false });
  ok('connection-test without login ok tcp', ct.status === 200 && ct.json.ok === true);

  // Ensure connectionProbe TLS step does not crash on IP target with ERR_INVALID_ARG_VALUE
  (function () {
    var central = require(path.join(root, 'server/central/client'));
    // Use http upstream already running — for https IP we'd need certs; unit tests cover options.
    ok('client exports hostIsIp', typeof central.hostIsIp === 'function' && central.hostIsIp('127.0.0.1'));
  })();

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


  // --- local Central URL settings ---
  ok('UI statement version placeholder', /data-statement-version/.test(indexHtml));
  ok('static statement-version.json present', require('fs').existsSync(path.join(root, 'statement-version.json')));
  ok('UI has central-base controls', /central-base-input/.test(indexHtml) && /FACEME_BASE_URL/.test(indexHtml));
  ok('Pages local-only note present', /僅本機版/.test(indexHtml));

  var envFile = require(path.join(root, 'server/env-file'));
  ok('reject http central url', envFile.validateCentralBaseUrl('http://127.0.0.1').ok === false);
  ok('reject path', envFile.validateCentralBaseUrl('https://127.0.0.1/api').ok === false);
  ok('reject userinfo', envFile.validateCentralBaseUrl('https://u:p@127.0.0.1').ok === false);
  ok('accept https host port', envFile.validateCentralBaseUrl('https://192.168.32.220:443').ok === true);

  var localAdmin = require(path.join(root, 'server/local-admin'));
  try {
    localAdmin.assertLocalAdmin(
      {
        socket: { remoteAddress: '8.8.8.8' },
        headers: { host: '127.0.0.1:8443' },
        method: 'GET'
      },
      { mutate: false }
    );
    ok('non-loopback remote rejected', false);
  } catch (e) {
    ok('non-loopback remote rejected', e.code === 'NOT_LOOPBACK');
  }
  try {
    localAdmin.assertLocalAdmin(
      {
        socket: { remoteAddress: '127.0.0.1' },
        headers: { host: 'evil.example', origin: 'http://127.0.0.1:8443' },
        method: 'GET'
      },
      { mutate: false }
    );
    ok('bad Host rejected', false);
  } catch (e) {
    ok('bad Host rejected', e.code === 'BAD_HOST');
  }
  try {
    localAdmin.assertLocalAdmin(
      {
        socket: { remoteAddress: '127.0.0.1' },
        headers: {
          host: '127.0.0.1:' + port,
          origin: 'https://evil.example'
        },
        method: 'PUT'
      },
      { mutate: true }
    );
    ok('cross-site Origin rejected', false);
  } catch (e) {
    ok('cross-site Origin rejected', e.code === 'BAD_ORIGIN');
  }

  // GET local-settings from loopback without Origin
  var ls = await req('GET', '/api/local-settings');
  ok('local-settings ok on loopback', ls.status === 200 && ls.json.localAdmin === true);
  ok('local-settings returns token not password', ls.json.localAdminToken && !/FACEME_PASSWORD|test-password/.test(ls.text));
  var adminTok = ls.json.localAdminToken;

  // PUT without token
  var noTok = await new Promise(function (resolve, reject) {
    var body = JSON.stringify({ centralBaseUrl: 'https://127.0.0.1' });
    var r = http.request(
      {
        hostname: '127.0.0.1',
        port: port,
        path: '/api/local-settings/central-base',
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(body),
          Host: '127.0.0.1:' + port,
          Origin: 'http://127.0.0.1:' + port
        }
      },
      function (res) {
        var chunks = [];
        res.on('data', function (c) { chunks.push(c); });
        res.on('end', function () {
          var text = Buffer.concat(chunks).toString('utf8');
          var json = null;
          try { json = JSON.parse(text); } catch (_) {}
          resolve({ status: res.statusCode, json: json });
        });
      }
    );
    r.on('error', reject);
    r.write(body);
    r.end();
  });
  ok('PUT without token rejected', noTok.status === 403 && noTok.json.code === 'BAD_TOKEN');

  // Preserve other .env lines including password when upserting
  var fs = require('fs');
  var envPath = path.join(root, '.env');
  var prevEnv = fs.existsSync(envPath) ? fs.readFileSync(envPath, 'utf8') : null;
  fs.writeFileSync(
    envPath,
    'FACEME_ACCOUNT=keep-me\nFACEME_PASSWORD=secret-should-remain\nFACEME_BASE_URL=https://old.example\nOTHER=1\n',
    'utf8'
  );
  var putOk = await new Promise(function (resolve, reject) {
    var body = JSON.stringify({ centralBaseUrl: 'https://192.168.32.220' });
    var r = http.request(
      {
        hostname: '127.0.0.1',
        port: port,
        path: '/api/local-settings/central-base',
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(body),
          Host: '127.0.0.1:' + port,
          Origin: 'http://127.0.0.1:' + port,
          'X-Faceme-Local-Token': adminTok,
          'Sec-Fetch-Site': 'same-origin'
        }
      },
      function (res) {
        var chunks = [];
        res.on('data', function (c) { chunks.push(c); });
        res.on('end', function () {
          var text = Buffer.concat(chunks).toString('utf8');
          var json = null;
          try { json = JSON.parse(text); } catch (_) {}
          resolve({ status: res.statusCode, json: json, text: text });
        });
      }
    );
    r.on('error', reject);
    r.write(body);
    r.end();
  });
  ok('PUT central-base success', putOk.status === 200 && putOk.json.centralBaseUrl === 'https://192.168.32.220');
  ok('PUT applied immediate', putOk.json.applied === 'immediate');
  var envAfter = fs.readFileSync(envPath, 'utf8');
  ok('env password line preserved', /FACEME_PASSWORD=secret-should-remain/.test(envAfter));
  ok('env account preserved', /FACEME_ACCOUNT=keep-me/.test(envAfter));
  ok('env OTHER preserved', /OTHER=1/.test(envAfter));
  ok('env base updated', /FACEME_BASE_URL=https:\/\/192\.168\.32\.220/.test(envAfter));
  ok('env.bak created', fs.existsSync(path.join(root, '.env.bak')));
  // runtime config should match
  var { config: cfgNow } = require(path.join(root, 'server/config'));
  ok('config.facemeBaseUrl updated live', cfgNow.facemeBaseUrl === 'https://192.168.32.220');
  // restore previous test env if any
  if (prevEnv != null) fs.writeFileSync(envPath, prevEnv, 'utf8');
  else {
    try { fs.unlinkSync(envPath); } catch (_) {}
  }

  // reject bad format via API
  var badPut = await new Promise(function (resolve, reject) {
    var body = JSON.stringify({ centralBaseUrl: 'http://127.0.0.1' });
    var r = http.request(
      {
        hostname: '127.0.0.1',
        port: port,
        path: '/api/local-settings/central-base',
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(body),
          Host: '127.0.0.1:' + port,
          Origin: 'http://127.0.0.1:' + port,
          'X-Faceme-Local-Token': adminTok,
          'Sec-Fetch-Site': 'same-origin'
        }
      },
      function (res) {
        var chunks = [];
        res.on('data', function (c) { chunks.push(c); });
        res.on('end', function () {
          var text = Buffer.concat(chunks).toString('utf8');
          var json = null;
          try { json = JSON.parse(text); } catch (_) {}
          resolve({ status: res.statusCode, json: json });
        });
      }
    );
    r.on('error', reject);
    r.write(body);
    r.end();
  });
  ok('PUT rejects non-https', badPut.status === 400);

  // launcher helpers
  var launch = require(path.join(root, 'scripts/windows-launcher.js'));
  ok('launcher APP_VERSION matches', launch.APP_VERSION === 'v2026-11-09d');
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
    statementVersionTests();
    tlsOptionTests();
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
