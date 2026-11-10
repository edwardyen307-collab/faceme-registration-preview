(function () {
  'use strict';

  var APP_VERSION = 'v2026-11-09o';
  var STATEMENT_VERSION = null; // loaded from /api/health or /statement-version.json
  var CONSENT_KEY = 'faceme_privacy_consent_v1';
  var TICKET_KEY = 'faceme_consent_ticket';
  var TICKET_EXP_KEY = 'faceme_consent_expires';
  var API_BASE_AT_CONSENT_KEY = 'faceme_api_base_at_consent';
  var API_BASE_LS_KEY = 'faceme_api_base';
  var SETTINGS_OPEN_KEY = 'faceme_settings_open';
  var GROUP_COLORS = [
    '#C54C82','#EC729C','#F4AEBA','#8064A2','#800080','#002060','#1F4E79','#2F5597',
    '#0070C0','#00A4DE','#00B050','#92D050','#548235','#61B292','#AED09E','#C00000',
    '#FF6B3D','#E2D779','#C55A11','#843C0C','#000000','#303030','#5F5C74','#A6A6B4','#BFBFBF'
  ];
  var DEFAULT_GROUP_COLOR = '#0070C0';
  var DEFAULT_GROUP_PATTERN = 1;
  var MAX_PHOTO_BYTES = 8 * 1024 * 1024;
  var ALLOWED_TYPES = {
    'image/jpeg': true,
    'image/png': true,
    'image/webp': true,
    'image/heic': true,
    'image/heif': true
  };

  function ssGet(k) {
    try {
      return sessionStorage.getItem(k);
    } catch (e) {
      return null;
    }
  }
  function ssSet(k, v) {
    try {
      sessionStorage.setItem(k, v);
    } catch (e) {}
  }
  function ssRemove(k) {
    try {
      sessionStorage.removeItem(k);
    } catch (e) {}
  }
  function lsGet(k) {
    try {
      return localStorage.getItem(k);
    } catch (e) {
      return null;
    }
  }
  function lsSet(k, v) {
    try {
      localStorage.setItem(k, v);
    } catch (e) {}
  }
  function lsRemove(k) {
    try {
      localStorage.removeItem(k);
    } catch (e) {}
  }

  function normalizeApiBase(raw) {
    var s = String(raw || '').trim().replace(/\/+$/, '');
    return s;
  }

  function getApiBase() {
    return normalizeApiBase(lsGet(API_BASE_LS_KEY) || '');
  }

  function setApiBase(raw) {
    var next = normalizeApiBase(raw);
    var prev = getApiBase();
    if (next !== prev) {
      clearAllConsent();
    }
    if (next) lsSet(API_BASE_LS_KEY, next);
    else lsRemove(API_BASE_LS_KEY);
    return next;
  }

  function isRealMode() {
    return Boolean(getApiBase());
  }

  function isMixedContentRisk(apiBase) {
    try {
      if (typeof location === 'undefined') return false;
      if (location.protocol !== 'https:') return false;
      return /^http:\/\//i.test(apiBase || '');
    } catch (e) {
      return false;
    }
  }

  function hasMockConsent() {
    return ssGet(CONSENT_KEY) === '1';
  }

  function hasRealConsent() {
    var ticket = ssGet(TICKET_KEY);
    var exp = ssGet(TICKET_EXP_KEY);
    var baseAt = ssGet(API_BASE_AT_CONSENT_KEY) || '';
    if (!ticket || !exp) return false;
    if (baseAt !== getApiBase()) return false;
    var t = Date.parse(exp);
    if (!Number.isFinite(t) || Date.now() > t) return false;
    return true;
  }

  function hasConsent() {
    return isRealMode() ? hasRealConsent() : hasMockConsent();
  }

  function clearAllConsent() {
    ssRemove(CONSENT_KEY);
    ssRemove(TICKET_KEY);
    ssRemove(TICKET_EXP_KEY);
    ssRemove(API_BASE_AT_CONSENT_KEY);
  }

  function setMockConsent() {
    clearAllConsent();
    ssSet(CONSENT_KEY, '1');
  }

  function setRealConsent(ticket, expiresAt) {
    clearAllConsent();
    ssSet(TICKET_KEY, ticket);
    ssSet(TICKET_EXP_KEY, expiresAt);
    ssSet(API_BASE_AT_CONSENT_KEY, getApiBase());
  }

  function defaultNavigateTo(url, replace) {
    if (replace) window.location.replace(url);
    else window.location.href = url;
  }

  function navigateTo(url, replace) {
    var impl =
      (window.FaceMePreview && window.FaceMePreview.navigateTo) ||
      defaultNavigateTo;
    if (impl === navigateTo) impl = defaultNavigateTo;
    return impl(url, replace);
  }

  function apiUrl(path) {
    return getApiBase() + path;
  }


  var cachedRealModeEnabled = null;

  function updateAppFooter() {
    var footer = document.getElementById('app-footer') || document.querySelector('.app-footer');
    if (!footer) return;
    var ver = APP_VERSION;
    if (isPagesHost()) {
      footer.textContent = 'FaceMe 註冊預覽 · 純前端靜態頁 · 不串接 API · ' + ver;
      return;
    }
    if ((isLocalLoopbackPage() || isPrivateLanPage()) && getApiBase()) {
      var realLabel =
        cachedRealModeEnabled === true ? '開' : cachedRealModeEnabled === false ? '關' : '查詢中';
      footer.textContent =
        'FaceMe 註冊預覽 · ' +
        (isPrivateLanPage() ? '區網版' : '本機版') +
        ' · 已連接本機後端 · 真實模式 ' +
        realLabel +
        ' · ' +
        ver;
      return;
    }
    if (getApiBase()) {
      footer.textContent = 'FaceMe 註冊預覽 · 薄後端模式 · ' + ver;
      return;
    }
    footer.textContent = 'FaceMe 註冊預覽 · 純前端靜態頁 · 不串接 API · ' + ver;
  }

  function updateModeBanner(el) {
    if (!el) return;
    var base = getApiBase();
    if (!base) {
      el.className = 'mode-banner mode-mock';
      el.innerHTML =
        '<strong>預覽模式（Mock）</strong>：未設定後端 API base。同意與註冊只在本機模擬，' +
        '<strong>不會</strong>送出任何外部請求，也不會寫入 FaceMe。';
      updateAppFooter();
      return;
    }
    if (isMixedContentRisk(base)) {
      el.className = 'mode-banner mode-blocked';
      el.innerHTML =
        '<strong>已阻擋不安全設定</strong>：目前頁面為 HTTPS（例如 GitHub Pages），' +
        '不可將 API base 設為 <code>http://…</code>（瀏覽器 mixed content）。' +
        '請改以<strong>內網同源 HTTPS</strong>開啟本前端（由薄後端靜態服務），勿關閉瀏覽器安全功能。' +
        'GitHub Pages <strong>無法</strong>直連內網 Central。';
      updateAppFooter();
      return;
    }
    el.className = 'mode-banner mode-real';
    el.innerHTML =
      '<strong>本機／指定薄後端模式</strong>：請求會送往 <code></code>。' +
      '帳密只在伺服器 .env。即使選了後端，若未開啟 FACEME_REAL_MODE＋法務確認，註冊仍不會寫入 Central。' +
      '連線失敗<strong>不會</strong>改走 Mock 假成功。可用「連線測試」檢查 Central（≠ health）。';
    el.querySelector('code').textContent = base;
    updateAppFooter();
  }


  function updateStatementVersionDisplay() {
    var nodes = document.querySelectorAll('[data-statement-version]');
    for (var i = 0; i < nodes.length; i++) {
      nodes[i].textContent = STATEMENT_VERSION || '（載入中…）';
    }
  }

  function loadStatementVersion() {
    var url;
    try {
      if (isRealMode() && getApiBase()) {
        url = getApiBase() + '/api/health';
      } else {
        url = 'statement-version.json';
      }
    } catch (e) {
      url = 'statement-version.json';
    }
    if (typeof fetch !== 'function') {
      STATEMENT_VERSION = STATEMENT_VERSION || 'privacy-notice-draft-1';
      updateStatementVersionDisplay();
      return Promise.resolve(STATEMENT_VERSION);
    }
    return fetch(url, { credentials: 'same-origin' })
      .then(function (res) {
        return res.json().then(function (data) {
          return { res: res, data: data };
        });
      })
      .then(function (pack) {
        if (!pack.res.ok || !pack.data || !pack.data.statementVersion) {
          throw new Error('無法取得聲明版本');
        }
        STATEMENT_VERSION = pack.data.statementVersion;
          if (typeof pack.data.realModeEnabled === 'boolean') {
            cachedRealModeEnabled = pack.data.realModeEnabled;
            updateAppFooter();
          }
        updateStatementVersionDisplay();
        if (pack.data.statementEnvWarning) {
          console.warn(pack.data.statementEnvWarning);
        }
        return STATEMENT_VERSION;
      })
      .catch(function () {
        // Fallback: static file if health failed
        if (url.indexOf('statement-version.json') !== -1) {
          STATEMENT_VERSION = STATEMENT_VERSION || 'privacy-notice-draft-1';
          updateStatementVersionDisplay();
          return STATEMENT_VERSION;
        }
        return fetch('statement-version.json')
          .then(function (r) {
            return r.json();
          })
          .then(function (data) {
            STATEMENT_VERSION = (data && data.statementVersion) || 'privacy-notice-draft-1';
            updateStatementVersionDisplay();
            return STATEMENT_VERSION;
          })
          .catch(function () {
            STATEMENT_VERSION = 'privacy-notice-draft-1';
            updateStatementVersionDisplay();
            return STATEMENT_VERSION;
          });
      });
  }

  function isLocalLoopbackPage() {
    try {
      var h = location.hostname;
      return h === '127.0.0.1' || h === 'localhost';
    } catch (e) {
      return false;
    }
  }

  function isPrivateLanHostname(h) {
    var host = String(h || '');
    var m = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(host);
    if (!m) return false;
    var a = Number(m[1]), b = Number(m[2]), c = Number(m[3]), d = Number(m[4]);
    if (a > 255 || b > 255 || c > 255 || d > 255) return false;
    if (a === 10) return true;
    if (a === 192 && b === 168) return true;
    if (a === 172 && b >= 16 && b <= 31) return true;
    if (a === 169 && b === 254) return true;
    return false;
  }

  function isPrivateLanPage() {
    try {
      return isPrivateLanHostname(location.hostname);
    } catch (e) {
      return false;
    }
  }

  function stripLocalOnlyNodesIfVisitor() {
    if (isLocalLoopbackPage() && !isPagesHost()) return;
    var nodes = document.querySelectorAll('[data-local-only], #local-admin-root, #phone-qr-card');
    for (var i = 0; i < nodes.length; i++) {
      if (nodes[i] && nodes[i].parentNode) nodes[i].parentNode.removeChild(nodes[i]);
    }
  }

  function escapeQrText(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function buildPhoneQrFigures(urls) {
    var html = '';
    for (var i = 0; i < (urls || []).length; i++) {
      var u = String(urls[i] || '');
      if (!u) continue;
      var svg = '';
      try {
        if (typeof qrcode === 'function') {
          var qr = qrcode(0, 'M');
          qr.addData(u);
          qr.make();
          if (typeof qr.createSvgTag === 'function') {
            svg = qr.createSvgTag({ cellSize: 4, margin: 2, scalable: true });
          } else if (typeof qr.createImgTag === 'function') {
            svg = qr.createImgTag(4, 4);
          }
        }
      } catch (e) {
        svg = '';
      }
      html +=
        '<figure class="phone-qr-item">' +
        (svg ? '<div class="phone-qr-svg">' + svg + '</div>' : '<p class="hint">無法在本機產生 QR</p>') +
        '<figcaption><code>' +
        escapeQrText(u) +
        '</code></figcaption></figure>';
    }
    return html;
  }

  function renderPhoneQr(data) {
    var card = document.getElementById('phone-qr-card');
    var hint = document.getElementById('phone-qr-hint');
    var topCodes = document.getElementById('phone-qr-codes');
    var adminCodes = document.getElementById('admin-phone-qr-codes');
    if (!isLocalLoopbackPage() || isPagesHost()) {
      if (card && card.parentNode) card.parentNode.removeChild(card);
      return;
    }
    if (card) card.hidden = false;
    var lanOn = !!(data && data.lanAccess);
    var urls = (data && data.phoneUrls) || [];
    if (lanOn && urls.length) {
      if (hint) {
        hint.textContent = '用 iPhone 相機掃描即可開啟註冊頁（同一 Wi-Fi，HTTP）。';
      }
      var figures = buildPhoneQrFigures(urls);
      if (topCodes) {
        topCodes.hidden = false;
        topCodes.innerHTML = figures;
      }
      if (adminCodes) {
        adminCodes.hidden = false;
        adminCodes.innerHTML = figures;
      }
    } else if (lanOn) {
      if (hint) {
        hint.textContent =
          '已開啟區網，但目前找不到區網 IPv4。請確認電腦已連上 Wi-Fi 後重開 start.bat。QR 會在偵測到區網位址後顯示。';
      }
      if (topCodes) {
        topCodes.hidden = true;
        topCodes.innerHTML = '';
      }
      if (adminCodes) {
        adminCodes.hidden = true;
        adminCodes.innerHTML = '';
      }
    } else {
      if (hint) {
        hint.textContent =
          '開啟下方「管理／設定（僅本機）」的「手機連線（區網）」後，這裡會顯示可供 iPhone 相機掃描的 QR。';
      }
      if (topCodes) {
        topCodes.hidden = true;
        topCodes.innerHTML = '';
      }
      if (adminCodes) {
        adminCodes.hidden = true;
        adminCodes.innerHTML = '';
      }
    }
  }

  function applyLocalOneClickDefaults() {
    var params;
    try {
      params = new URLSearchParams(location.search || '');
    } catch (e) {
      params = null;
    }
    if (isLocalLoopbackPage() && params && params.get('local') === '1') {
      // One-click start: force same-origin backend mode (clear stale empty mock confusion)
      setApiBase(location.origin);
      return;
    }
    // iPhone / LAN: page is already served by the thin backend — use same origin
    if (isPrivateLanPage() && location.protocol === 'http:') {
      setApiBase(location.origin);
    }
  }

  function runConnectionTest(attemptLogin) {
    var out = document.getElementById('conn-test-result');
    var base = getApiBase();
    if (!base) {
      if (out) {
        out.hidden = false;
        out.textContent =
          '請先「使用本機薄後端」或設定 API base。連線測試是打薄後端的 /api/connection-test，不是 Mock。';
      }
      return;
    }
    if (isMixedContentRisk(base)) {
      if (out) {
        out.hidden = false;
        out.textContent = 'HTTPS 頁無法呼叫 http API base。';
      }
      return;
    }
    if (out) {
      out.hidden = false;
      out.textContent = attemptLogin
        ? '進行連線＋登入測試（不會 QC／import）…'
        : '進行連線測試（TCP／TLS，不登入）…';
    }
    fetch(base + '/api/connection-test', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ attemptLogin: !!attemptLogin })
    })
      .then(function (res) {
        return res.json().then(function (data) {
          return { res: res, data: data };
        });
      })
      .then(function (pack) {
        if (!out) return;
        out.textContent = JSON.stringify(pack.data, null, 2);
      })
      .catch(function (e) {
        if (!out) return;
        out.textContent =
          '無法呼叫連線測試：' +
          ((e && e.message) || e) +
          '\n（這與 /api/health 不同；若薄後端未開請先 start.bat）';
      });
  }

  var localAdminToken = null;

  function isPagesHost() {
    try {
      return /github\.io$/i.test(location.hostname);
    } catch (e) {
      return false;
    }
  }

  function loadCentralSettingsUi() {
    var input = document.getElementById('central-base-input');
    var saveBtn = document.getElementById('central-base-save');
    var reloadBtn = document.getElementById('central-base-reload');
    var status = document.getElementById('central-base-status');
    var only = document.getElementById('central-base-local-only');
    var skipRow = document.getElementById('skip-tls-row');
    var skipToggle = document.getElementById('skip-tls-toggle');
    var skipStatus = document.getElementById('skip-tls-status');
    var skipHint = document.getElementById('skip-tls-hint');
    var envDiag = document.getElementById('env-diag-result');
    if (!input) return;

    function flashC(msg, isError) {
      if (!status) return;
      status.textContent = msg || '';
      status.className = 'api-status' + (isError ? ' error' : '');
    }

    function flashSkip(msg, isError) {
      if (!skipStatus) return;
      skipStatus.textContent = msg || '';
      skipStatus.className = 'api-status' + (isError ? ' error' : '');
    }

    function setEnabled(on) {
      input.disabled = !on;
      if (saveBtn) saveBtn.disabled = !on;
      if (reloadBtn) reloadBtn.disabled = !on;
      if (only) only.hidden = !!on;
      if (skipRow) skipRow.hidden = !on;
    }

    function applySkipUi(data) {
      if (!skipToggle) return;
      var can = !!(data && data.canEnableSkipTlsVerify);
      var on = !!(data && data.skipTlsVerify);
      skipToggle.checked = on;
      skipToggle.disabled = !can && !on;
      if (!can) {
        skipToggle.disabled = true;
        if (skipHint) {
          skipHint.textContent =
            '目前 Central 不是 127.0.0.1／localhost／::1，無法開啟略過自簽憑證。請改成本機位址，或匯入正式 CA。';
        }
      } else if (skipHint) {
        skipHint.textContent =
          '僅當 Central 是 127.0.0.1／localhost／::1 時可開啟。有中間人風險；正式環境請匯入 CA。寫入 .env 的 FACEME_SKIP_TLS_VERIFY，立即生效。';
      }
      if (envDiag && data && data.envDiagnostics) {
        var d = data.envDiagnostics;
        var lines = [];
        lines.push('.env 路徑：' + (d.envPath || '(未知)'));
        lines.push('找到 .env：' + (d.envFound ? '是' : '否'));
        lines.push('存在 .env.txt：' + (d.envTxtFound ? '是（請確認是否改錯檔）' : '否'));
        var dups = d.duplicateKeys || {};
        var dk = Object.keys(dups);
        lines.push('同名鍵重複：' + (dk.length ? dk.map(function (k) { return k + '×' + dups[k]; }).join(', ') : '無'));
        var sys = d.systemOwnedKeys || [];
        lines.push('系統環境變數覆寫：' + (sys.length ? sys.join(', ') : '無'));
        (d.warnings || []).forEach(function (w) { lines.push('警告：' + w); });
        envDiag.hidden = false;
        envDiag.textContent = lines.join('\n');
      }
    }

    var lanRow = document.getElementById('lan-access-row');
    var lanToggle = document.getElementById('lan-access-toggle');
    var lanStatus = document.getElementById('lan-access-status');
    var lanUrls = document.getElementById('lan-phone-urls');
    var lanHint = document.getElementById('lan-access-hint');

    function flashLan(msg, isError) {
      if (!lanStatus) return;
      lanStatus.textContent = msg || '';
      lanStatus.className = 'api-status' + (isError ? ' error' : '');
    }

    function applyLanUi(data) {
      if (lanRow) lanRow.hidden = false;
      if (lanToggle) {
        lanToggle.disabled = false;
        lanToggle.checked = !!(data && data.lanAccess);
      }
      if (lanUrls) {
        var urls = (data && data.phoneUrls) || [];
        if (data && data.lanAccess && urls.length) {
          lanUrls.hidden = false;
          lanUrls.innerHTML =
            '<p class="hint" style="margin-top:0">請在同一 Wi-Fi 的 iPhone Safari 開啟（HTTP 即可）：</p>' +
            '<ul class="lan-url-list">' +
            urls
              .map(function (u) {
                return '<li><code>' + String(u).replace(/</g, '') + '</code></li>';
              })
              .join('') +
            '</ul>';
        } else if (data && data.lanAccess) {
          lanUrls.hidden = false;
          lanUrls.innerHTML =
            '<p class="hint">已開啟，但目前找不到區網 IPv4。請確認電腦已連上 Wi-Fi 後重開 start.bat。</p>';
        } else {
          lanUrls.hidden = true;
          lanUrls.innerHTML = '';
        }
      }
      renderPhoneQr(data);
    }

    if (!isLocalLoopbackPage() || isPagesHost()) {
      setEnabled(false);
      if (only) {
        only.hidden = false;
        only.textContent = '此區塊僅本機版（http://127.0.0.1:…）可用；GitHub Pages 無法修改 Central。';
      }
      return;
    }

    renderPhoneQr({ lanAccess: false, phoneUrls: [] });

    function fetchSettings() {
      if (typeof fetch !== 'function') {
        flashC('此環境不支援 fetch，無法載入 Central 設定。', true);
        return;
      }
      var base = getApiBase() || location.origin;
      return fetch(base + '/api/local-settings', { method: 'GET', credentials: 'same-origin' })
        .then(function (res) {
          return res.json().then(function (data) {
            return { res: res, data: data };
          });
        })
        .then(function (pack) {
          if (!pack.res.ok) {
            setEnabled(false);
            flashC((pack.data && pack.data.error) || '無法載入本機 Central 設定', true);
            return;
          }
          localAdminToken = pack.data.localAdminToken || null;
          input.value = pack.data.centralBaseUrl || '';
          setEnabled(true);
          applySkipUi(pack.data);
          applyLanUi(pack.data);
          flashC('已載入伺服器 FACEME_BASE_URL（不含帳密）。', false);
        })
        .catch(function (e) {
          setEnabled(false);
          flashC('無法連線薄後端以載入 Central 設定：' + ((e && e.message) || e), true);
        });
    }

    if (reloadBtn) {
      reloadBtn.addEventListener('click', function () {
        fetchSettings();
      });
    }
    if (saveBtn) {
      saveBtn.addEventListener('click', function () {
        var base = getApiBase() || location.origin;
        if (!localAdminToken) {
          flashC('尚未取得本機管理 token，請先重新載入。', true);
          return;
        }
        flashC('儲存中…', false);
        if (typeof fetch !== 'function') {
          flashC('此環境不支援 fetch。', true);
          return;
        }
        fetch(base + '/api/local-settings/central-base', {
          method: 'PUT',
          credentials: 'same-origin',
          headers: {
            'Content-Type': 'application/json',
            'X-Faceme-Local-Token': localAdminToken
          },
          body: JSON.stringify({ centralBaseUrl: input.value })
        })
          .then(function (res) {
            return res.json().then(function (data) {
              return { res: res, data: data };
            });
          })
          .then(function (pack) {
            if (!pack.res.ok) {
              flashC((pack.data && pack.data.error) || '儲存失敗', true);
              return;
            }
            input.value = pack.data.centralBaseUrl || input.value;
            var msg =
              '已儲存並立即生效（已備份 .env.bak）。請用「連線測試」驗證。帳密未透過網頁讀取。';
            if (pack.data.skipTlsAutoDisabled) {
              msg =
                '已更新 Central。因新位址不是本機 loopback，已自動關閉「略過自簽憑證」並寫回 .env。';
              if (skipToggle) skipToggle.checked = false;
            }
            applySkipUi({
              skipTlsVerify: pack.data.skipTlsVerify,
              canEnableSkipTlsVerify: /127\.0\.0\.1|localhost|::1/i.test(input.value || '')
            });
            flashC(msg, false);
          })
          .catch(function (e) {
            flashC('儲存失敗：' + ((e && e.message) || e), true);
          });
      });
    }

    if (skipToggle) {
      skipToggle.addEventListener('change', function () {
        var base = getApiBase() || location.origin;
        if (!localAdminToken) {
          flashSkip('尚未取得本機管理 token，請先重新載入。', true);
          skipToggle.checked = !skipToggle.checked;
          return;
        }
        var want = !!skipToggle.checked;
        flashSkip(want ? '開啟略過中…' : '關閉略過中…', false);
        fetch(base + '/api/local-settings/skip-tls-verify', {
          method: 'PUT',
          credentials: 'same-origin',
          headers: {
            'Content-Type': 'application/json',
            'X-Faceme-Local-Token': localAdminToken
          },
          body: JSON.stringify({ enabled: want })
        })
          .then(function (res) {
            return res.json().then(function (data) {
              return { res: res, data: data };
            });
          })
          .then(function (pack) {
            if (!pack.res.ok) {
              skipToggle.checked = !want;
              flashSkip((pack.data && pack.data.error) || '更新失敗', true);
              return;
            }
            skipToggle.checked = !!pack.data.skipTlsVerify;
            flashSkip(pack.data.note || '已更新', false);
          })
          .catch(function (e) {
            skipToggle.checked = !want;
            flashSkip('更新失敗：' + ((e && e.message) || e), true);
          });
      });
    }

    if (lanToggle) {
      lanToggle.addEventListener('change', function () {
        var base = getApiBase() || location.origin;
        if (!localAdminToken) {
          flashLan('尚未取得本機管理 token，請先重新載入。', true);
          lanToggle.checked = !lanToggle.checked;
          return;
        }
        var want = !!lanToggle.checked;
        flashLan(want ? '開啟區網連線中…' : '關閉區網連線中…', false);
        fetch(base + '/api/local-settings/lan-access', {
          method: 'PUT',
          credentials: 'same-origin',
          headers: {
            'Content-Type': 'application/json',
            'X-Faceme-Local-Token': localAdminToken
          },
          body: JSON.stringify({ enabled: want })
        })
          .then(function (res) {
            return res.json().then(function (data) {
              return { res: res, data: data };
            });
          })
          .then(function (pack) {
            if (!pack.res.ok) {
              lanToggle.checked = !want;
              flashLan((pack.data && pack.data.error) || '更新失敗', true);
              return;
            }
            applyLanUi(pack.data);
            var msg = pack.data.note || '已更新';
            if (pack.data.restartRequired) {
              msg += ' 請重開 start.bat。';
            }
            flashLan(msg, false);
          })
          .catch(function (e) {
            lanToggle.checked = !want;
            flashLan('更新失敗：' + ((e && e.message) || e), true);
          });
      });
    }

    fetchSettings();
  }


  function initSettingsCollapse() {
    var details = document.getElementById('admin-details') || document.getElementById('settings-details');
    if (!details) return;
    try {
      var saved = lsGet(SETTINGS_OPEN_KEY);
      if (saved === '1') details.open = true;
      else if (saved === '0') details.open = false;
      else details.open = false; // default collapsed
    } catch (e) {
      details.open = false;
    }
    details.addEventListener('toggle', function () {
      try {
        lsSet(SETTINGS_OPEN_KEY, details.open ? '1' : '0');
      } catch (e) {}
    });
  }

  function initApiBasePanel() {
    initSettingsCollapse();
    applyLocalOneClickDefaults();
    var input = document.getElementById('api-base-input');
    var saveBtn = document.getElementById('api-base-save');
    var clearBtn = document.getElementById('api-base-clear');
    var sameBtn = document.getElementById('api-base-same-origin');
    var banner = document.getElementById('mode-banner');
    var status = document.getElementById('api-base-status');
    var connBtn = document.getElementById('btn-conn-test');
    var connLoginBtn = document.getElementById('btn-conn-login');
    updateModeBanner(banner);
    if (!input) return;

    input.value = getApiBase();

    function flash(msg, isError) {
      if (!status) return;
      status.textContent = msg;
      status.className = 'api-status' + (isError ? ' error' : '');
    }

    if (saveBtn) {
      saveBtn.addEventListener('click', function () {
        var next = setApiBase(input.value);
        input.value = next;
        updateModeBanner(banner);
        if (next && isMixedContentRisk(next)) {
          flash('已儲存位址，但目前 HTTPS 頁面會阻擋呼叫此 http API。', true);
        } else if (next) {
          flash('已儲存 API base，並清除舊同意狀態（需重新同意）。', false);
        } else {
          flash('已清除 API base，回到 Mock 預覽。', false);
        }
      });
    }
    if (clearBtn) {
      clearBtn.addEventListener('click', function () {
        setApiBase('');
        input.value = '';
        updateModeBanner(banner);
        flash('已回到 Mock 預覽模式（無外部請求）。', false);
      });
    }
    if (sameBtn) {
      sameBtn.addEventListener('click', function () {
        if (!isLocalLoopbackPage() && location.protocol === 'https:') {
          flash('目前不是本機 HTTP 頁；請用 start.bat 開啟 http://127.0.0.1:8443/?local=1', true);
          return;
        }
        var origin = location.origin;
        setApiBase(origin);
        input.value = origin;
        updateModeBanner(banner);
        flash('已設定本機同源薄後端：' + origin, false);
        loadStatementVersion();
      });
    }
    if (connBtn) {
      connBtn.addEventListener('click', function () {
        runConnectionTest(false);
      });
    }
    if (connLoginBtn) {
      connLoginBtn.addEventListener('click', function () {
        var ok = window.confirm(
          '將使用伺服器 .env 帳密向 Central 做「只讀登入測試」。\n不會 QC、不會 import、不會寫入人臉。\n是否繼續？'
        );
        if (!ok) return;
        runConnectionTest(true);
      });
    }

    loadCentralSettingsUi();
  }

  function initConsentPage() {
    initApiBasePanel();
    loadStatementVersion();
    var checkbox = document.getElementById('consent-check');
    var submitBtn = document.getElementById('consent-submit');
    var form = document.getElementById('consent-form');
    var errEl = document.getElementById('consent-error');
    if (!checkbox || !submitBtn || !form) return;

    function sync() {
      submitBtn.disabled = !checkbox.checked || submitBtn.dataset.busy === '1';
    }
    function setErr(msg) {
      if (errEl) errEl.textContent = msg || '';
    }

    checkbox.addEventListener('change', sync);
    sync();

    form.addEventListener('submit', function (ev) {
      ev.preventDefault();
      setErr('');
      if (!checkbox.checked) {
        sync();
        checkbox.focus();
        return;
      }

      var base = getApiBase();
      if (!base) {
        setMockConsent();
        navigateTo('register.html', false);
        return;
      }

      if (!STATEMENT_VERSION) {
        setErr('聲明版本尚未載入，請稍候再按一次，或重新整理頁面。');
        return;
      }

      if (isMixedContentRisk(base)) {
        setErr(
          'HTTPS 頁面無法呼叫 http API base（mixed content）。請用內網薄後端同源 HTTPS 開啟，或清除 API base 使用 Mock。'
        );
        return;
      }

      submitBtn.dataset.busy = '1';
      sync();
      fetch(apiUrl('/api/consent'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          agreed: true,
          statementVersion: STATEMENT_VERSION
        })
      })
        .then(function (res) {
          return res.json().then(function (data) {
            return { res: res, data: data };
          });
        })
        .then(function (pack) {
          if (!pack.res.ok) {
            throw new Error(
              (pack.data && pack.data.error) ||
                '後端拒絕同意記錄（不會改走 Mock）'
            );
          }
          if (!pack.data || !pack.data.ticket || !pack.data.expiresAt) {
            throw new Error('後端同意回應不完整（不會改走 Mock）');
          }
          setRealConsent(pack.data.ticket, pack.data.expiresAt);
          navigateTo('register.html', false);
        })
        .catch(function (e) {
          clearAllConsent();
          var msg = (e && e.message) || '';
          if (!msg || msg === 'Failed to fetch' || /network/i.test(msg)) {
            msg = '無法連線後端（不會改走 Mock 假成功）';
          } else if (msg.indexOf('Mock') === -1) {
            msg = msg + '（不會改走 Mock 假成功）';
          }
          setErr(msg);
        })
        .finally(function () {
          submitBtn.dataset.busy = '0';
          sync();
        });
    });
  }

  function guardRegisterPage() {
    if (!hasConsent()) {
      navigateTo('index.html', true);
      return false;
    }
    return true;
  }

  function revokeObjectUrl(url) {
    if (url && String(url).indexOf('blob:') === 0) {
      try {
        URL.revokeObjectURL(url);
      } catch (e) {}
    }
  }

  function initRegisterPage() {
    initApiBasePanel();
    loadStatementVersion();
    if (!guardRegisterPage()) return;

    var form = document.getElementById('register-form');
    var nameInput = document.getElementById('full-name');
    var nameError = document.getElementById('name-error');
    var memberInput = document.getElementById('member-id');
    var photoInput = document.getElementById('face-photo');
    var photoError = document.getElementById('photo-error');
    var previewWrap = document.getElementById('photo-preview-wrap');
    var previewImg = document.getElementById('photo-preview');
    var clearPhotoBtn = document.getElementById('clear-photo');
    var resultBox = document.getElementById('submit-result');
    var formError = document.getElementById('form-error');
    var backBtn = document.getElementById('back-to-notice');
    var submitBtn = document.getElementById('register-submit');
    var groupInput = document.getElementById('group-name');
    var groupSelect = document.getElementById('group-select');
    var groupList = document.getElementById('group-list');
    var groupError = document.getElementById('group-error');
    var groupStatus = document.getElementById('group-status');
    var groupExtras = document.getElementById('group-create-extras');
    var groupColorInput = document.getElementById('group-color');
    var groupColorSwatches = document.getElementById('group-color-swatches');
    var groupPatternSelect = document.getElementById('group-pattern');
    var probeGroupsBtn = document.getElementById('btn-probe-groups');
    var groupProbeResult = document.getElementById('group-probe-result');
    var knownGroups = [];
    var currentObjectUrl = null;

    function setGroupError(msg) {
      if (groupError) groupError.textContent = msg || '';
      if (groupInput) {
        if (msg) groupInput.setAttribute('aria-invalid', 'true');
        else groupInput.removeAttribute('aria-invalid');
      }
    }

    function initGroupCreateExtras() {
      if (groupPatternSelect && !groupPatternSelect.options.length) {
        for (var p = 1; p <= 20; p++) {
          var o = document.createElement('option');
          o.value = String(p);
          o.textContent = String(p);
          if (p === DEFAULT_GROUP_PATTERN) o.selected = true;
          groupPatternSelect.appendChild(o);
        }
      }
      if (groupColorSwatches && !groupColorSwatches.children.length) {
        for (var i = 0; i < GROUP_COLORS.length; i++) {
          var c = GROUP_COLORS[i];
          var btn = document.createElement('button');
          btn.type = 'button';
          btn.className = 'color-swatch';
          btn.style.background = c;
          btn.setAttribute('role', 'option');
          btn.setAttribute('aria-label', c);
          btn.dataset.color = c;
          btn.setAttribute(
            'aria-selected',
            c.toUpperCase() === DEFAULT_GROUP_COLOR.toUpperCase() ? 'true' : 'false'
          );
          btn.addEventListener('click', function (ev) {
            var color = ev.currentTarget.dataset.color;
            if (groupColorInput) groupColorInput.value = color;
            var kids = groupColorSwatches.querySelectorAll('.color-swatch');
            for (var k = 0; k < kids.length; k++) {
              kids[k].setAttribute(
                'aria-selected',
                kids[k].dataset.color === color ? 'true' : 'false'
              );
            }
          });
          groupColorSwatches.appendChild(btn);
        }
        if (groupColorInput) groupColorInput.value = DEFAULT_GROUP_COLOR;
      }
    }

    function isKnownGroupName(name) {
      var n = String(name || '').trim().toLowerCase();
      if (!n) return false;
      for (var i = 0; i < knownGroups.length; i++) {
        var g = knownGroups[i];
        if (String(g.name || '').trim().toLowerCase() === n) return true;
        if (String(g.id || '').trim().toLowerCase() === n) return true;
      }
      return false;
    }

    function updateGroupCreateExtrasVisibility() {
      if (!groupExtras) return;
      var val = ((groupInput && groupInput.value) || '').trim();
      var show = Boolean(val) && !isKnownGroupName(val) && isRealMode();
      groupExtras.hidden = !show;
    }

    function groupLabel(g) {
      var name = (g && g.name) || '';
      var type = g && g.type ? String(g.type) : '';
      return type ? name + '（' + type + '）' : name;
    }

    function fillGroupOptions() {
      if (!groupSelect) return;
      var prev = groupSelect.value;
      groupSelect.innerHTML = '';
      var ph = document.createElement('option');
      ph.value = '';
      if (knownGroups.length) ph.textContent = '請選擇群組…';
      else if (isRealMode()) ph.textContent = '尚無群組，請在下方輸入新名稱';
      else ph.textContent = '預覽模式請在下方輸入群組名稱';
      groupSelect.appendChild(ph);
      for (var i = 0; i < knownGroups.length; i++) {
        var opt = document.createElement('option');
        opt.value = knownGroups[i].name || knownGroups[i].id || '';
        opt.textContent = groupLabel(knownGroups[i]);
        groupSelect.appendChild(opt);
      }
      if (prev) groupSelect.value = prev;
      if (groupList) {
        groupList.innerHTML = '';
        for (var j = 0; j < knownGroups.length; j++) {
          var dopt = document.createElement('option');
          dopt.value = knownGroups[j].name || knownGroups[j].id || '';
          dopt.label = groupLabel(knownGroups[j]);
          groupList.appendChild(dopt);
        }
      }
    }

    function syncGroupFromSelect() {
      if (!groupSelect || !groupInput) return;
      if (groupSelect.value) groupInput.value = groupSelect.value;
      updateGroupCreateExtrasVisibility();
    }

    function syncSelectFromInput() {
      if (!groupSelect || !groupInput) return;
      var val = String(groupInput.value || '').trim();
      var match = '';
      for (var i = 0; i < knownGroups.length; i++) {
        var n = String(knownGroups[i].name || knownGroups[i].id || '').trim();
        if (n && n.toLowerCase() === val.toLowerCase()) {
          match = knownGroups[i].name || knownGroups[i].id || '';
          break;
        }
      }
      groupSelect.value = match;
      updateGroupCreateExtrasVisibility();
    }

    function loadGroups() {
      initGroupCreateExtras();
      fillGroupOptions();
      if (!groupInput || !isRealMode()) {
        if (groupStatus) {
          groupStatus.textContent = isRealMode()
            ? ''
            : '預覽模式：群組僅本機驗證必填，不會向 Central 查詢。';
        }
        if (groupExtras) groupExtras.hidden = true;
        return;
      }
      var base = getApiBase();
      if (!base || typeof fetch !== 'function') {
        if (groupStatus) {
          groupStatus.textContent = '無法載入群組清單，請自行輸入群組名稱。';
        }
        return;
      }
      if (groupStatus) groupStatus.textContent = '載入 Central 群組中…';
      fetch(base + '/api/groups', { method: 'GET', credentials: 'same-origin' })
        .then(function (res) {
          return res.json().then(function (data) {
            return { res: res, data: data };
          });
        })
        .then(function (pack) {
          if (!pack.res.ok) {
            knownGroups = [];
            if (groupStatus) {
              groupStatus.textContent =
                '無法載入群組（' +
                ((pack.data && pack.data.error) || pack.res.status) +
                '）。請自行輸入；若為新名稱，真實模式會先建立再以 groupId 匯入。';
              groupStatus.className = 'api-status error';
            }
            updateGroupCreateExtrasVisibility();
            return;
          }
          knownGroups = (pack.data && pack.data.groups) || [];
          fillGroupOptions();
          if (groupStatus) {
            groupStatus.className = 'api-status';
            groupStatus.textContent =
              '已載入 ' +
              knownGroups.length +
              ' 個群組（POST /api/website/group/list）。也可自行輸入新名稱（會 create 後用 groupId 匯入）。';
          }
          updateGroupCreateExtrasVisibility();
        })
        .catch(function (e) {
          knownGroups = [];
          if (groupStatus) {
            groupStatus.className = 'api-status error';
            groupStatus.textContent =
              '無法載入群組：' + ((e && e.message) || e) + '。請自行輸入名稱。';
          }
          updateGroupCreateExtrasVisibility();
        });
    }

    if (groupSelect) {
      groupSelect.addEventListener('change', syncGroupFromSelect);
    }
    if (groupInput) {
      groupInput.addEventListener('input', syncSelectFromInput);
      groupInput.addEventListener('change', syncSelectFromInput);
    }

    if (probeGroupsBtn) {
      probeGroupsBtn.addEventListener('click', function () {
        if (!isRealMode()) {
          if (groupProbeResult) {
            groupProbeResult.hidden = false;
            groupProbeResult.textContent = '預覽模式無法探測 Central 群組。';
          }
          return;
        }
        var base = getApiBase();
        if (!base || typeof fetch !== 'function') return;
        if (groupProbeResult) {
          groupProbeResult.hidden = false;
          groupProbeResult.textContent = '探測中…';
        }
        fetch(base + '/api/groups/probe', {
          method: 'POST',
          credentials: 'same-origin',
          headers: { 'Content-Type': 'application/json' },
          body: '{}'
        })
          .then(function (res) {
            return res.json().then(function (data) {
              return { res: res, data: data };
            });
          })
          .then(function (pack) {
            if (groupProbeResult) {
              var encLine =
                '實際 body 編碼：' +
                ((pack.data && (pack.data.bodyEncoding || pack.data.encodingRemembered)) ||
                  '未知') +
                (pack.data && pack.data.contentType
                  ? '（' + pack.data.contentType + '）'
                  : '');
              groupProbeResult.textContent =
                encLine + '\n\n' + JSON.stringify(pack.data, null, 2);
            }
            if (pack.res.ok && pack.data && Array.isArray(pack.data.groups)) {
              knownGroups = pack.data.groups;
              fillGroupOptions();
              if (groupStatus) {
                groupStatus.className = 'api-status';
                groupStatus.textContent =
                  '探測成功，已載入 ' + knownGroups.length + ' 個群組。';
              }
              updateGroupCreateExtrasVisibility();
            }
          })
          .catch(function (e) {
            if (groupProbeResult) {
              groupProbeResult.textContent = '探測失敗：' + ((e && e.message) || e);
            }
          });
      });
    }

    loadGroups();

    function setPhotoError(msg) {
      if (photoError) photoError.textContent = msg || '';
      if (photoInput) {
        if (msg) photoInput.setAttribute('aria-invalid', 'true');
        else photoInput.removeAttribute('aria-invalid');
      }
    }
    function setNameError(msg) {
      if (nameError) nameError.textContent = msg || '';
      if (nameInput) {
        if (msg) nameInput.setAttribute('aria-invalid', 'true');
        else nameInput.removeAttribute('aria-invalid');
      }
    }
    function setFormError(msg) {
      if (formError) formError.textContent = msg || '';
    }
    function showResult(text, ok) {
      if (!resultBox) return;
      resultBox.textContent = text;
      resultBox.className = 'result visible' + (ok ? '' : ' result-error');
      resultBox.focus();
    }

    function showImportSuccess(data) {
      if (!resultBox) return;
      var personId = data && data.personId;
      var group = (data && data.group) || {};
      var detailUrl = data && data.detailUrl;
      var html = '';
      html += '<div class="qc-fail-title">已成功匯入 Central</div>';
      html += '<ul class="qc-reason-list">';
      html += '<li><strong>personId：</strong> ' + escapeHtml(String(personId || '')) + '</li>';
      html +=
        '<li><strong>群組：</strong> ' +
        escapeHtml(String(group.name || '')) +
        (group.created ? '（新建）' : '') +
        '</li>';
      if (detailUrl) {
        html +=
          '<li><strong>Central 人員頁：</strong> <a href="' +
          escapeHtml(detailUrl) +
          '" target="_blank" rel="noopener noreferrer">' +
          escapeHtml(detailUrl) +
          '</a></li>';
      } else {
        html += '<li>請到 Central 人員列表以 personId 搜尋確認。</li>';
      }
      html += '</ul>';
      html +=
        '<p class="qc-fail-note">若列表暫時看不到，可能在其他群組篩選或待審檢視；請用上方連結直接開啟。</p>';
      if (data && data.techDetails) {
        var tech = '';
        try {
          tech = JSON.stringify(data.techDetails, null, 2);
        } catch (e) {
          tech = String(data.techDetails);
        }
        html +=
          '<details class="qc-tech"><summary>技術細節（已遮罩）</summary><pre>' +
          escapeHtml(tech) +
          '</pre></details>';
      }
      resultBox.innerHTML = html;
      resultBox.className = 'result visible';
      resultBox.focus();
      if (formError) formError.textContent = '';
    }

    function showQcFailure(data) {
      showStructuredFailure(data, 'qc');
    }

    function showStructuredFailure(data, kind) {
      if (!resultBox) return;
      var isImport = kind === 'import';
      var title =
        (data && data.error) ||
        (isImport ? '匯入 Central 失敗' : '人臉品質檢查未通過，已取消匯入');
      var reasons = (data && data.reasons) || [];
      var html = '';
      html += '<div class="qc-fail-title">' + escapeHtml(title) + '</div>';
      html +=
        '<p class="qc-fail-note">' +
        (isImport
          ? '品質檢查可能已通過，但人員尚未確認寫入。請依下列說明處理，勿假設已匯入。'
          : '尚未匯入 Central（fail-closed）。請依下列原因調整後重拍。') +
        '</p>';
      if (reasons.length) {
        html += '<ul class="qc-reason-list">';
        for (var i = 0; i < reasons.length; i++) {
          var r = reasons[i] || {};
          html += '<li><strong>' + escapeHtml(r.text || '') + '</strong>';
          if (r.hint) html += '<div class="qc-hint">建議：' + escapeHtml(r.hint) + '</div>';
          html += '</li>';
        }
        html += '</ul>';
      }
      if (data && data.techDetails) {
        var tech = '';
        try {
          tech = JSON.stringify(data.techDetails, null, 2);
        } catch (e) {
          tech = String(data.techDetails);
        }
        html +=
          '<details class="qc-tech"><summary>技術細節（已遮罩，無 token／影像）</summary><pre>' +
          escapeHtml(tech) +
          '</pre></details>';
      }
      resultBox.innerHTML = html;
      resultBox.className = 'result visible result-error';
      resultBox.focus();
      if (formError) {
        formError.textContent = title + (reasons[0] && reasons[0].text ? ' — ' + reasons[0].text : '');
      }
    }

    function escapeHtml(s) {
      return String(s || '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
    }

    function clearPhoto() {
      revokeObjectUrl(currentObjectUrl);
      currentObjectUrl = null;
      if (photoInput) photoInput.value = '';
      if (previewImg) {
        previewImg.removeAttribute('src');
        previewImg.alt = '';
      }
      if (previewWrap) previewWrap.classList.remove('visible');
      setPhotoError('');
    }

    function showPreview(file) {
      revokeObjectUrl(currentObjectUrl);
      currentObjectUrl = URL.createObjectURL(file);
      if (previewImg) {
        previewImg.src = currentObjectUrl;
        previewImg.alt = '人臉照片本機預覽（送出前僅在本機）';
      }
      if (previewWrap) previewWrap.classList.add('visible');
    }

    function validatePhotoFile(file) {
      if (!file) {
        setPhotoError('');
        return true;
      }
      var type = (file.type || '').toLowerCase();
      var name = (file.name || '').toLowerCase();
      var okType =
        ALLOWED_TYPES[type] || /\.(jpe?g|png|webp|heic|heif)$/.test(name);
      if (!okType) {
        setPhotoError('僅接受 JPG、PNG、WebP 或 HEIC 圖片。');
        return false;
      }
      if (file.size > MAX_PHOTO_BYTES) {
        setPhotoError('檔案過大，請選擇 8MB 以內的圖片。');
        return false;
      }
      setPhotoError('');
      return true;
    }

    if (photoInput) {
      photoInput.addEventListener('change', function () {
        var file = photoInput.files && photoInput.files[0];
        if (!file) {
          clearPhoto();
          return;
        }
        if (!validatePhotoFile(file)) {
          photoInput.value = '';
          revokeObjectUrl(currentObjectUrl);
          currentObjectUrl = null;
          if (previewWrap) previewWrap.classList.remove('visible');
          if (previewImg) previewImg.removeAttribute('src');
          return;
        }
        showPreview(file);
      });
    }
    if (clearPhotoBtn) clearPhotoBtn.addEventListener('click', clearPhoto);
    if (backBtn) {
      backBtn.addEventListener('click', function () {
        navigateTo('index.html', false);
      });
    }
    window.addEventListener('pagehide', function () {
      revokeObjectUrl(currentObjectUrl);
      currentObjectUrl = null;
    });
    if (nameInput) {
      nameInput.addEventListener('input', function () {
        if ((nameInput.value || '').trim()) setNameError('');
      });
    }

    if (form) {
      form.addEventListener('submit', function (ev) {
        ev.preventDefault();
        setFormError('');
        if (resultBox) resultBox.classList.remove('visible');

        var name = ((nameInput && nameInput.value) || '').trim();
        if (!name) {
          setNameError('請填寫姓名。');
          if (nameInput) nameInput.focus();
          return;
        }
        setNameError('');

        var groupVal = ((groupInput && groupInput.value) || '').trim();
        if (!groupVal) {
          setGroupError('請選擇或輸入群組名稱。');
          if (groupInput) groupInput.focus();
          return;
        }
        setGroupError('');

        var file = photoInput && photoInput.files && photoInput.files[0];
        if (isRealMode() && !file) {
          setPhotoError('真實模式請上傳人臉照片。');
          return;
        }
        if (file && !validatePhotoFile(file)) {
          if (photoInput) photoInput.focus();
          return;
        }

        if (!isRealMode()) {
          showResult('已送出（預覽模式，尚未寫入 FaceMe）', true);
          return;
        }

        if (isMixedContentRisk(getApiBase())) {
          setFormError(
            'HTTPS 頁面無法呼叫 http API（mixed content）。請改用內網同源部署。'
          );
          return;
        }

        if (!hasRealConsent()) {
          setFormError('同意票證無效或已過期，請返回聲明頁重新同意。');
          return;
        }

        var fd = new FormData();
        fd.append('name', name);
        var mid = ((memberInput && memberInput.value) || '').trim();
        if (mid) fd.append('employeeId', mid);
        fd.append('consentTicket', ssGet(TICKET_KEY) || '');
        fd.append('groupName', groupVal);
        if (!isKnownGroupName(groupVal)) {
          var colorVal =
            (groupColorInput && groupColorInput.value) || DEFAULT_GROUP_COLOR;
          var patternVal =
            (groupPatternSelect && groupPatternSelect.value) ||
            String(DEFAULT_GROUP_PATTERN);
          fd.append('groupColor', colorVal);
          fd.append('groupPatternId', patternVal);
        }
        fd.append('image', file, file.name || 'face.jpg');

        if (submitBtn) {
          submitBtn.disabled = true;
          submitBtn.dataset.busy = '1';
        }

        fetch(apiUrl('/api/register'), { method: 'POST', body: fd })
          .then(function (res) {
            return res.json().then(function (data) {
              return { res: res, data: data };
            });
          })
          .then(function (pack) {
            if (!pack.res.ok) {
              // Ticket may be consumed/invalid — force re-consent on hard consent errors
              var code = pack.data && pack.data.code;
              if (
                code === 'CONSENT_INVALID' ||
                code === 'CONSENT_EXPIRED' ||
                code === 'CONSENT_REPLAY' ||
                code === 'CONSENT_MISSING' ||
                code === 'CONSENT_VERSION_MISMATCH'
              ) {
                clearAllConsent();
              }
              if (
                code === 'QC_FAIL' ||
                code === 'QC_HTTP_ERROR' ||
                code === 'QC_SHAPE_UNKNOWN' ||
                code === 'IMPORT_FAILED' ||
                code === 'IMPORT_SHAPE_UNKNOWN' ||
                code === 'IMPORT_PERSON_ID_MISSING' ||
                code === 'IMPORT_EXISTS_SIMILAR' ||
                code === 'GROUP_REQUIRED' ||
                code === 'GROUP_CREATE_FAILED' ||
                (pack.data && Array.isArray(pack.data.reasons) && pack.data.reasons.length)
              ) {
                showStructuredFailure(pack.data || {}, code && String(code).indexOf('IMPORT') === 0 ? 'import' : 'qc');
                return;
              }
              throw new Error(
                (pack.data && pack.data.error) ||
                  '註冊失敗（不會改走 Mock 假成功）'
              );
            }
            if (!pack.data || !pack.data.personId) {
              throw new Error('後端未回傳 personId（不會改走 Mock）');
            }
            clearAllConsent();
            showImportSuccess(pack.data);
          })
          .catch(function (e) {
            setFormError(e.message || '無法連線後端（不會改走 Mock 假成功）');
            showResult(e.message || '註冊失敗', false);
          })
          .finally(function () {
            if (submitBtn) {
              submitBtn.disabled = false;
              submitBtn.dataset.busy = '0';
            }
          });
      });
    }
  }


  function initPersonAdminPanel() {
    var card = document.getElementById('person-admin-card');
    if (!card) return;
    if (!isLocalLoopbackPage() || isPagesHost()) {
      if (card.parentNode) card.parentNode.removeChild(card);
      return;
    }
    card.hidden = false;

    function esc(s) {
      return String(s == null ? '' : s)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
    }
    function setStatus(id, msg, isError) {
      var el = document.getElementById(id);
      if (!el) return;
      el.textContent = msg || '';
      el.className = 'api-status' + (isError ? ' error' : '');
    }
    function apiBase() {
      return getApiBase() || (isLocalLoopbackPage() ? location.origin : '');
    }
    function paHeaders(mutate) {
      var h = { 'Content-Type': 'application/json' };
      if (mutate && localAdminToken) h['X-Faceme-Local-Token'] = localAdminToken;
      return h;
    }
    function ensureToken() {
      if (localAdminToken) return Promise.resolve(localAdminToken);
      var base = apiBase();
      if (!base || typeof fetch !== 'function') return Promise.reject(new Error('無法取得本機管理 token'));
      return fetch(base + '/api/local-settings', { method: 'GET', credentials: 'same-origin' })
        .then(function (res) {
          return res.json().then(function (data) {
            return { res: res, data: data };
          });
        })
        .then(function (pack) {
          if (!pack.res.ok) throw new Error((pack.data && pack.data.error) || '無法取得本機管理 token');
          localAdminToken = pack.data.localAdminToken || null;
          if (!localAdminToken) throw new Error('後端未回傳本機管理 token');
          return localAdminToken;
        });
    }
    function postPa(path, body, mutate) {
      var base = apiBase();
      if (!base) return Promise.reject(new Error('請先連到本機薄後端（127.0.0.1）。'));
      var seq = mutate ? ensureToken() : Promise.resolve(null);
      return seq.then(function () {
        return fetch(base + path, {
          method: 'POST',
          credentials: 'same-origin',
          headers: paHeaders(!!mutate),
          body: JSON.stringify(body || {})
        });
      }).then(function (res) {
        return res.json().then(function (data) {
          return { res: res, data: data };
        });
      });
    }
    function groupLabel(g) {
      if (!g) return '';
      var name = g.name || g.groupId || g.id || '';
      var type = g.type ? '（' + g.type + '）' : '';
      return name + type;
    }
    function renderPersonTable(el, rows) {
      if (!el) return;
      if (!rows || !rows.length) {
        el.hidden = false;
        el.innerHTML = '<p class="hint">沒有符合的人。</p>';
        return;
      }
      var html =
        '<table class="pa-table"><thead><tr>' +
        '<th>personId</th><th>姓名</th><th>員工編號</th><th>群組狀態</th><th>群組</th><th>連結</th><th></th>' +
        '</tr></thead><tbody>';
      for (var i = 0; i < rows.length; i++) {
        var p = rows[i];
        var st = p.groupStatus || 'unknown';
        var gs = (p.groups || [])
          .map(function (g) {
            return esc(groupLabel(g) || g.groupId);
          })
          .join('、');
        var link = p.detailUrl
          ? '<a href="' + esc(p.detailUrl) + '" target="_blank" rel="noopener noreferrer">開啟</a>'
          : '';
        html +=
          '<tr>' +
          '<td>' + esc(p.personId) + '</td>' +
          '<td>' + esc(p.name) + '</td>' +
          '<td>' + esc(p.employeeId) + '</td>' +
          '<td class="pa-status-' + esc(st) + '">' + esc(st) + '</td>' +
          '<td>' + (gs || '—') + '</td>' +
          '<td>' + link + '</td>' +
          '<td><button type="button" class="btn btn-secondary pa-use-id" data-person-id="' +
          esc(p.personId) +
          '">用此人</button></td>' +
          '</tr>';
      }
      html += '</tbody></table>';
      el.hidden = false;
      el.innerHTML = html;
      var btns = el.querySelectorAll('.pa-use-id');
      for (var b = 0; b < btns.length; b++) {
        btns[b].addEventListener('click', function (ev) {
          var id = ev.currentTarget.getAttribute('data-person-id');
          var q = document.getElementById('pa-query-id');
          var a = document.getElementById('pa-assign-id');
          if (q) q.value = id;
          if (a) a.value = id;
        });
      }
    }
    function renderPersonCard(el, person) {
      if (!el || !person) return;
      var gs = (person.groups || [])
        .map(function (g) {
          return esc(groupLabel(g) || g.groupId);
        })
        .join('、');
      var link = person.detailUrl
        ? '<a href="' + esc(person.detailUrl) + '" target="_blank" rel="noopener noreferrer">' + esc(person.detailUrl) + '</a>'
        : '—';
      el.hidden = false;
      el.innerHTML =
        '<p><strong>#' +
        esc(person.personId) +
        '</strong> ' +
        esc(person.name || '（無姓名）') +
        (person.employeeId ? ' ／ ' + esc(person.employeeId) : '') +
        '</p>' +
        '<p>群組狀態：<span class="pa-status-' +
        esc(person.groupStatus) +
        '">' +
        esc(person.groupStatus) +
        '</span> ' +
        (gs || '—') +
        '</p>' +
        '<p>詳細頁：' +
        link +
        '</p>';
      var assign = document.getElementById('pa-assign-id');
      if (assign && person.personId) assign.value = person.personId;
    }

    function loadAssignGroups() {
      var sel = document.getElementById('pa-assign-group');
      var base = apiBase();
      if (!sel || !base || typeof fetch !== 'function') return;
      fetch(base + '/api/groups', { method: 'GET', credentials: 'same-origin' })
        .then(function (res) {
          return res.json().then(function (data) {
            return { res: res, data: data };
          });
        })
        .then(function (pack) {
          var groups = (pack.res.ok && pack.data && pack.data.groups) || [];
          var cur = sel.value;
          sel.innerHTML = '<option value="">選擇群組…</option>';
          for (var i = 0; i < groups.length; i++) {
            var g = groups[i];
            var opt = document.createElement('option');
            opt.value = g.id || g.groupId || '';
            opt.textContent = groupLabel({ name: g.name, type: g.type, groupId: opt.value });
            sel.appendChild(opt);
          }
          if (cur) sel.value = cur;
        })
        .catch(function () {});
    }

    var listBtn = document.getElementById('pa-list-btn');
    if (listBtn) {
      listBtn.addEventListener('click', function () {
        setStatus('pa-list-status', '載入中…', false);
        postPa('/api/person-admin/member-list', {})
          .then(function (pack) {
            if (!pack.res.ok) {
              setStatus('pa-list-status', (pack.data && pack.data.error) || '載入失敗', true);
              return;
            }
            var d = pack.data;
            var counts = d.counts || {};
            var msg =
              '共 ' +
              ((d.persons && d.persons.length) || 0) +
              ' 人（未分組 ' +
              (counts.ungrouped || 0) +
              '、有群組 ' +
              (counts.grouped || 0) +
              '、不明 ' +
              (counts.unknown || 0) +
              '）' +
              (d.truncated ? '；已達頁數上限' : '');
            if (d.hint) msg += ' ' + d.hint;
            setStatus('pa-list-status', msg, false);
            var show = d.persons || [];
            renderPersonTable(document.getElementById('pa-list-result'), show);
            var raw = document.getElementById('pa-list-raw');
            if (raw) {
              raw.hidden = false;
              raw.textContent = '原始回應（遮罩，第一頁）\n' + JSON.stringify(d.firstPageRaw || d, null, 2);
            }
          })
          .catch(function (e) {
            setStatus('pa-list-status', (e && e.message) || String(e), true);
          });
      });
    }

    var queryBtn = document.getElementById('pa-query-btn');
    if (queryBtn) {
      queryBtn.addEventListener('click', function () {
        var id = ((document.getElementById('pa-query-id') || {}).value || '').trim();
        setStatus('pa-query-status', '查詢中…', false);
        postPa('/api/person-admin/query', { personId: id })
          .then(function (pack) {
            if (!pack.res.ok) {
              setStatus('pa-query-status', (pack.data && pack.data.error) || '查詢失敗', true);
              var box = document.getElementById('pa-query-result');
              if (box) box.hidden = true;
              return;
            }
            setStatus('pa-query-status', '已找到', false);
            renderPersonCard(document.getElementById('pa-query-result'), pack.data.person);
          })
          .catch(function (e) {
            setStatus('pa-query-status', (e && e.message) || String(e), true);
          });
      });
    }

    var scanBtn = document.getElementById('pa-scan-btn');
    if (scanBtn) {
      scanBtn.addEventListener('click', function () {
        var from = ((document.getElementById('pa-scan-from') || {}).value || '').trim();
        var to = ((document.getElementById('pa-scan-to') || {}).value || '').trim();
        setStatus('pa-scan-status', '掃描中（只讀，可能需要一些時間）…', false);
        postPa('/api/person-admin/scan', { from: from, to: to })
          .then(function (pack) {
            if (!pack.res.ok) {
              setStatus('pa-scan-status', (pack.data && pack.data.error) || '掃描失敗', true);
              return;
            }
            var d = pack.data;
            setStatus(
              'pa-scan-status',
              '已檢查 ' + d.checked + ' 個編號，找到未分組／不明 ' + ((d.ungrouped && d.ungrouped.length) || 0) + ' 人。',
              false
            );
            renderPersonTable(document.getElementById('pa-scan-result'), d.ungrouped || []);
          })
          .catch(function (e) {
            setStatus('pa-scan-status', (e && e.message) || String(e), true);
          });
      });
    }

    var reloadG = document.getElementById('pa-assign-reload-groups');
    if (reloadG) reloadG.addEventListener('click', loadAssignGroups);
    loadAssignGroups();

    var assignBtn = document.getElementById('pa-assign-btn');
    if (assignBtn) {
      assignBtn.addEventListener('click', function () {
        var id = ((document.getElementById('pa-assign-id') || {}).value || '').trim();
        var sel = document.getElementById('pa-assign-group');
        var gid = sel ? sel.value : '';
        var gname = sel && sel.selectedIndex >= 0 ? sel.options[sel.selectedIndex].text : gid;
        if (!id || !gid) {
          setStatus('pa-assign-status', '請填人員編號並選擇群組。', true);
          return;
        }
        var ok = window.confirm(
          '確定要把人員 #' + id + ' 指定到群組「' + gname + '」（#' + gid + '）？\n這會寫入 Central，且無法在此頁復原。'
        );
        if (!ok) {
          setStatus('pa-assign-status', '已取消。', false);
          return;
        }
        setStatus('pa-assign-status', '寫入中…', false);
        postPa('/api/person-admin/assign', { personId: id, groupId: gid, confirm: true }, true)
          .then(function (pack) {
            if (!pack.res.ok) {
              setStatus('pa-assign-status', (pack.data && pack.data.error) || '指定失敗', true);
              return;
            }
            setStatus('pa-assign-status', pack.data.message || '已更新', false);
            var box = document.getElementById('pa-assign-result');
            if (box) {
              box.hidden = false;
              if (pack.data.verified) renderPersonCard(box, pack.data.verified);
              else box.textContent = JSON.stringify(pack.data, null, 2);
            }
          })
          .catch(function (e) {
            setStatus('pa-assign-status', (e && e.message) || String(e), true);
          });
      });
    }
  }

  window.FaceMePreview = {
    APP_VERSION: APP_VERSION,
    get STATEMENT_VERSION() { return STATEMENT_VERSION; },
    loadStatementVersion: loadStatementVersion,
    CONSENT_KEY: CONSENT_KEY,
    TICKET_KEY: TICKET_KEY,
    API_BASE_LS_KEY: API_BASE_LS_KEY,
    MAX_PHOTO_BYTES: MAX_PHOTO_BYTES,
    getApiBase: getApiBase,
    setApiBase: setApiBase,
    isRealMode: isRealMode,
    isMixedContentRisk: isMixedContentRisk,
    hasConsent: hasConsent,
    hasMockConsent: hasMockConsent,
    hasRealConsent: hasRealConsent,
    clearAllConsent: clearAllConsent,
    setMockConsent: setMockConsent,
    setRealConsent: setRealConsent,
    navigateTo: defaultNavigateTo,
    initConsentPage: initConsentPage,
    guardRegisterPage: guardRegisterPage,
    initRegisterPage: initRegisterPage,
    initApiBasePanel: initApiBasePanel,
    updateModeBanner: updateModeBanner,
    updateAppFooter: updateAppFooter,
    initSettingsCollapse: initSettingsCollapse,
    applyLocalOneClickDefaults: applyLocalOneClickDefaults,
    isLocalLoopbackPage: isLocalLoopbackPage,
    isPrivateLanPage: isPrivateLanPage,
    runConnectionTest: runConnectionTest,
    loadCentralSettingsUi: loadCentralSettingsUi,
    isPagesHost: isPagesHost,
    initPersonAdminPanel: initPersonAdminPanel,
    stripLocalOnlyNodesIfVisitor: stripLocalOnlyNodesIfVisitor,
    renderPhoneQr: renderPhoneQr
  };

  document.addEventListener('DOMContentLoaded', function () {
    stripLocalOnlyNodesIfVisitor();
    var page = document.body && document.body.getAttribute('data-page');
    if (page === 'consent') initConsentPage();
    if (page === 'register') initRegisterPage();
    initPersonAdminPanel();
  });
})();
