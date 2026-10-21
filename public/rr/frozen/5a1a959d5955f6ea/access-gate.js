/* Red Room: small, dependency-free Telegram Serverless API adapter.
   No Telegram API credentials or user IDs are accepted from the browser.
   The endpoint checks ctx.initData and Bot API membership server-side.
*/
(function (root) {
  'use strict';

  const TIMEOUT_MS = 15000;

  function verify() {
    const telegram = root.Telegram?.WebApp;
    if (!telegram?.initData || typeof telegram.Serverless?.call !== 'function') {
      return Promise.resolve({ kind: 'unavailable' });
    }

    return new Promise(resolve => {
      let settled = false;
      const finish = result => {
        if (settled) return;
        settled = true;
        root.clearTimeout(timer);
        resolve(result);
      };
      const timer = root.setTimeout(() => finish({ kind: 'error', code: 'TIMEOUT' }), TIMEOUT_MS);

      try {
        telegram.Serverless.call('checkAccess', {}, (error, result) => {
          if (error) {
            finish({ kind: 'error', code: error.parameters?.code || error.type || 'CHECK_FAILED' });
            return;
          }
          if (result?.allowed === true) {
            finish({ kind: 'allowed' });
          } else if (result?.allowed === false) {
            finish({ kind: 'denied' });
          } else {
            finish({ kind: 'error', code: 'INVALID_RESPONSE' });
          }
        });
      } catch (_) {
        finish({ kind: 'error', code: 'CALL_FAILED' });
      }
    });
  }

  root.RedRoomAccess = Object.freeze({ verify });
})(window);
