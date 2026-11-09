(function () {
  'use strict';

  var APP_VERSION = 'v2026-11-09g';
  var STATEMENT_VERSION = null; // loaded from /api/health or /statement-version.json
  var CONSENT_KEY = 'faceme_privacy_consent_v1';
  var TICKET_KEY = 'faceme_consent_ticket';
  var TICKET_EXP_KEY = 'faceme_consent_expires';
  var API_BASE_AT_CONSENT_KEY = 'faceme_api_base_at_consent';
  var API_BASE_LS_KEY = 'faceme_api_base';
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

  function updateModeBanner(el) {
    if (!el) return;
    var base = getApiBase();
    if (!base) {
      el.className = 'mode-banner mode-mock';
      el.innerHTML =
        '<strong>預覽模式（Mock）</strong>：未設定後端 API base。同意與註冊只在本機模擬，' +
        '<strong>不會</strong>送出任何外部請求，也不會寫入 FaceMe。';
      return;
    }
    if (isMixedContentRisk(base)) {
      el.className = 'mode-banner mode-blocked';
      el.innerHTML =
        '<strong>已阻擋不安全設定</strong>：目前頁面為 HTTPS（例如 GitHub Pages），' +
        '不可將 API base 設為 <code>http://…</code>（瀏覽器 mixed content）。' +
        '請改以<strong>內網同源 HTTPS</strong>開啟本前端（由薄後端靜態服務），勿關閉瀏覽器安全功能。' +
        'GitHub Pages <strong>無法</strong>直連內網 Central。';
      return;
    }
    el.className = 'mode-banner mode-real';
    el.innerHTML =
      '<strong>本機／指定薄後端模式</strong>：請求會送往 <code></code>。' +
      '帳密只在伺服器 .env。即使選了後端，若未開啟 FACEME_REAL_MODE＋法務確認，註冊仍不會寫入 Central。' +
      '連線失敗<strong>不會</strong>改走 Mock 假成功。可用「連線測試」檢查 Central（≠ health）。';
    el.querySelector('code').textContent = base;
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

  function applyLocalOneClickDefaults() {
    if (!isLocalLoopbackPage()) return;
    var params;
    try {
      params = new URLSearchParams(location.search || '');
    } catch (e) {
      params = null;
    }
    if (params && params.get('local') === '1') {
      // One-click start: force same-origin backend mode (clear stale empty mock confusion)
      setApiBase(location.origin);
      return;
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

    if (!isLocalLoopbackPage() || isPagesHost()) {
      setEnabled(false);
      if (only) {
        only.hidden = false;
        only.textContent = '此區塊僅本機版（http://127.0.0.1:…）可用；GitHub Pages 無法修改 Central。';
      }
      return;
    }

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

    fetchSettings();
  }

  function initApiBasePanel() {
    var input = document.getElementById('api-base-input');
    var saveBtn = document.getElementById('api-base-save');
    var clearBtn = document.getElementById('api-base-clear');
    var sameBtn = document.getElementById('api-base-same-origin');
    var banner = document.getElementById('mode-banner');
    var status = document.getElementById('api-base-status');
    var connBtn = document.getElementById('btn-conn-test');
    var connLoginBtn = document.getElementById('btn-conn-login');
    if (!input) return;

    applyLocalOneClickDefaults();
    input.value = getApiBase();
    updateModeBanner(banner);

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
    var currentObjectUrl = null;

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

    function showQcFailure(data) {
      if (!resultBox) return;
      var title = (data && data.error) || '人臉品質檢查未通過，已取消匯入';
      var reasons = (data && data.reasons) || [];
      var html = '';
      html += '<div class="qc-fail-title">' + escapeHtml(title) + '</div>';
      html += '<p class="qc-fail-note">尚未匯入 Central（fail-closed）。請依下列原因調整後重拍。</p>';
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
                (pack.data && Array.isArray(pack.data.reasons) && pack.data.reasons.length)
              ) {
                showQcFailure(pack.data || {});
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
            showResult('註冊成功（經內網薄後端）。personId：' + pack.data.personId, true);
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
    applyLocalOneClickDefaults: applyLocalOneClickDefaults,
    isLocalLoopbackPage: isLocalLoopbackPage,
    runConnectionTest: runConnectionTest,
    loadCentralSettingsUi: loadCentralSettingsUi,
    isPagesHost: isPagesHost
  };

  document.addEventListener('DOMContentLoaded', function () {
    var page = document.body && document.body.getAttribute('data-page');
    if (page === 'consent') initConsentPage();
    if (page === 'register') initRegisterPage();
  });
})();
