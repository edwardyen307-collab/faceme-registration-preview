'use strict';

const express = require('express');
const multer = require('multer');
const {
  config,
  assertRealModeReady,
  setFacemeBaseUrl,
  setSkipTlsVerify,
  canEnableSkipTlsVerify
} = require('../config');
const { issueTicket, consumeTicket } = require('../consent');
const { validateName, validateEmployeeId, validateImageFile } = require('../validate');
const central = require('../central/client');
const {
  validateCentralBaseUrl,
  upsertFacemeBaseUrl,
  upsertSkipTlsVerify,
  centralHostIsLoopback
} = require('../env-file');
const { assertLocalAdmin, localAdminToken } = require('../local-admin');

const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: config.maxUploadBytes,
    files: 1,
    fields: 10
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

    const ticket = req.body && req.body.consentTicket;
    consumeTicket(ticket, config.statementVersion);

    const name = validateName(req.body && req.body.name);
    const employeeId = validateEmployeeId(req.body && req.body.employeeId);
    const imgMeta = validateImageFile(req.file);
    imageBuffer = req.file.buffer;

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
      throw err;
    }

    const personId = await central.personImport(token, {
      name,
      employeeId,
      imageBuffer,
      filename: imgMeta.filename,
      mime: imgMeta.mime
    });

    // Drop buffer reference ASAP
    imageBuffer = null;
    if (req.file) req.file.buffer = null;

    res.json({ personId, mode: 'real' });
  } catch (e) {
    imageBuffer = null;
    if (req.file) req.file.buffer = null;
    next(e);
  }
});

module.exports = router;
