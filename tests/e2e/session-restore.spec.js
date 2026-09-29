// F1 / R1 (HANDOFF.md, 29 Sep 2026): relaunching the app with no session
// token. Reproduces what a real shop hit at 15:10-15:17 IST — thrown to the
// login page shortly after every login.
//
// Mechanism (traced by stack capture, 29 Sep): the 12h bearer token lives in
// sessionStorage (05-auth-login.js:105), which is empty in every new browsing
// context — i.e. every time the installed PWA is relaunched from its icon or
// the OS kills the backgrounded process. The 7-day login marker (AUTH_KEY)
// and the PIN "last active" stamp live in localStorage and survive. So:
//   - relaunch within INACTIVITY_MS of last use: isPinSessionActive() is true
//     (04-orders-detail.js:752), proceedWithSession() calls doStartApp(),
//     which paints the cached dashboard and calls loadFromCloud() with an
//     empty x-session-token -> 401 -> saasForceLogout() -> login page.
//   - relaunch after INACTIVITY_MS: PIN screen first; the user enters their
//     PIN, then the same empty-token 401 throws them out anyway.
//
// These specs pin the part of F1 that does not depend on the token-storage
// decision: with no token, the app must know it locally and go straight to
// login — no dashboard flash, no PIN prompt it can't honour, no request it
// knows will be refused.
const { test, expect } = require('@playwright/test');
const { login } = require('./fixtures/testShop');

function watchEmptyTokenRequests(page) {
  const hits = [];
  page.on('request', (req) => {
    if (req.url().includes('/store-proxy') && !(req.headers()['x-session-token'] || '')) {
      hits.push(req.method() + ' ' + req.url());
    }
  });
  return hits;
}

async function relaunchWithoutToken(page, { idleBeyondPinWindow }) {
  await page.evaluate((idle) => {
    // New browsing context: sessionStorage is empty, localStorage survives.
    sessionStorage.clear();
    if (idle) {
      var shopId = JSON.parse(localStorage.getItem('jewelos_session')).shopId;
      localStorage.setItem('ssj_last_active::' + shopId, String(Date.now() - 60 * 60 * 1000));
    }
  }, idleBeyondPinWindow);
  await page.reload();
}

async function expectLoginWithNotice(page) {
  await expect(page.locator('#auth-email')).toBeVisible({ timeout: 10000 });
  await expect(page.locator('#auth-login-err')).toContainText(/sign in again/i, { timeout: 10000 });
  await expect(page.getByRole('button', { name: /sign out/i })).not.toBeVisible();
}

test.describe('relaunch with no session token (F1 / R1)', () => {
  test('recently active: goes to login without calling store-proxy on an empty token', async ({ page }) => {
    await login(page);
    const emptyTokenCalls = watchEmptyTokenRequests(page);
    await relaunchWithoutToken(page, { idleBeyondPinWindow: false });
    await expectLoginWithNotice(page);
    expect(emptyTokenCalls, 'store-proxy was called with an empty token').toEqual([]);
  });

  test('idle past the PIN window: goes to login, not the PIN screen', async ({ page }) => {
    await login(page);
    const emptyTokenCalls = watchEmptyTokenRequests(page);
    await relaunchWithoutToken(page, { idleBeyondPinWindow: true });
    await expect(page.locator('#pin-screen')).toBeHidden({ timeout: 5000 });
    await expectLoginWithNotice(page);
    expect(emptyTokenCalls).toEqual([]);
  });
});
