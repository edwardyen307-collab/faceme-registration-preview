'use strict';

const path = require('path');
const express = require('express');
const rateLimit = require('express-rate-limit');
const { config } = require('./config');
const { corsMiddleware } = require('./middleware/cors');
const { errorHandler } = require('./middleware/errors');
const apiRouter = require('./routes/api');

function createApp() {
  const app = express();
  app.disable('x-powered-by');
  app.set('trust proxy', false);

  app.use(corsMiddleware);

  app.use(
    rateLimit({
      windowMs: config.rateLimitWindowMs,
      max: config.rateLimitMax,
      standardHeaders: true,
      legacyHeaders: false,
      message: { error: '請求過於頻繁', code: 'RATE_LIMIT' }
    })
  );

  app.use('/api', apiRouter);

  // Static frontend (same origin recommended for intranet HTTPS)
  app.use(
    express.static(config.publicRoot, {
      index: 'index.html',
      extensions: ['html'],
      setHeaders(res, filePath) {
        if (filePath.endsWith('.html')) {
          res.setHeader('Cache-Control', 'no-store');
        }
      }
    })
  );

  app.use(errorHandler);
  return app;
}

function start() {
  if (config.skipTlsVerify) {
    console.warn(
      '[warn] FACEME_SKIP_TLS_VERIFY=1：僅套用至 Central upstream Agent，仍有 MITM 風險；禁止公開暴露此服務。'
    );
  }
  if (config.realModeFlag && !config.legalConfirmed) {
    console.warn(
      '[warn] FACEME_REAL_MODE=1 但 FACEME_STATEMENT_LEGAL_CONFIRMED≠1：真實寫入仍停用。'
    );
  }
  if (config.statementEnvWarning) {
    console.warn('[warn] ' + config.statementEnvWarning);
  }
  const app = createApp();
  const server = app.listen(config.port, config.host, () => {
    console.log(
      `FaceMe thin backend ${config.appVersion} listening http://${config.host}:${config.port}`
    );
    console.log(
      `statement=${config.statementVersion} realModeEnabled=${config.realModeEnabled}`
    );
    console.log(
      'Intranet trial only — restrict by ACL; do not publish to the Internet.'
    );
  });
  return server;
}

if (require.main === module) {
  start();
}

module.exports = { createApp, start, config };
