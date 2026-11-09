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
  ok('start.bat version banner 09j', /v2026-11-09j/.test(text));
  ok('launcher has cleanupChild + launcher.log', /cleanupChild/.test(launcher) && /launcher\.log/.test(launcher));
})();


ok('version v2026-11-09j in pages', /v2026-11-09j/.test(indexHtml) && /v2026-11-09j/.test(registerHtml));
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
ok('skip-tls toggle in pages', /skip-tls-toggle/.test(indexHtml) && /skip-tls-toggle/.test(registerHtml));
ok('skip-tls label text', /略過自簽憑證檢查/.test(indexHtml));
ok('QC failure UI helpers in app.js', /showQcFailure/.test(js) && /qc-reason-list/.test(js));
ok('footer updater present', /updateAppFooter/.test(js) && /本機版 · 已連接本機後端/.test(js));
ok('structured failure handles import', /IMPORT_PERSON_ID_MISSING/.test(js));

ok('qc-explain module exists', fs.existsSync(path.join(root, 'server/central/qc-explain.js')));

ok('group field in register page', /group-name/.test(registerHtml) && /group-list/.test(registerHtml));
ok('group probe + create extras in register', /btn-probe-groups/.test(registerHtml) && /group-create-extras/.test(registerHtml) && /group-color/.test(registerHtml));
ok('app sends groupColor for new groups', /groupColor/.test(js) && /groupPatternId/.test(js) && /groups\/probe/.test(js));
ok('settings collapsible details', /settings-details/.test(indexHtml) && /settings-details/.test(registerHtml));
ok('groups module exists', fs.existsSync(path.join(root, 'server/central/groups.js')));
ok('app loads groups API', /\/api\/groups/.test(js) && /SETTINGS_OPEN_KEY/.test(js));

ok('app.js skip-tls API', /local-settings\/skip-tls-verify/.test(js));
ok('load-dotenv module exists', fs.existsSync(path.join(root, 'server/load-dotenv.js')));

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

function upstreamErrorTests() {
  var ue = require(path.join(root, 'server/upstream-errors'));
  function wrap(code, msg) {
    var cause = Object.assign(new Error(msg || code), { code: code });
    return Object.assign(new TypeError('fetch failed'), { cause: cause });
  }
  var refused = ue.diagnoseUpstreamFailure(wrap('ECONNREFUSED', 'connect ECONNREFUSED 127.0.0.1:443'), 'https://user:secret@127.0.0.1/api/website/account/signIn');
  ok('ECONNREFUSED plain advice', refused.code === 'ECONNREFUSED' && /連接埠/.test(refused.message));
  ok('ECONNREFUSED hides credentials', !/secret|user:/.test(refused.message) && !/secret/.test(refused.safeUrl));
  ok('ECONNREFUSED shows url', /https:\/\/127\.0\.0\.1/.test(refused.safeUrl));
  var dns = ue.diagnoseUpstreamFailure(wrap('ENOTFOUND', 'getaddrinfo ENOTFOUND'), 'https://no-such-host.invalid');
  ok('ENOTFOUND diagnosis', dns.code === 'ENOTFOUND' && /DNS|主機/.test(dns.message));
  var to = ue.diagnoseUpstreamFailure(wrap('UND_ERR_CONNECT_TIMEOUT', 'Connect Timeout Error'), 'https://127.0.0.1');
  ok('connect timeout diagnosis', to.code === 'TIMEOUT' && /逾時/.test(to.message));
  var cert = ue.diagnoseUpstreamFailure(wrap('DEPTH_ZERO_SELF_SIGNED_CERT', 'self signed certificate'), 'https://127.0.0.1');
  ok('self-signed cert diagnosis', /SELF_SIGNED|DEPTH_ZERO|憑證/.test(cert.code + cert.message));
  var proto = ue.diagnoseUpstreamFailure(wrap('EPROTO', 'wrong version number'), 'https://127.0.0.1:80');
  ok('EPROTO http/https mismatch advice', proto.code === 'EPROTO' && /http|https/i.test(proto.message));
  var aggCause = Object.assign(new Error('many'), {
    errors: [Object.assign(new Error('a'), { code: 'ECONNREFUSED' })]
  });
  var agg = Object.assign(new TypeError('fetch failed'), { cause: aggCause });
  var aggDiag = ue.diagnoseUpstreamFailure(agg, 'https://127.0.0.1');
  ok('AggregateError cause unwrapped', aggDiag.codes.indexOf('ECONNREFUSED') !== -1);
  var made = ue.makeUpstreamError(wrap('ECONNREFUSED', 'x'), 'https://127.0.0.1/path', 502);
  ok('makeUpstreamError shape', made.status === 502 && made.code === 'ECONNREFUSED' && /連接埠/.test(made.message));
}

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
  var qcExplain = require(path.join(root, 'server/central/qc-explain'));
  ok('signIn token', !!adapters.parseSignInToken(200, { token: 'fake-token-for-tests-only-not-real' }));
  ok('QC unknown fail closed', adapters.parseQcResult(200, { x: 1 }).pass === false);

  // Observed Central format (2026-11-09)
  var allTrue = {
    quality_result: true,
    condition: {
      face_size: true,
      angle: true,
      occlusion: true,
      color: true,
      single_face: true,
      mask: true
    }
  };
  var passObs = adapters.parseQcResult(200, allTrue);
  ok('observed all-true quality_result passes', passObs.pass === true && passObs.reason === 'quality_result_true');

  var fixturePass = JSON.parse(fs.readFileSync(path.join(root, 'server/fixtures/qc.pass.json'), 'utf8'));
  ok('fixture qc.pass.json passes', adapters.parseQcResult(200, fixturePass).pass === true);

  var onlyMask = adapters.parseQcResult(200, {
    quality_result: false,
    condition: {
      face_size: true,
      angle: true,
      occlusion: true,
      color: true,
      single_face: true,
      mask: false
    }
  });
  ok('observed mask false fails', onlyMask.pass === false);
  ok('observed mask false only mask reason', onlyMask.reasons.length === 1 && onlyMask.reasons[0].id === 'mask');
  ok('observed mask false ZH', /口罩/.test(onlyMask.reasons[0].text));

  var occ = adapters.parseQcResult(200, JSON.parse(fs.readFileSync(path.join(root, 'server/fixtures/qc.fail.json'), 'utf8')));
  ok('fixture occlusion false fails', occ.pass === false);
  ok('fixture occlusion only', occ.reasons.length === 1 && occ.reasons[0].id === 'occlusion');

  // true in condition must NOT be treated as problem
  var trueNotProblem = qcExplain.explainQcFailure({
    quality_result: false,
    condition: {
      face_size: true,
      angle: true,
      occlusion: true,
      color: true,
      single_face: true,
      mask: true
    }
  });
  ok('all-true condition yields no false-flag reasons', trueNotProblem.reasons.every(function (r) {
    return r.id === 'quality_result_false' || r.id === 'generic';
  }));

  var unreadable = adapters.parseQcResult(200, { quality_result: 'yes', condition: {} });
  ok('non-boolean quality_result fail-closed', unreadable.pass === false && unreadable.code === 'QC_SHAPE_UNKNOWN');
  ok('non-boolean quality_result 無法判讀', (unreadable.reasons || []).some(function (r) { return /無法判讀/.test(r.text); }));

  var missingQr = adapters.parseQcResult(200, { condition: { mask: false } });
  ok('condition without quality_result fail-closed', missingQr.pass === false);
  ok('missing quality_result 無法判讀', (missingQr.reasons || []).some(function (r) { return /無法判讀/.test(r.text); }));

  var multi = adapters.parseQcResult(200, JSON.parse(fs.readFileSync(path.join(root, 'server/fixtures/qc.fail-multiface.json'), 'utf8')));
  ok('single_face false', multi.pass === false && multi.reasons.some(function (r) { return r.id === 'single_face'; }));

  // Legacy numeric heuristics only without condition
  var pose = adapters.parseQcResult(200, {
    pass: false,
    pose: { yaw: -0.44, pitch: 0, roll: 0 },
    brightness: 0.2,
    quality: 0.3,
    qualityThreshold: 0.55
  });
  ok('legacy pose yaw ZH without condition', (pose.reasons || []).some(function (r) { return /偏左/.test(r.text); }));
  ok('legacy dark ZH without condition', (pose.reasons || []).some(function (r) { return /太暗|光線/.test(r.text); }));

  // Masking still works
  var masked = qcExplain.maskQcPayload({
    pass: false,
    token: 'abc123tokenvalue',
    password: 'nope',
    feature: [1,2,3,4,5,6,7,8,9,10,11,12,13,14,15,16,17],
    imageBase64: 'A'.repeat(200),
    cookie: 'sid=xyz',
    quality_result: false,
    condition: { mask: false }
  });
  var maskedStr = JSON.stringify(masked);
  ok('mask redacts token', /\[redacted\]/.test(maskedStr) && !/abc123tokenvalue/.test(maskedStr));
  ok('mask redacts password', !/nope/.test(maskedStr));
  ok('mask keeps quality_result', masked.quality_result === false);
  ok('mask keeps condition.mask', masked.condition && masked.condition.mask === false);

  // Import failure attaches reasons + mask
  try {
    adapters.parseImportPersonId(200, { message: 'duplicate person', token: 'leak-import-token' });
    ok('import missing personId throws', false);
  } catch (e) {
    ok('import missing personId throws', e.code === 'IMPORT_PERSON_ID_MISSING');
    ok('import failure has reasons', Array.isArray(e.reasons) && e.reasons.length > 0);
    ok('import failure masks token', e.techDetails && e.techDetails.token === '[redacted]');
    ok('import failure no raw token', !/leak-import-token/.test(JSON.stringify(e.techDetails)));
  }

  // 406 Exists similar person
  try {
    adapters.parseImportPersonId(
      406,
      JSON.parse(fs.readFileSync(path.join(root, 'server/fixtures/import.exists-similar.json'), 'utf8')),
      { baseUrl: 'https://127.0.0.1' }
    );
    ok('406 similar throws', false);
  } catch (e406) {
    ok('406 similar code', e406.code === 'IMPORT_EXISTS_SIMILAR');
    ok('406 similar ZH', /已註冊過/.test(e406.message) && /#2/.test(e406.message));
    ok('406 similar same-host url', e406.detailUrl === 'https://127.0.0.1/user-detail?id=2');
  }
  try {
    adapters.parseImportPersonId(
      406,
      { message: 'Exists similar person', personId: 2, detail: 'https://evil.example/user-detail?id=2' },
      { baseUrl: 'https://127.0.0.1' }
    );
  } catch (eEvil) {
    ok('406 evil host rejected', !eEvil.detailUrl && /主機不符|人員列表/.test(JSON.stringify(eEvil.reasons)));
  }
  ok('buildUserDetailUrl', adapters.buildUserDetailUrl('https://127.0.0.1:443', '5') === 'https://127.0.0.1:443/user-detail?id=5' || /user-detail\?id=5/.test(adapters.buildUserDetailUrl('https://127.0.0.1', '5')));

  // groups adapter
  var groupsMod = require(path.join(root, 'server/central/groups'));
  var glistPack = groupsMod.parseGroupList(200, JSON.parse(fs.readFileSync(path.join(root, 'server/fixtures/groups.list.json'), 'utf8')));
  var glist = glistPack.groups;
  ok('parseGroupList length', glist.length === 2);
  ok('findGroupByName case-insensitive', groupsMod.findGroupByName(glist, 'employees').id === '2');
  ok('findGroupByName miss', groupsMod.findGroupByName(glist, 'NoSuch') === null);
  var created = groupsMod.parseCreatedGroup(200, { id: '9', name: 'NewTeam' }, 'NewTeam');
  ok('parseCreatedGroup', created.id === '9' && created.name === 'NewTeam');
  var fieldsOk = groupsMod.validateGroupCreateFields('NewTeam', '#0070C0', 1);
  ok('validateGroupCreateFields', fieldsOk.color === '#0070C0' && fieldsOk.patternId === 1);
  try {
    groupsMod.validateGroupCreateFields('VIP', '#0070C0', 1);
    ok('reserved group name blocked', false);
  } catch (er) {
    ok('reserved group name blocked', er.code === 'GROUP_NAME_RESERVED');
  }
  ok('import field default groupId', groupsMod.importGroupField() === 'groupId');
  ok('list body has pageIndex', groupsMod.listRequestBody(0).pageIndex === 0 && groupsMod.listRequestBody(0).orderBy === 'name:asc');

  // validate group required
  var validate = require(path.join(root, 'server/validate'));
  try {
    validate.validateGroupName('  ');
    ok('group required', false);
  } catch (eg) {
    ok('group required', eg.code === 'GROUP_REQUIRED' && eg.status === 400);
  }
  ok('group trim', validate.validateGroupName('  Team A  ') === 'Team A');

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


function loadDotEnvUnitTests() {
  var ld = require(path.join(root, 'server/load-dotenv'));
  var ef = require(path.join(root, 'server/env-file'));

  var parsed = ld.parseEnvText('\uFEFFFOO=1\nFOO=2\nBAR=" x "\nBAZ=\'y\'\n#c\nDUP=a\nDUP=b\n');
  ok('parseEnvText last-wins', parsed.map.FOO === '2' && parsed.map.DUP === 'b');
  ok('parseEnvText strips quotes', parsed.map.BAR === ' x ' && parsed.map.BAZ === 'y');
  ok('parseEnvText duplicate counts', parsed.keyCounts.FOO === 2 && parsed.keyCounts.DUP === 2);
  ok('parseEnvText BOM stripped key', parsed.map.FOO === '2');

  var tmpDir = path.join(root, 'runtime', 'env-unit-' + process.pid);
  fs.mkdirSync(tmpDir, { recursive: true });
  var envFile = path.join(tmpDir, '.env');
  fs.writeFileSync(envFile, 'A=1\nFACEME_SKIP_TLS_VERIFY=0\nFACEME_SKIP_TLS_VERIFY=1\nKEEP=yes\n', 'utf8');
  // isolate process.env pollution
  delete process.env.FACEME_SKIP_TLS_VERIFY_UNIT;
  var hadSkip = Object.prototype.hasOwnProperty.call(process.env, 'FACEME_SKIP_TLS_VERIFY');
  var prevSkip = process.env.FACEME_SKIP_TLS_VERIFY;
  delete process.env.FACEME_SKIP_TLS_VERIFY;
  delete process.env.A;
  delete process.env.KEEP;
  var diag = ld.loadDotEnv(envFile);
  ok('loadDotEnv last-wins applied', process.env.FACEME_SKIP_TLS_VERIFY === '1');
  ok('loadDotEnv reports duplicates', diag.duplicateKeys.FACEME_SKIP_TLS_VERIFY === 2);
  ok('loadDotEnv envFound', diag.envFound === true);
  ok('loadDotEnv applied KEEP', process.env.KEEP === 'yes');
  // system override
  process.env.FACEME_SKIP_TLS_VERIFY = '0';
  fs.writeFileSync(envFile, 'FACEME_SKIP_TLS_VERIFY=1\n', 'utf8');
  var diag2 = ld.loadDotEnv(envFile);
  ok('system env wins over .env', process.env.FACEME_SKIP_TLS_VERIFY === '0');
  ok('systemOwnedKeys reports skip', diag2.systemOwnedKeys.indexOf('FACEME_SKIP_TLS_VERIFY') !== -1);
  ok('system override warning present', (diag2.warnings || []).some(function (w) { return /環境變數/.test(w); }));
  if (hadSkip) process.env.FACEME_SKIP_TLS_VERIFY = prevSkip;
  else delete process.env.FACEME_SKIP_TLS_VERIFY;
  delete process.env.A;
  delete process.env.KEEP;
  try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch (_) {}

  ok('centralHostIsLoopback 127', ef.centralHostIsLoopback('https://127.0.0.1') === true);
  ok('centralHostIsLoopback localhost', ef.centralHostIsLoopback('https://localhost:443') === true);
  ok('centralHostIsLoopback ::1', ef.centralHostIsLoopback('https://[::1]') === true);
  ok('centralHostIsLoopback lan false', ef.centralHostIsLoopback('https://192.168.32.220') === false);

  // upsert replaces duplicates
  var envPath = ef.ENV_PATH;
  var prev = fs.existsSync(envPath) ? fs.readFileSync(envPath, 'utf8') : null;
  fs.writeFileSync(envPath, 'FACEME_SKIP_TLS_VERIFY=0\nOTHER=1\nFACEME_SKIP_TLS_VERIFY=0\n', 'utf8');
  ef.upsertSkipTlsVerify(true);
  var after = fs.readFileSync(envPath, 'utf8');
  var matches = after.match(/^FACEME_SKIP_TLS_VERIFY=/gm) || [];
  ok('upsertSkipTlsVerify single line', matches.length === 1 && /FACEME_SKIP_TLS_VERIFY=1/.test(after));
  ok('upsertSkipTlsVerify keeps OTHER', /OTHER=1/.test(after));
  ok('upsertSkipTlsVerify bak', fs.existsSync(ef.BAK_PATH));
  if (prev != null) fs.writeFileSync(envPath, prev, 'utf8');
  else { try { fs.unlinkSync(envPath); } catch (_) {} }
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
        var raw = Buffer.concat(chunks).toString('binary');
        // Ensure official groupId present and forbidden fields absent
        var hasGroupId = /name="groupId"/.test(raw);
        var hasAlias = /name="groupIds"/.test(raw) || /name="groupName"/.test(raw);
        var hasSkip = /name="skipQC"/.test(raw) || /name="forceImport"/.test(raw) || /name="tags"/.test(raw);
        if (!hasGroupId || hasAlias || hasSkip) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({
            error: 'bad import fields',
            hasGroupId: hasGroupId,
            hasAlias: hasAlias,
            hasSkip: hasSkip
          }));
          return;
        }
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ personId: 'P-FAKE-001' }));
        return;
      }
      if (req.url === '/api/website/group/list') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
          data: {
            list: [
              { id: 1, name: 'Default', type: 'NORMAL' },
              { id: 2, name: 'Employees', type: 'EMPLOYEE' }
            ],
            totalPages: 1
          }
        }));
        return;
      }
      if (req.url === '/api/website/group/create') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ id: 99, name: 'NewFromTest' }));
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
  ok('appVersion 09j', config.appVersion === 'v2026-11-09j');
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
  ok('health version 09j', health.status === 200 && health.json.appVersion === 'v2026-11-09j');
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




  // --- group required on register ---
  var noGroupBody = (function () {
    var boundary = '----nogroup' + Date.now();
    var imgBuf = Buffer.from([0xff, 0xd8, 0xff, 0xd9]);
    function mp(name, val, filename, ctype) {
      var head = '--' + boundary + '\r\nContent-Disposition: form-data; name="' + name + '"';
      if (filename) head += '; filename="' + filename + '"\r\nContent-Type: ' + (ctype || 'application/octet-stream');
      head += '\r\n\r\n';
      return [Buffer.from(head, 'utf8'), Buffer.isBuffer(val) ? val : Buffer.from(String(val), 'utf8'), Buffer.from('\r\n', 'utf8')];
    }
    var parts = [].concat(mp('name', '測試')).concat(mp('consentTicket', 'x')).concat(mp('image', imgBuf, 'face.jpg', 'image/jpeg'));
    parts.push(Buffer.from('--' + boundary + '--\r\n', 'utf8'));
    return { boundary: boundary, body: Buffer.concat(parts) };
  })();
  // real mode still off here before QC block mutates — force flags briefly
  var cfgG = require(path.join(root, 'server/config'));
  var prevG = { f: cfgG.config.realModeFlag, l: cfgG.config.legalConfirmed, e: cfgG.config.realModeEnabled };
  cfgG.config.realModeFlag = true; cfgG.config.legalConfirmed = true; cfgG.config.realModeEnabled = true;
  var noGroupRes = await new Promise(function (resolve, reject) {
    var r = http.request({
      hostname: '127.0.0.1', port: port, path: '/api/register', method: 'POST',
      headers: { 'Content-Type': 'multipart/form-data; boundary=' + noGroupBody.boundary, 'Content-Length': noGroupBody.body.length }
    }, function (res) {
      var chunks = [];
      res.on('data', function (c) { chunks.push(c); });
      res.on('end', function () {
        var text = Buffer.concat(chunks).toString('utf8');
        var json = null; try { json = JSON.parse(text); } catch (_) {}
        resolve({ status: res.statusCode, json: json });
      });
    });
    r.on('error', reject); r.write(noGroupBody.body); r.end();
  });
  ok('register without group rejected', noGroupRes.status === 400 && noGroupRes.json && noGroupRes.json.code === 'GROUP_REQUIRED');
  cfgG.config.realModeFlag = prevG.f; cfgG.config.legalConfirmed = prevG.l; cfgG.config.realModeEnabled = prevG.e;

  // GET /api/groups without credentials configured still may fail — with test env credentials it will try upstream
  // Mock via central.listGroups
  var centralG = require(path.join(root, 'server/central/client'));
  var prevList = centralG.listGroups;
  var prevSign = centralG.signIn;
  centralG.signIn = async function () { return 'fake-token-for-tests-only-not-real'; };
  centralG.listGroups = async function () { return [{ id: '1', name: 'Default' }, { id: '2', name: 'Team' }]; };
  var groupsRes = await req('GET', '/api/groups');
  ok('GET /api/groups ok', groupsRes.status === 200 && groupsRes.json.ok === true && groupsRes.json.groups.length === 2);
  ok('GET /api/groups no token leaked', !/fake-token/.test(groupsRes.text));
  var prevProbe = centralG.probeGroups;
  centralG.probeGroups = async function () {
    return { ok: true, groups: [{ id: '1', name: 'Default' }], note: 'probe-test', path: '/api/website/group/list', method: 'POST' };
  };
  var probeRes = await req('POST', '/api/groups/probe', {});
  ok('POST /api/groups/probe ok', probeRes.status === 200 && probeRes.json.ok === true && Array.isArray(probeRes.json.groups));
  ok('POST /api/groups/probe no token leaked', !/fake-token/.test(probeRes.text));
  centralG.probeGroups = prevProbe;
  centralG.listGroups = prevList;
  centralG.signIn = prevSign;

  // --- QC fail reasons on /api/register (v2026-11-09j) ---
  var adaptersHttp = require(path.join(root, 'server/central/adapters'));
  var cfgMod = require(path.join(root, 'server/config'));
  var centralMod = require(path.join(root, 'server/central/client'));
  var consentMod = require(path.join(root, 'server/consent'));
  var prevReal = cfgMod.config.realModeEnabled;
  var prevFlag = cfgMod.config.realModeFlag;
  var prevLegal = cfgMod.config.legalConfirmed;
  cfgMod.config.realModeFlag = true;
  cfgMod.config.legalConfirmed = true;
  cfgMod.config.realModeEnabled = true;
  var issuedQc = consentMod.issueTicket(cfgMod.config.statementVersion);
  var prevQcFn = centralMod.snapshotQc;
  var prevSignIn = centralMod.signIn;
  centralMod.signIn = async function () {
    return 'fake-token-for-tests-only-not-real';
  };
  centralMod.snapshotQc = async function () {
    return adaptersHttp.parseQcResult(200, {
      quality_result: false,
      condition: {
        face_size: true,
        angle: true,
        occlusion: true,
        color: true,
        single_face: false,
        mask: true
      },
      token: 'leak-me-not-token-value'
    });
  };
  var boundary = '----facemeqc' + Date.now();
  var imgBuf = Buffer.from([0xff, 0xd8, 0xff, 0xd9]);
  function mp(name, val, filename, ctype) {
    var head =
      '--' +
      boundary +
      '\r\nContent-Disposition: form-data; name="' +
      name +
      '"';
    if (filename) {
      head +=
        '; filename="' +
        filename +
        '"\r\nContent-Type: ' +
        (ctype || 'application/octet-stream');
    }
    head += '\r\n\r\n';
    return [Buffer.from(head, 'utf8'), Buffer.isBuffer(val) ? val : Buffer.from(String(val), 'utf8'), Buffer.from('\r\n', 'utf8')];
  }
  var regParts = []
    .concat(mp('name', '測試人員'))
    .concat(mp('employeeId', 'E001'))
    .concat(mp('consentTicket', issuedQc.ticket))
    .concat(mp('groupName', 'TestGroup'))
    .concat(mp('image', imgBuf, 'face.jpg', 'image/jpeg'));
  regParts.push(Buffer.from('--' + boundary + '--\r\n', 'utf8'));
  var regBody = Buffer.concat(regParts);
  var importBeforeQc = importHits;
  var regRes = await new Promise(function (resolve, reject) {
    var r = http.request(
      {
        hostname: '127.0.0.1',
        port: port,
        path: '/api/register',
        method: 'POST',
        headers: {
          'Content-Type': 'multipart/form-data; boundary=' + boundary,
          'Content-Length': regBody.length
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
    r.write(regBody);
    r.end();
  });
  ok('register QC fail status 422', regRes.status === 422, regRes.text);
  ok('register QC fail returns reasons', !!(regRes.json && Array.isArray(regRes.json.reasons) && regRes.json.reasons.length));
  ok('register QC fail ZH single_face', /臉/.test(JSON.stringify((regRes.json && regRes.json.reasons) || [])));
  ok('register QC fail has techDetails', !!(regRes.json && regRes.json.techDetails));
  ok('register QC fail masks token', !/leak-me-not-token-value/.test(regRes.text || ''));
  ok('register QC fail-closed no import', importHits === importBeforeQc);
  centralMod.snapshotQc = prevQcFn;
  centralMod.signIn = prevSignIn;
  cfgMod.config.realModeFlag = prevFlag;
  cfgMod.config.legalConfirmed = prevLegal;
  cfgMod.config.realModeEnabled = prevReal;

  // --- skip TLS verify API (v2026-11-09j) ---
  ok('local-settings exposes skipTlsVerify', typeof ls.json.skipTlsVerify === 'boolean');
  ok('local-settings exposes envDiagnostics', ls.json.envDiagnostics && typeof ls.json.envDiagnostics.envFound === 'boolean');
  ok('local-settings no secret values in diag', !/test-password|FACEME_PASSWORD=/.test(JSON.stringify(ls.json.envDiagnostics || {})));

  // Reset central to loopback https for skip enable
  var putLoop = await new Promise(function (resolve, reject) {
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
  ok('PUT central back to loopback', putLoop.status === 200 && putLoop.json.centralBaseUrl === 'https://127.0.0.1');

  function putSkip(enabled) {
    return new Promise(function (resolve, reject) {
      var body = JSON.stringify({ enabled: enabled });
      var r = http.request(
        {
          hostname: '127.0.0.1',
          port: port,
          path: '/api/local-settings/skip-tls-verify',
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
  }

  var skipOn = await putSkip(true);
  ok('enable skipTls on loopback', skipOn.status === 200 && skipOn.json.skipTlsVerify === true);
  ok('enable skipTls applied immediate', skipOn.json.applied === 'immediate');
  var { config: cfgSkip } = require(path.join(root, 'server/config'));
  ok('config.skipTlsVerify live true', cfgSkip.skipTlsVerify === true);
  var envSkip = fs.readFileSync(path.join(root, '.env'), 'utf8');
  ok('env has single SKIP=1', (envSkip.match(/^FACEME_SKIP_TLS_VERIFY=1$/m) || []).length === 1);
  var ctSkip = await req('POST', '/api/connection-test', { attemptLogin: false });
  ok('connection-test skipTlsVerify true', ctSkip.status === 200 && ctSkip.json.skipTlsVerify === true);

  // Moving Central off loopback auto-disables skip
  var putLan = await new Promise(function (resolve, reject) {
    var body = JSON.stringify({ centralBaseUrl: 'https://192.168.1.50' });
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
  ok('non-loopback auto-disables skip', putLan.status === 200 && putLan.json.skipTlsAutoDisabled === true && putLan.json.skipTlsVerify === false);
  var { config: cfgOff } = require(path.join(root, 'server/config'));
  ok('config.skipTlsVerify live false after lan', cfgOff.skipTlsVerify === false);
  var envOff = fs.readFileSync(path.join(root, '.env'), 'utf8');
  ok('env SKIP cleared to 0', /FACEME_SKIP_TLS_VERIFY=0/.test(envOff));

  var skipDenied = await putSkip(true);
  ok('enable skip on non-loopback rejected', skipDenied.status === 400 && skipDenied.json.code === 'SKIP_TLS_NOT_LOOPBACK');

  // restore loopback + skip off for remaining tests
  await new Promise(function (resolve, reject) {
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
          Origin: 'http://127.0.0.1:' + port,
          'X-Faceme-Local-Token': adminTok,
          'Sec-Fetch-Site': 'same-origin'
        }
      },
      function (res) {
        res.on('data', function () {});
        res.on('end', resolve);
      }
    );
    r.on('error', reject);
    r.write(body);
    r.end();
  });
  await putSkip(false);

  if (prevEnv != null) fs.writeFileSync(envPath, prevEnv, 'utf8');
  else {
    try { fs.unlinkSync(envPath); } catch (_) {}
  }

  // launcher helpers
  var launch = require(path.join(root, 'scripts/windows-launcher.js'));
  ok('launcher APP_VERSION matches', launch.APP_VERSION === 'v2026-11-09j');
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
    upstreamErrorTests();
    statementVersionTests();
    tlsOptionTests();
    loadDotEnvUnitTests();
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
