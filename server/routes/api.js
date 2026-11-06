'use strict';

const express = require('express');
const multer = require('multer');
const { config, assertRealModeReady } = require('../config');
const { issueTicket, consumeTicket } = require('../consent');
const { validateName, validateEmployeeId, validateImageFile } = require('../validate');
const central = require('../central/client');

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
    realModeEnabled: config.realModeEnabled,
    realModeFlag: config.realModeFlag,
    legalConfirmed: config.legalConfirmed,
    // Never expose account/password/base secrets beyond "configured?" booleans
    upstreamConfigured: Boolean(config.facemeBaseUrl && config.facemeAccount),
    note:
      '本機薄後端存活檢查（非 Central 連線測試）。API shape 待內網驗證。同機請用 http://127.0.0.1:PORT/ 。'
  });
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
