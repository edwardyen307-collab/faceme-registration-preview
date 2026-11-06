#!/usr/bin/env node
'use strict';

var fs = require('fs');
var path = require('path');
var http = require('http');
var assert = require('assert');

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

// ---------- Static / frontend ----------
var indexHtml = read('index.html');
var registerHtml = read('register.html');
var css = read('styles.css');
var js = read('app.js');

ok('version v2026-11-06b in pages', /v2026-11-06b/.test(indexHtml) && /v2026-11-06b/.test(registerHtml));
ok('statement draft version in frontend', /v2026-11-06b-draft/.test(js) && /v2026-11-06b-draft/.test(indexHtml));
ok('draft tags remain', /範本／待法務確認/.test(indexHtml));
ok('api base settings UI', /api-base-input/.test(indexHtml) && /api-base-input/.test(registerHtml));
ok('mode banner present', /mode-banner/.test(indexHtml));
ok('no FaceMe Central hardcode secrets', !/FACEME_PASSWORD|192\.168\.32\.220:443/.test(js));
ok('gitignore has .env and runtime', /\.env/.test(read('.gitignore')) && /runtime\//.test(read('.gitignore')));
ok('env example exists without password value', fs.existsSync(path.join(root, '.env.example')) && !/FACEME_PASSWORD=.+/.test(read('.env.example').split('\n').find(function (l) { return l.startsWith('FACEME_PASSWORD'); }) || 'FACEME_PASSWORD='));
ok('README marks API unverified', /待內網驗證|依提供規格/.test(read('README.md')));

var JSDOM = require('jsdom').JSDOM;

function loadFront(htmlFile, beforeEval) {
  var dom = new JSDOM(read(htmlFile), {
    url: 'https://edwardyen307-collab.github.io/faceme-registration-preview/' + htmlFile,
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
  ok('mock mode by default', page.window.FaceMePreview.isRealMode() === false);
  var checkbox = page.document.getElementById('consent-check');
  var submit = page.document.getElementById('consent-submit');
  ok('consent disabled initially', submit.disabled === true);
  checkbox.checked = true;
  checkbox.dispatchEvent(new page.window.Event('change', { bubbles: true }));
  ok('consent enables when checked', submit.disabled === false);

  var nav = [];
  page.window.FaceMePreview.navigateTo = function (url) {
    nav.push(url);
  };
  page.document.getElementById('consent-form').dispatchEvent(
    new page.window.Event('submit', { bubbles: true, cancelable: true })
  );
  ok('mock consent sets session flag', page.window.FaceMePreview.hasMockConsent());
  ok('mock navigates register', nav[0] === 'register.html');

  // mixed content risk detection
  ok(
    'mixed content risk on https page + http api',
    page.window.FaceMePreview.isMixedContentRisk('http://192.168.1.1:8443') === true
  );
  page.window.FaceMePreview.setApiBase('http://192.168.1.1:8443');
  ok('setting api base clears mock consent', !page.window.FaceMePreview.hasMockConsent());
  page.dom.window.close();
})();

(function frontendRealNoFallback() {
  var fetches = [];
  var page = loadFront('index.html', function (window) {
    window.fetch = function (url, opts) {
      fetches.push({ url: url, opts: opts });
      return Promise.reject(new Error('network down'));
    };
  });
  page.window.FaceMePreview.setApiBase('https://proxy.intranet.example');
  // bypass mixed content (page is https, base https ok)
  var checkbox = page.document.getElementById('consent-check');
  checkbox.checked = true;
  checkbox.dispatchEvent(new page.window.Event('change', { bubbles: true }));
  var nav = [];
  page.window.FaceMePreview.navigateTo = function (url) {
    nav.push(url);
  };
  return page.document
    .getElementById('consent-form')
    .dispatchEvent(new page.window.Event('submit', { bubbles: true, cancelable: true }));
})();

// Wait a tick for async consent failure
setTimeout(function () {
  // continue backend tests after microtask; we'll structure as async main
}, 0);

async function sleep(ms) {
  return new Promise(function (r) {
    setTimeout(r, ms);
  });
}

async function frontendAsyncChecks() {
  var fetches = [];
  var page = loadFront('index.html', function (window) {
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
  await sleep(30);
  ok('real mode attempted /api/consent', fetches.some(function (f) { return /\/api\/consent$/.test(f.url); }));
  ok('real mode failure does not mock-navigate', nav.length === 0);
  ok('real mode failure does not set mock consent', !page.window.FaceMePreview.hasMockConsent());
  var err = page.document.getElementById('consent-error').textContent;
  ok('real mode shows error', /Mock|後端|連線/.test(err), err);
  page.dom.window.close();
}

// ---------- Adapter unit tests ----------
function adapterTests() {
  var adapters = require(path.join(root, 'server/central/adapters'));
  try {
    adapters.parseSignInToken(200, { token: 'fake-token-for-tests-only-not-real' });
    ok('signIn parses token', true);
  } catch (e) {
    ok('signIn parses token', false, e.message);
  }
  try {
    adapters.parseSignInToken(200, { hello: 1 });
    ok('signIn unknown shape fail closed', false);
  } catch (e) {
    ok('signIn unknown shape fail closed', e.code === 'LOGIN_TOKEN_MISSING' || e.code === 'LOGIN_SHAPE_UNKNOWN');
  }
  ok('QC pass true', adapters.parseQcResult(200, { pass: true }).pass === true);
  ok('QC HTTP 200 unknown fail closed', adapters.parseQcResult(200, { hello: 1 }).pass === false);
  ok('QC pass false', adapters.parseQcResult(200, { pass: false }).pass === false);
  ok('QC http error fail', adapters.parseQcResult(500, { pass: true }).pass === false);
  try {
    var id = adapters.parseImportPersonId(200, { personId: 'P-FAKE-001' });
    ok('import personId', id === 'P-FAKE-001');
  } catch (e) {
    ok('import personId', false, e.message);
  }
  try {
    adapters.parseImportPersonId(200, { ok: true });
    ok('import unknown fail closed', false);
  } catch (e) {
    ok('import unknown fail closed', true);
  }
}

// ---------- HTTP integration with mocked upstream ----------
async function httpIntegration() {
  // Isolate env before loading server modules
  process.env.HOST = '127.0.0.1';
  process.env.PORT = '0';
  process.env.FACEME_STATEMENT_VERSION = 'v2026-11-06b-draft';
  process.env.FACEME_REAL_MODE = '1';
  process.env.FACEME_STATEMENT_LEGAL_CONFIRMED = '1';
  process.env.FACEME_ACCOUNT = 'test-account';
  process.env.FACEME_PASSWORD = 'test-password-not-real';
  process.env.CONSENT_TTL_SECONDS = '2';
  process.env.CONSENT_LOG_PATH = path.join(root, 'runtime', 'test-consent.jsonl');
  process.env.CORS_ORIGINS = 'https://edwardyen307-collab.github.io';
  process.env.UPSTREAM_TIMEOUT_MS = '500';
  process.env.RATE_LIMIT_MAX = '1000';

  // Mock upstream Central
  var upstreamCalls = [];
  var qcMode = 'pass';
  var loginMode = 'ok';
  var importMode = 'ok';
  var upstream = http.createServer(function (req, res) {
    var chunks = [];
    req.on('data', function (c) {
      chunks.push(c);
    });
    req.on('end', function () {
      var buf = Buffer.concat(chunks);
      upstreamCalls.push({
        method: req.method,
        url: req.url,
        headers: req.headers,
        body: buf
      });
      if (req.url === '/api/website/account/signIn') {
        if (loginMode === 'fail') {
          res.writeHead(401, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'nope' }));
          return;
        }
        if (loginMode === 'slow') {
          setTimeout(function () {
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ token: 'fake-token-for-tests-only-not-real' }));
          }, 800);
          return;
        }
        // verify form body
        var form = buf.toString('utf8');
        ok(
          'login form-urlencoded payload once',
          /account=test-account/.test(form) && /password=test-password-not-real/.test(form)
        );
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ token: 'fake-token-for-tests-only-not-real' }));
        return;
      }
      if (req.url === '/api/website/snapshot/qc') {
        var auth = req.headers.authorization || '';
        ok('QC Authorization raw token no Bearer', auth === 'fake-token-for-tests-only-not-real');
        ok('QC is multipart', /multipart\/form-data/i.test(req.headers['content-type'] || ''));
        var payload =
          qcMode === 'pass'
            ? { pass: true }
            : qcMode === 'fail'
              ? { pass: false }
              : { weird: true };
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(payload));
        return;
      }
      if (req.url === '/api/website/person/import') {
        var auth2 = req.headers.authorization || '';
        ok('import Authorization raw token', auth2 === 'fake-token-for-tests-only-not-real');
        ok('import multipart', /multipart\/form-data/i.test(req.headers['content-type'] || ''));
        var bodyStr = buf.toString('latin1');
        ok('import has name field', /name/.test(bodyStr) && /Preview User/.test(bodyStr));
        ok('import has snapshot field', /snapshot/.test(bodyStr));
        if (importMode === 'fail') {
          res.writeHead(500, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'x' }));
          return;
        }
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ personId: 'P-FAKE-001' }));
        return;
      }
      res.writeHead(404);
      res.end('no');
    });
  });

  await new Promise(function (resolve) {
    upstream.listen(0, '127.0.0.1', resolve);
  });
  var upPort = upstream.address().port;
  process.env.FACEME_BASE_URL = 'http://127.0.0.1:' + upPort;

  // Fresh-require server with env
  Object.keys(require.cache).forEach(function (k) {
    if (k.indexOf(path.join(root, 'server')) !== -1) delete require.cache[k];
  });
  var consent = require(path.join(root, 'server/consent'));
  consent._resetForTests();
  var { createApp, config } = require(path.join(root, 'server/index'));
  ok('config realModeEnabled', config.realModeEnabled === true);
  ok('config uses mock upstream base', config.facemeBaseUrl.indexOf('127.0.0.1') !== -1);

  var app = createApp();
  var server = await new Promise(function (resolve) {
    var s = app.listen(0, '127.0.0.1', function () {
      resolve(s);
    });
  });
  var port = server.address().port;
  var base = 'http://127.0.0.1:' + port;

  function jpegBuf() {
    // minimal JPEG: SOI + EOI with APP0-ish padding for sniff
    return Buffer.from([
      0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01, 0x01, 0x00, 0x00, 0x01,
      0x00, 0x01, 0x00, 0x00, 0xff, 0xd9
    ]);
  }

  async function req(method, urlPath, opts) {
    opts = opts || {};
    var headers = Object.assign({}, opts.headers || {});
    var body = opts.body;
    return new Promise(function (resolve, reject) {
      var u = new URL(base + urlPath);
      var r = http.request(
        {
          hostname: u.hostname,
          port: u.port,
          path: u.pathname,
          method: method,
          headers: headers
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
            resolve({ status: res.statusCode, headers: res.headers, text: text, json: json });
          });
        }
      );
      r.on('error', reject);
      if (body) r.write(body);
      r.end();
    });
  }

  // health
  var health = await req('GET', '/api/health');
  ok('health 200', health.status === 200 && health.json.realModeEnabled === true);

  // consent mismatches / missing
  var c1 = await req('POST', '/api/consent', {
    headers: { 'Content-Type': 'application/json', 'Content-Length': 2 },
    body: '{}'
  });
  ok('consent requires agreed true', c1.status === 400);

  var c2body = JSON.stringify({ agreed: true, statementVersion: 'wrong-version' });
  var c2 = await req('POST', '/api/consent', {
    headers: {
      'Content-Type': 'application/json',
      'Content-Length': Buffer.byteLength(c2body)
    },
    body: c2body
  });
  ok('consent statement mismatch', c2.status === 400 && c2.json.code === 'STATEMENT_MISMATCH');

  async function postJson(p, obj, extraHeaders) {
    var body = JSON.stringify(obj);
    return req('POST', p, {
      headers: Object.assign(
        {
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(body)
        },
        extraHeaders || {}
      ),
      body: body
    });
  }

  var issued = await postJson('/api/consent', {
    agreed: true,
    statementVersion: 'v2026-11-06b-draft'
  });
  ok('consent issues ticket', issued.status === 200 && issued.json.ticket && issued.json.expiresAt);

  // register without ticket
  var noTicket = await multipartRegister(base, port, {
    name: 'Preview User',
    ticket: '',
    image: jpegBuf()
  });
  ok('register no consent blocked', noTicket.status === 403);

  // success path
  upstreamCalls.length = 0;
  qcMode = 'pass';
  loginMode = 'ok';
  var okReg = await multipartRegister(base, port, {
    name: 'Preview User',
    ticket: issued.json.ticket,
    image: jpegBuf(),
    employeeId: 'E001'
  });
  ok('register success personId', okReg.status === 200 && okReg.json.personId === 'P-FAKE-001');
  ok(
    'upstream called login+qc+import',
    upstreamCalls.filter(function (c) { return c.url === '/api/website/account/signIn'; }).length >= 1 &&
      upstreamCalls.filter(function (c) { return c.url === '/api/website/snapshot/qc'; }).length >= 1 &&
      upstreamCalls.filter(function (c) { return c.url === '/api/website/person/import'; }).length >= 1
  );

  // replay
  var replay = await multipartRegister(base, port, {
    name: 'Preview User',
    ticket: issued.json.ticket,
    image: jpegBuf()
  });
  ok('replay blocked', replay.status === 403 && replay.json.code === 'CONSENT_REPLAY');

  // QC fail never import
  var issued2 = await postJson('/api/consent', {
    agreed: true,
    statementVersion: 'v2026-11-06b-draft'
  });
  qcMode = 'fail';
  var beforeImport = upstreamCalls.filter(function (c) {
    return c.url === '/api/website/person/import';
  }).length;
  var qcFail = await multipartRegister(base, port, {
    name: 'Preview User',
    ticket: issued2.json.ticket,
    image: jpegBuf()
  });
  var afterImport = upstreamCalls.filter(function (c) {
    return c.url === '/api/website/person/import';
  }).length;
  ok('QC fail status', qcFail.status === 422);
  ok('QC fail never import', afterImport === beforeImport);

  // QC unknown shape fail closed, no import
  var issued3 = await postJson('/api/consent', {
    agreed: true,
    statementVersion: 'v2026-11-06b-draft'
  });
  qcMode = 'unknown';
  beforeImport = upstreamCalls.filter(function (c) {
    return c.url === '/api/website/person/import';
  }).length;
  var qcUnknown = await multipartRegister(base, port, {
    name: 'Preview User',
    ticket: issued3.json.ticket,
    image: jpegBuf()
  });
  afterImport = upstreamCalls.filter(function (c) {
    return c.url === '/api/website/person/import';
  }).length;
  ok('QC unknown fail closed', qcUnknown.status === 422 && qcUnknown.json.code === 'QC_SHAPE_UNKNOWN');
  ok('QC unknown never import', afterImport === beforeImport);

  // login fail
  var issued4 = await postJson('/api/consent', {
    agreed: true,
    statementVersion: 'v2026-11-06b-draft'
  });
  qcMode = 'pass';
  loginMode = 'fail';
  var loginFail = await multipartRegister(base, port, {
    name: 'Preview User',
    ticket: issued4.json.ticket,
    image: jpegBuf()
  });
  ok('login fail mapped', loginFail.status === 502 && loginFail.json.code === 'LOGIN_FAILED');
  loginMode = 'ok';

  // expired ticket
  var issued5 = await postJson('/api/consent', {
    agreed: true,
    statementVersion: 'v2026-11-06b-draft'
  });
  await sleep(2100);
  var expired = await multipartRegister(base, port, {
    name: 'Preview User',
    ticket: issued5.json.ticket,
    image: jpegBuf()
  });
  ok('expired ticket blocked', expired.status === 403 && expired.json.code === 'CONSENT_EXPIRED');

  // bad image type
  var issued6 = await postJson('/api/consent', {
    agreed: true,
    statementVersion: 'v2026-11-06b-draft'
  });
  var badImg = await multipartRegister(base, port, {
    name: 'Preview User',
    ticket: issued6.json.ticket,
    image: Buffer.from('not-an-image'),
    filename: 'x.txt',
    contentType: 'text/plain'
  });
  ok('bad image rejected', badImg.status === 400);

  // CORS allowlisted origin
  var corsOk = await postJson(
    '/api/consent',
    { agreed: true, statementVersion: 'v2026-11-06b-draft' },
    { Origin: 'https://edwardyen307-collab.github.io' }
  );
  ok(
    'CORS allowlist reflects origin',
    corsOk.headers['access-control-allow-origin'] ===
      'https://edwardyen307-collab.github.io'
  );

  // CORS denied
  var corsBad = await postJson(
    '/api/consent',
    { agreed: true, statementVersion: 'v2026-11-06b-draft' },
    { Origin: 'https://evil.example' }
  );
  ok('CORS deny other origin', corsBad.status === 403 && corsBad.json.code === 'CORS_DENIED');

  // real mode disabled path
  process.env.FACEME_REAL_MODE = '0';
  Object.keys(require.cache).forEach(function (k) {
    if (k.indexOf(path.join(root, 'server')) !== -1) delete require.cache[k];
  });
  // Can't easily swap config mid-process without reload — test assertRealModeReady unit-style
  var cfgMod = require(path.join(root, 'server/config'));
  // config already loaded with REAL_MODE=1 from earlier; call assert with mutated export
  cfgMod.config.realModeFlag = false;
  cfgMod.config.realModeEnabled = false;
  try {
    cfgMod.assertRealModeReady();
    ok('assertRealModeReady blocks when disabled', false);
  } catch (e) {
    ok('assertRealModeReady blocks when disabled', e.code === 'REAL_MODE_DISABLED');
  }
  cfgMod.config.realModeFlag = true;
  cfgMod.config.legalConfirmed = false;
  cfgMod.config.realModeEnabled = false;
  try {
    cfgMod.assertRealModeReady();
    ok('assertRealModeReady blocks unconfirmed statement', false);
  } catch (e) {
    ok('assertRealModeReady blocks unconfirmed statement', e.code === 'STATEMENT_NOT_CONFIRMED');
  }

  server.close();
  upstream.close();
}

function multipartRegister(base, port, opts) {
  var boundary = '----testboundary7MA4YWxk';
  var parts = [];
  function addField(name, value) {
    parts.push(
      '--' +
        boundary +
        '\r\nContent-Disposition: form-data; name="' +
        name +
        '"\r\n\r\n' +
        value +
        '\r\n'
    );
  }
  addField('name', opts.name);
  if (opts.employeeId) addField('employeeId', opts.employeeId);
  addField('consentTicket', opts.ticket || '');
  var filename = opts.filename || 'face.jpg';
  var ct = opts.contentType || 'image/jpeg';
  var header =
    '--' +
    boundary +
    '\r\nContent-Disposition: form-data; name="image"; filename="' +
    filename +
    '"\r\nContent-Type: ' +
    ct +
    '\r\n\r\n';
  var end = '\r\n--' + boundary + '--\r\n';
  var body = Buffer.concat([
    Buffer.from(parts.join(''), 'utf8'),
    Buffer.from(header, 'utf8'),
    opts.image,
    Buffer.from(end, 'utf8')
  ]);
  return new Promise(function (resolve, reject) {
    var r = http.request(
      {
        hostname: '127.0.0.1',
        port: port,
        path: '/api/register',
        method: 'POST',
        headers: {
          'Content-Type': 'multipart/form-data; boundary=' + boundary,
          'Content-Length': body.length
        }
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
    r.write(body);
    r.end();
  });
}

(async function main() {
  try {
    adapterTests();
    await frontendAsyncChecks();
    await httpIntegration();
  } catch (e) {
    console.error(e);
    failures.push('exception:' + e.message);
  }
  console.log('');
  if (failures.length) {
    console.error(failures.length + ' failed:', failures.join(', '));
    process.exit(1);
  }
  console.log('All checks passed.');
  process.exit(0);
})();
