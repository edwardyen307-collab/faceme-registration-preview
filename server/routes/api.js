'use strict';

const express = require('express');
const multer = require('multer');
const {
  config,
  assertRealModeReady,
  assertCentralCredentials,
  setFacemeBaseUrl,
  setSkipTlsVerify,
  setLanAccess,
  canEnableSkipTlsVerify
} = require('../config');
const { issueTicket, consumeTicket } = require('../consent');
const {
  validateName,
  validateEmployeeId,
  validateGroupName,
  validateImageFile
} = require('../validate');
const central = require('../central/client');
const { findGroupByName } = require('../central/groups');
const { buildUserDetailUrl } = require('../central/adapters');
const {
  validateCentralBaseUrl,
  upsertFacemeBaseUrl,
  upsertSkipTlsVerify,
  upsertLanAccess,
  centralHostIsLoopback
} = require('../env-file');
const { assertLocalAdmin, localAdminToken } = require('../local-admin');
const { phoneUrls, listenHost, FIREWALL_NOTE } = require('../lan-access');
const { rebindListen, getHttpServer } = require('../http-bind');

const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: config.maxUploadBytes,
    files: 1,
    fields: 20
  }
});

const router = express.Router();

router.get('/health', (req, res) => {
  res.json({
    ok: true,
    appVersion: config.appVersion,
    statementVersion: config.statementVersion,
    statementEnvIgnored: Boolean(config.statementEnvIgnored),
    statementEnvWarning: config.statementEnvWarning || null,
    realModeEnabled: config.realModeEnabled,
    realModeFlag: config.realModeFlag,
    legalConfirmed: config.legalConfirmed,
    // Never expose account/password/base secrets beyond "configured?" booleans
    upstreamConfigured: Boolean(config.facemeBaseUrl && config.facemeAccount),
    lanAccess: Boolean(config.lanAccess),
    note:
      '本機薄後端存活檢查（非 Central 連線測試）。statementVersion 來自 statement-version.json（與個資聲明全文綁定，不隨 appVersion 變）。'
  });
});



router.get('/local-settings', (req, res, next) => {
  try {
    assertLocalAdmin(req, { mutate: false });
    const d = config.envDiagnostics || {};
    res.json({
      localAdmin: true,
      appVersion: config.appVersion,
      centralBaseUrl: config.facemeBaseUrl || '',
      skipTlsVerify: Boolean(config.skipTlsVerify),
      canEnableSkipTlsVerify: canEnableSkipTlsVerify(config.facemeBaseUrl),
      lanAccess: Boolean(config.lanAccess),
      listenHost: listenHost(),
      phoneUrls: config.lanAccess ? phoneUrls(config.port) : [],
      lanFirewallNote: FIREWALL_NOTE,
      localAdminToken: localAdminToken,
      envDiagnostics: {
        envPath: d.envPath,
        envFound: Boolean(d.envFound),
        envTxtFound: Boolean(d.envTxtFound),
        duplicateKeys: d.duplicateKeys || {},
        systemOwnedKeys: d.systemOwnedKeys || [],
        warnings: d.warnings || []
      },
      note:
        'FACEME_BASE_URL＝Central；瀏覽器 API base＝薄後端。略過 TLS 僅本機 Central 可開。不回傳帳密。'
    });
  } catch (e) {
    next(e);
  }
});

router.put('/local-settings/central-base', express.json({ limit: '4kb' }), (req, res, next) => {
  try {
    assertLocalAdmin(req, { mutate: true });
    const raw = req.body && req.body.centralBaseUrl;
    const v = validateCentralBaseUrl(raw);
    if (!v.ok) {
      const err = new Error(v.message);
      err.code = v.code;
      err.status = 400;
      throw err;
    }
    const written = upsertFacemeBaseUrl(v.normalized);
    setFacemeBaseUrl(written.value);
    let skipDisabled = false;
    if (config.skipTlsVerify && !centralHostIsLoopback(written.value)) {
      upsertSkipTlsVerify(false);
      setSkipTlsVerify(false);
      skipDisabled = true;
    }
    central.resetUpstreamAgent();
    res.json({
      ok: true,
      centralBaseUrl: config.facemeBaseUrl,
      skipTlsVerify: Boolean(config.skipTlsVerify),
      skipTlsAutoDisabled: skipDisabled,
      applied: 'immediate',
      bak: Boolean(written.bak),
      note: skipDisabled
        ? '已更新 Central 位址。因新位址不是本機 loopback，已自動關閉「略過自簽憑證」並寫回 .env。'
        : '已寫入 .env 並立即套用（無需重啟）。未讀取或回傳密碼。可用連線測試驗證。'
    });
  } catch (e) {
    next(e);
  }
});


router.put('/local-settings/skip-tls-verify', express.json({ limit: '4kb' }), (req, res, next) => {
  try {
    assertLocalAdmin(req, { mutate: true });
    const enabled = Boolean(req.body && req.body.enabled === true);
    if (enabled && !canEnableSkipTlsVerify(config.facemeBaseUrl)) {
      const err = new Error(
        '僅當 Central 位址是 127.0.0.1、::1 或 localhost 時才能略過自簽憑證檢查。目前 FACEME_BASE_URL=' +
          (config.facemeBaseUrl || '(空)') +
          '。請先把 Central 改成本機位址，或改為信任正式 CA。'
      );
      err.code = 'SKIP_TLS_NOT_LOOPBACK';
      err.status = 400;
      throw err;
    }
    const written = upsertSkipTlsVerify(enabled);
    setSkipTlsVerify(enabled);
    central.resetUpstreamAgent();
    res.json({
      ok: true,
      skipTlsVerify: Boolean(config.skipTlsVerify),
      applied: 'immediate',
      bak: Boolean(written.bak),
      note: enabled
        ? '已開啟略過自簽憑證（僅本機 Central）。有中間人風險；連線測試的 skipTlsVerify 應為 true。'
        : '已關閉略過自簽憑證，恢復驗證。'
    });
  } catch (e) {
    next(e);
  }
});



router.put('/local-settings/lan-access', express.json({ limit: '4kb' }), async (req, res, next) => {
  try {
    assertLocalAdmin(req, { mutate: true });
    const enabled = Boolean(req.body && req.body.enabled === true);
    const written = upsertLanAccess(enabled);
    setLanAccess(enabled);
    const wantHost = listenHost();
    let rebound = false;
    let restartRequired = false;
    let rebindError = null;
    const server = getHttpServer();
    if (!server) {
      restartRequired = true;
    } else {
      // Reuse the request app (same Express instance)
      const expressApp = req.app;
      const result = await rebindListen(expressApp, config.port, wantHost);
      rebound = Boolean(result.rebound && result.ok);
      restartRequired = Boolean(result.restartRequired) || !result.ok;
      rebindError = result.error || null;
    }
    const urls = enabled ? phoneUrls(config.port) : [];
    let note;
    if (enabled && restartRequired) {
      note = '已寫入 .env（FACEME_LAN_ACCESS=1）。請關閉後重新執行 start.bat，讓伺服器改聽 0.0.0.0。';
    } else if (enabled) {
      note =
        '已開啟手機連線（區網），本機改聽 0.0.0.0。請用下列網址在同一 Wi-Fi 的 iPhone 開啟。' +
        (urls.length ? ' ' + urls.join(' ') : '') +
        ' ' +
        FIREWALL_NOTE;
    } else if (restartRequired) {
      note = '已關閉區網連線並寫入 .env。請重開 start.bat，讓伺服器只聽 127.0.0.1。';
    } else {
      note = '已關閉手機連線（區網），僅本機 127.0.0.1 可連。';
    }
    res.json({
      ok: true,
      lanAccess: Boolean(config.lanAccess),
      listenHost: wantHost,
      phoneUrls: urls,
      applied: rebound ? 'immediate' : 'env-written',
      rebound: rebound,
      restartRequired: restartRequired,
      rebindError: rebindError,
      bak: Boolean(written.bak),
      lanFirewallNote: FIREWALL_NOTE,
      note: note
    });
  } catch (e) {
    next(e);
  }
});


router.get('/groups', async (req, res, next) => {
  try {
    // Read-only list: needs Central credentials, does NOT require real-mode write flags.
    // Tokens never leave the server.
    assertCentralCredentials();
    const token = await central.signIn();
    const groups = await central.listGroups(token);
    res.json({
      ok: true,
      groups: groups,
      guessed: false,
      note:
        '群組列表：POST /api/website/group/list（分頁）。權杖不會回傳給瀏覽器。系統內建群組不可刪改。'
    });
  } catch (e) {
    next(e);
  }
});

router.post('/groups/probe', express.json({ limit: '4kb' }), async (req, res, next) => {
  try {
    assertCentralCredentials();
    const token = await central.signIn();
    const probe = await central.probeGroups(token);
    res.json(probe);
  } catch (e) {
    next(e);
  }
});

router.post('/connection-test', express.json({ limit: '8kb' }), async (req, res, next) => {
  try {
    // Allowed even when FACEME_REAL_MODE=0. Does not change write gates.
    const attemptLogin = Boolean(req.body && req.body.attemptLogin === true);
    const result = await central.connectionProbe({ attemptLogin });
    res.json({
      appVersion: config.appVersion,
      note:
        '連線測試 ≠ /api/health。health 只表示本機薄後端存活；此測試探測 .env 的 Central base（可選登入）。不寫入、不做 QC／import。',
      ...result
    });
  } catch (e) {
    next(e);
  }
});

router.post('/consent', express.json({ limit: '32kb' }), (req, res, next) => {
  try {
    const agreed = req.body && req.body.agreed === true;
    const statementVersion = req.body && req.body.statementVersion;
    if (!agreed) {
      const err = new Error('必須明確同意（agreed: true）');
      err.code = 'CONSENT_NOT_EXPLICIT';
      err.status = 400;
      throw err;
    }
    if (!statementVersion) {
      const err = new Error('缺少 statementVersion');
      err.code = 'STATEMENT_VERSION_REQUIRED';
      err.status = 400;
      throw err;
    }
    const issued = issueTicket(statementVersion);
    res.json(issued);
  } catch (e) {
    next(e);
  }
});

router.post('/register', upload.single('image'), async (req, res, next) => {
  let imageBuffer = null;
  try {
    assertRealModeReady();

    // Validate inputs BEFORE consuming consent ticket (avoid burning tickets on 400s)
    const name = validateName(req.body && req.body.name);
    const employeeId = validateEmployeeId(req.body && req.body.employeeId);
    const groupName = validateGroupName(
      (req.body && (req.body.groupName || req.body.group)) || ''
    );
    const groupColor = (req.body && req.body.groupColor) || undefined;
    const groupPatternId =
      (req.body && (req.body.groupPatternId || req.body.patternId)) || undefined;
    const imgMeta = validateImageFile(req.file);
    imageBuffer = req.file.buffer;

    // Optional information JSON fields (official person import)
    const information = {};
    for (const key of ['email', 'company', 'title', 'note']) {
      const v = req.body && req.body[key];
      if (typeof v === 'string' && v.trim()) information[key] = v.trim();
    }
    const infoPayload = Object.keys(information).length ? information : undefined;

    const ticket = req.body && req.body.consentTicket;
    consumeTicket(ticket, config.statementVersion);

    const token = await central.signIn();
    const qc = await central.snapshotQc(
      token,
      imageBuffer,
      imgMeta.filename,
      imgMeta.mime
    );
    if (!qc.pass) {
      const err = new Error('人臉品質檢查未通過，已取消匯入');
      err.code = qc.code || 'QC_FAIL';
      err.status = 422;
      err.reasons = Array.isArray(qc.reasons) ? qc.reasons : [];
      err.techDetails = qc.techDetails != null ? qc.techDetails : null;
      throw err;
    }

    // Resolve group: match existing (case-insensitive) or create then import with official groupId only
    let groups = [];
    try {
      groups = await central.listGroups(token);
    } catch (listErr) {
      groups = [];
    }
    let group = findGroupByName(groups, groupName);
    let groupCreated = false;
    if (!group) {
      try {
        group = await central.createGroup(token, groupName, groupColor, groupPatternId);
        groupCreated = true;
      } catch (createErr) {
        const err = new Error(
          '無法建立群組「' +
            groupName +
            '」，已取消匯入：' +
            ((createErr && createErr.message) || '建立失敗')
        );
        err.code = (createErr && createErr.code) || 'GROUP_CREATE_FAILED';
        err.status = 502;
        err.reasons = [
          {
            id: 'group_create_failed',
            text: err.message,
            hint: '請先在 Central 手動建立同名群組，或確認顏色／圖示編號（create 需 name+color+patternId）。若見 HTTP 415，薄後端會自動改試 multipart／form／json。'
          }
        ];
        err.techDetails = createErr && createErr.techDetails ? createErr.techDetails : null;
        if (createErr && createErr.encodingAttempts) {
          err.encodingAttempts = createErr.encodingAttempts;
          if (err.techDetails && typeof err.techDetails === 'object') {
            err.techDetails = Object.assign({}, err.techDetails, {
              encodingAttempts: createErr.encodingAttempts
            });
          } else if (!err.techDetails) {
            err.techDetails = { encodingAttempts: createErr.encodingAttempts };
          }
        }
        throw err;
      }
    }

    if (!group || group.id == null || group.id === '') {
      const err = new Error('群組缺少 id，無法匯入（官方匯入欄位為 groupId）');
      err.code = 'GROUP_ID_REQUIRED';
      err.status = 502;
      throw err;
    }

    const imported = await central.personImport(token, {
      name,
      employeeId,
      imageBuffer,
      filename: imgMeta.filename,
      mime: imgMeta.mime,
      groupId: group.id,
      information: infoPayload
    });
    const personId = typeof imported === 'object' ? imported.personId : imported;
    const techDetails = typeof imported === 'object' ? imported.techDetails : null;
    const detailUrl = buildUserDetailUrl(config.facemeBaseUrl, personId);

    // Drop buffer reference ASAP
    imageBuffer = null;
    if (req.file) req.file.buffer = null;

    res.json({
      personId,
      mode: 'real',
      imported: true,
      message: '已成功匯入 Central',
      group: { id: group.id, name: group.name || groupName, created: groupCreated },
      detailUrl: detailUrl,
      techDetails: techDetails
    });
  } catch (e) {
    imageBuffer = null;
    if (req.file) req.file.buffer = null;
    next(e);
  }
});

module.exports = router;
