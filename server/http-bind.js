'use strict';

/**
 * Holds the live HTTP server so settings can rebind 127.0.0.1 ↔ 0.0.0.0.
 */

let currentServer = null;

function setHttpServer(server) {
  currentServer = server || null;
}

function getHttpServer() {
  return currentServer;
}

function boundAddress() {
  if (!currentServer || typeof currentServer.address !== 'function') return null;
  return currentServer.address();
}

/**
 * Close current server and listen on host:port with the same app.
 * Returns { ok, listenHost, restartRequired, error }.
 */
function rebindListen(app, port, host) {
  const wantHost = host;
  const wantPort = Number(port);

  function listenFresh() {
    return new Promise((resolve, reject) => {
      const s = app.listen(wantPort, wantHost, () => {
        s.removeListener('error', reject);
        currentServer = s;
        resolve(s);
      });
      s.once('error', reject);
    });
  }

  return new Promise((resolve) => {
    const old = currentServer;
    currentServer = null;
    if (!old) {
      listenFresh()
        .then(() => resolve({ ok: true, listenHost: wantHost, rebound: true, restartRequired: false }))
        .catch((e) =>
          resolve({
            ok: false,
            listenHost: wantHost,
            rebound: false,
            restartRequired: true,
            error: e && e.message ? e.message : String(e)
          })
        );
      return;
    }

    const finishClose = () => {
      setTimeout(() => {
        listenFresh()
          .then(() => resolve({ ok: true, listenHost: wantHost, rebound: true, restartRequired: false }))
          .catch((e) =>
            resolve({
              ok: false,
              listenHost: wantHost,
              rebound: false,
              restartRequired: true,
              error: e && e.message ? e.message : String(e)
            })
          );
      }, 50);
    };

    try {
      if (typeof old.closeAllConnections === 'function') old.closeAllConnections();
    } catch (_) {}
    old.close((err) => {
      if (err) {
        resolve({
          ok: false,
          listenHost: wantHost,
          rebound: false,
          restartRequired: true,
          error: err.message || String(err)
        });
        return;
      }
      finishClose();
    });
  });
}

module.exports = {
  setHttpServer,
  getHttpServer,
  boundAddress,
  rebindListen
};
