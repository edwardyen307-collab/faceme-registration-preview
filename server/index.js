'use strict';

const path = require('path');
const fs = require('fs');
const express = require('express');
const rateLimit = require('express-rate-limit');
const { config } = require('./config');
const { corsMiddleware } = require('./middleware/cors');
const { errorHandler } = require('./middleware/errors');
const apiRouter = require('./routes/api');
const { accessGateMiddleware, listenHost, phoneUrls, FIREWALL_NOTE, isLoopbackPageRequest, stripLocalOnlyHtml } = require('./lan-access');
const { setHttpServer } = require('./http-bind');

function createApp() {
  const app = express();
  app.disable('x-powered-by');
  app.set('trust proxy', false);

  app.use(accessGateMiddleware);
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

  const HTML_PAGES = {
    '/': 'index.html',
    '/index.html': 'index.html',
    '/index': 'index.html',
    '/register.html': 'register.html',
    '/register': 'register.html'
  };

  function sendFilteredHtml(req, res, fileName) {
    const filePath = path.join(config.publicRoot, fileName);
    fs.readFile(filePath, 'utf8', function (err, html) {
      if (err) {
        res.status(err.code === 'ENOENT' ? 404 : 500).type('text').send('頁面讀取失敗');
        return;
      }
      if (!isLoopbackPageRequest(req)) {
        html = stripLocalOnlyHtml(html);
      }
      res.setHeader('Content-Type', 'text/html; charset=utf-8');
      res.setHeader('Cache-Control', 'no-store');
      res.send(html);
    });
  }

  app.get(Object.keys(HTML_PAGES), function (req, res) {
    const name = HTML_PAGES[req.path] || HTML_PAGES[(req.path || '').replace(/\/$/, '') || '/'];
    sendFilteredHtml(req, res, name || 'index.html');
  });

  // Static frontend (same origin recommended for intranet HTTPS)
  app.use(
    express.static(config.publicRoot, {
      index: false,
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
  if (config.envDiagnostics) {
    const d = config.envDiagnostics;
    console.log(
      '[env] path=' +
        d.envPath +
        ' found=' +
        d.envFound +
        ' envTxt=' +
        d.envTxtFound +
        ' skipTlsVerify=' +
        config.skipTlsVerify
    );
    if (d.duplicateKeys && Object.keys(d.duplicateKeys).length) {
      console.warn('[env] duplicate keys in .env: ' + JSON.stringify(d.duplicateKeys));
    }
    if (d.systemOwnedKeys && d.systemOwnedKeys.length) {
      console.warn('[env] system/user env overrides .env for: ' + d.systemOwnedKeys.join(', '));
    }
    (d.warnings || []).forEach(function (w) {
      console.warn('[env] ' + w);
    });
  }
  const app = createApp();
  const bind = listenHost();
  const server = app.listen(config.port, bind, () => {
    setHttpServer(server);
    console.log(
      `FaceMe thin backend ${config.appVersion} listening http://${bind}:${config.port}`
    );
    console.log(
      `statement=${config.statementVersion} realModeEnabled=${config.realModeEnabled} lanAccess=${config.lanAccess}`
    );
    if (config.lanAccess) {
      const urls = phoneUrls(config.port);
      console.log('LAN access ON. Phone URL(s) (same Wi-Fi):');
      if (urls.length) {
        urls.forEach(function (u) {
          console.log('  ' + u);
        });
      } else {
        console.log('  (no RFC1918 IPv4 found — check Wi-Fi adapter)');
      }
      console.log(FIREWALL_NOTE);
    } else {
      console.log('LAN access OFF. Only http://127.0.0.1:' + config.port + '/ is reachable.');
    }
    console.log(
      'Intranet trial only — restrict by ACL; do not publish to the Internet.'
    );
  });
  setHttpServer(server);
  return server;
}

if (require.main === module) {
  start();
}

module.exports = { createApp, start, config };
