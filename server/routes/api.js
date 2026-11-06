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
      '依提供規格實作之薄代理；Central API shape 待內網驗證。GitHub Pages 無法直連私網 Central。'
  });
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
