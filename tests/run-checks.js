#!/usr/bin/env node
'use strict';

var fs = require('fs');
var path = require('path');

var root = path.join(__dirname, '..');
var failures = [];

function ok(name, cond, detail) {
  if (cond) {
    console.log('PASS  ' + name);
  } else {
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

ok('version in index title', /v2026-11-06a/.test(indexHtml));
ok('version in register title', /v2026-11-06a/.test(registerHtml));
ok('index has draft tags', /範本／待法務確認/.test(indexHtml) && /草稿/.test(indexHtml));
ok('index has placeholder markers', /【待填寫：/.test(indexHtml));
ok('index mentions face image', /人臉影像/.test(indexHtml));
ok('index consent checkbox default unchecked', /id="consent-check"/.test(indexHtml) && !/id="consent-check"[^>]*checked/.test(indexHtml));
ok('index submit disabled by default', /id="consent-submit"[^>]*disabled/.test(indexHtml));
ok('no FaceMe API URLs', !/faceme\.|central\.api|api\.faceme/i.test(indexHtml + registerHtml + js));
ok('no third-party analytics', !/google-analytics|gtag\(|googletagmanager|facebook\.net|hotjar/i.test(indexHtml + registerHtml + js + css));
ok('no external image hosts', !/https?:\/\/[^"']+\.(png|jpg|svg|gif|webp)/i.test(indexHtml + registerHtml + css));
ok('viewport meta both pages', /name="viewport"/.test(indexHtml) && /name="viewport"/.test(registerHtml));
ok('lang zh-Hant', /lang="zh-Hant"/.test(indexHtml) && /lang="zh-Hant"/.test(registerHtml));
ok('register has required name field', /id="full-name"/.test(registerHtml) && /required/.test(registerHtml));
ok('register has optional member id', /id="member-id"/.test(registerHtml));
ok('register photo input accepts images', /id="face-photo"/.test(registerHtml) && /accept=/.test(registerHtml));
ok('register capture for camera', /capture="user"/.test(registerHtml));
ok('register preview warning', /請勿輸入真實個資/.test(registerHtml));
ok('labels present', /for="consent-check"/.test(indexHtml) && /for="full-name"/.test(registerHtml));
ok('responsive css present', /@media \(min-width: 560px\)/.test(css));
ok('sessionStorage consent key in js', /faceme_privacy_consent_v1/.test(js));
ok('mock submit message in js', /已送出（預覽模式，尚未寫入 FaceMe）/.test(js));
ok('objectURL cleanup in js', /revokeObjectURL/.test(js));
ok('max photo size guard', /MAX_PHOTO_BYTES/.test(js));

var JSDOM;
try {
  JSDOM = require('jsdom').JSDOM;
} catch (e) {
  console.error('\njsdom not installed. Run: npm install --save-dev jsdom\n');
  process.exit(2);
}

function loadPage(htmlFile, beforeEval) {
  var html = read(htmlFile);
  var dom = new JSDOM(html, {
    url: 'https://example.test/' + htmlFile,
    runScripts: 'outside-only',
    pretendToBeVisual: true
  });
  var window = dom.window;
  if (beforeEval) beforeEval(window);
  window.eval(read('app.js'));
  window.document.dispatchEvent(new window.Event('DOMContentLoaded'));
  return { dom: dom, window: window, document: window.document };
}

(function () {
  var navLog = [];
  var page = loadPage('index.html', function (window) {
    /* stub after FaceMePreview exists — wrap after eval via monkeypatch below */
  });
  var checkbox = page.document.getElementById('consent-check');
  var submit = page.document.getElementById('consent-submit');
  ok('consent button starts disabled', submit && submit.disabled === true);
  checkbox.checked = true;
  checkbox.dispatchEvent(new page.window.Event('change', { bubbles: true }));
  ok('consent button enables after check', submit.disabled === false);
  checkbox.checked = false;
  checkbox.dispatchEvent(new page.window.Event('change', { bubbles: true }));
  ok('consent button disables after uncheck', submit.disabled === true);

  page.window.FaceMePreview.navigateTo = function (url, replace) {
    navLog.push({ url: url, replace: !!replace });
  };
  checkbox.checked = true;
  checkbox.dispatchEvent(new page.window.Event('change', { bubbles: true }));
  page.document.getElementById('consent-form').dispatchEvent(
    new page.window.Event('submit', { bubbles: true, cancelable: true })
  );
  ok('consent sets sessionStorage', page.window.sessionStorage.getItem('faceme_privacy_consent_v1') === '1');
  ok(
    'consent navigates to register.html',
    navLog.length === 1 && navLog[0].url === 'register.html' && navLog[0].replace === false
  );
  page.dom.window.close();
})();

(function () {
  var navLog = [];
  var page = loadPage('register.html', function () {});
  // Re-run init with stub: clear and re-init after stubbing navigate
  page.window.sessionStorage.removeItem('faceme_privacy_consent_v1');
  page.window.FaceMePreview.navigateTo = function (url, replace) {
    navLog.push({ url: url, replace: !!replace });
  };
  page.window.FaceMePreview.initRegisterPage();
  ok(
    'register without consent redirects to index',
    navLog.some(function (n) { return n.url === 'index.html' && n.replace === true; })
  );
  page.dom.window.close();
})();

(function () {
  var page = loadPage('register.html', function (window) {
    window.sessionStorage.setItem('faceme_privacy_consent_v1', '1');
  });
  // First DOMContentLoaded already ran with consent set in beforeEval — but beforeEval runs before eval, so set there.
  // Actually consent was set in beforeEval before script; initRegisterPage already ran. Good.

  // If guard somehow redirected, re-init with consent
  page.window.sessionStorage.setItem('faceme_privacy_consent_v1', '1');
  var createdUrls = [];
  var revoked = [];
  page.window.URL.createObjectURL = function (blob) {
    var u = 'blob:mock-' + createdUrls.length;
    createdUrls.push({ u: u, blob: blob });
    return u;
  };
  page.window.URL.revokeObjectURL = function (u) {
    revoked.push(u);
  };
  // Re-bind handlers with mocked URL APIs
  page.window.FaceMePreview.navigateTo = function () {};
  page.window.FaceMePreview.initRegisterPage();

  var form = page.document.getElementById('register-form');
  var nameInput = page.document.getElementById('full-name');
  var nameError = page.document.getElementById('name-error');
  var result = page.document.getElementById('submit-result');
  var photoInput = page.document.getElementById('face-photo');
  var preview = page.document.getElementById('photo-preview');
  var previewWrap = page.document.getElementById('photo-preview-wrap');
  var photoError = page.document.getElementById('photo-error');

  form.dispatchEvent(new page.window.Event('submit', { bubbles: true, cancelable: true }));
  ok('empty name shows error', /請填寫姓名/.test(nameError.textContent));
  ok('empty name does not show success', !result.classList.contains('visible'));

  nameInput.value = '預覽使用者';
  form.dispatchEvent(new page.window.Event('submit', { bubbles: true, cancelable: true }));
  ok(
    'mock submit shows preview message',
    result.classList.contains('visible') && /已送出（預覽模式，尚未寫入 FaceMe）/.test(result.textContent)
  );

  var big = { name: 'big.jpg', type: 'image/jpeg', size: 9 * 1024 * 1024 };
  Object.defineProperty(photoInput, 'files', {
    configurable: true,
    get: function () { return { 0: big, length: 1, item: function () { return big; } }; }
  });
  photoInput.dispatchEvent(new page.window.Event('change', { bubbles: true }));
  ok('rejects oversized photo', /8MB/.test(photoError.textContent));

  var small = { name: 'face.jpg', type: 'image/jpeg', size: 12345 };
  Object.defineProperty(photoInput, 'files', {
    configurable: true,
    get: function () { return { 0: small, length: 1, item: function () { return small; } }; }
  });
  photoInput.dispatchEvent(new page.window.Event('change', { bubbles: true }));
  var src = preview.getAttribute('src') || preview.src || '';
  ok('accepts image and sets objectURL preview', previewWrap.classList.contains('visible') && /^blob:mock-/.test(src));
  ok('preview alt warns local only', /本機預覽/.test(preview.alt));

  var txt = { name: 'x.txt', type: 'text/plain', size: 10 };
  Object.defineProperty(photoInput, 'files', {
    configurable: true,
    get: function () { return { 0: txt, length: 1, item: function () { return txt; } }; }
  });
  photoInput.dispatchEvent(new page.window.Event('change', { bubbles: true }));
  ok('rejects non-image file', /僅接受/.test(photoError.textContent));

  var beforeRevoke = revoked.length;
  Object.defineProperty(photoInput, 'files', {
    configurable: true,
    get: function () { return { 0: small, length: 1, item: function () { return small; } }; }
  });
  photoInput.dispatchEvent(new page.window.Event('change', { bubbles: true }));
  page.document.getElementById('clear-photo').dispatchEvent(new page.window.Event('click', { bubbles: true }));
  ok('clear photo revokes objectURL', revoked.length > beforeRevoke);

  ok('mobile camera capture attribute present', photoInput.getAttribute('capture') === 'user');
  ok('desktop-friendly file input remains type=file', photoInput.getAttribute('type') === 'file');

  page.dom.window.close();
})();

console.log('');
if (failures.length) {
  console.error(failures.length + ' failed:', failures.join(', '));
  process.exit(1);
}
console.log('All checks passed.');
process.exit(0);
