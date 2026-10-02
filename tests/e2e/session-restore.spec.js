// F1 / R1 (HANDOFF.md, 29 Sep 2026): reopening the app.
//
// Before: the bearer token lived only in sessionStorage, which is empty on
// every reopen of the installed PWA (and whenever Android kills it in the
// background), while the login marker survived in localStorage. Every reopen
// painted the cached dashboard, called store-proxy with an empty token, got
// 401 and was thrown to login — what a real shop hit at 15:10-15:17 IST.
//
// Tanish chose option B (29 Sep): the token is kept with the session record
// in localStorage for its server-issued life (6 h), so a reopen resumes —
// through the PIN screen when idle past INACTIVITY_MS — and an expired
// session goes straight to login with a reason, without asking store-proxy.
const { test, expect } = require('@playwright/test');
const { login, shop } = require('./fixtures/testShop');

function watchEmptyTokenRequests(page) {
  const hits = [];
  page.on('request', (req) => {
    if (req.url().includes('/store-proxy') && !(req.headers()['x-session-token'] || '')) {
      hits.push(req.method() + ' ' + req.url());
    }
  });
  return hits;
}

function watchStoreProxy(page) {
  const hits = [];
  page.on('request', (req) => { if (req.url().includes('/store-proxy')) hits.push(req.method()); });
  return hits;
}

// Reopen: sessionStorage empty (new browsing context), localStorage survives.
async function reopen(page, { idle = false, expired = false } = {}) {
  await page.evaluate(({ idle, expired }) => {
    sessionStorage.clear();
    var rec = JSON.parse(localStorage.getItem('jewelos_session'));
    if (idle) localStorage.setItem('ssj_last_active::' + rec.shopId, String(Date.now() - 60 * 60 * 1000));
    if (expired) { rec.exp = Date.now() - 1000; localStorage.setItem('jewelos_session', JSON.stringify(rec)); }
  }, { idle, expired });
  await page.reload();
}

const signOutBtn = (page) => page.getByRole('button', { name: /sign out/i }).first();

test.describe('reopening the app (F1 / R1)', () => {
  test('recently active: resumes straight into the app with a working token', async ({ page }) => {
    await login(page);
    const emptyTokenCalls = watchEmptyTokenRequests(page);
    const loadOk = page.waitForResponse((r) => r.url().includes('/store-proxy') && r.request().method() === 'GET');
    await reopen(page);
    expect((await loadOk).status()).toBe(200);
    await expect(signOutBtn(page)).toBeVisible({ timeout: 10000 });
    await expect(page.locator('#auth-email')).not.toBeVisible();
    expect(emptyTokenCalls).toEqual([]);
  });

  test('idle past the PIN window: PIN screen, and the PIN gets you back in', async ({ page }) => {
    await login(page);
    await page.evaluate((pin) => window._doSetPin(pin), shop.pin);
    const emptyTokenCalls = watchEmptyTokenRequests(page);
    await reopen(page, { idle: true });
    await expect(page.locator('#pin-screen')).toBeVisible({ timeout: 10000 });
    for (const d of shop.pin) await page.locator('#pin-pad').getByText(d, { exact: true }).click();
    await expect(page.locator('#pin-screen')).toBeHidden({ timeout: 5000 });
    await expect(signOutBtn(page)).toBeVisible({ timeout: 10000 });
    await page.waitForTimeout(2000); // let the post-unlock cloud load land
    await expect(page.locator('#auth-email')).not.toBeVisible();
    expect(emptyTokenCalls).toEqual([]);
  });

  test('login expires mid-work: a save waits for the password, then goes through', async ({ page }) => {
    await login(page);
    // Opus review 2 Oct: a post-login load can trigger migrateLockRates()'s
    // own background save (01-sync-core.js); if that's still in flight when
    // the token is swapped below, this test's own saveToCloud() call queues
    // behind it in the isSaving 400ms loop, and can miss the 10s overlay
    // deadline -- a test race, not a product bug. Wait for any such save to
    // finish first, same as test 4 already does for the invoice-number pool.
    await page.waitForFunction(() => {
      try { return !isSaving && JSON.parse(localStorage.getItem(invPoolKey()) || '[]').length >= INV_POOL_SIZE; } catch (e) { return false; }
    }, null, { timeout: 30000 });
    // Simulate the 6 h running out while the app is open: the server now
    // rejects the token this tab holds.
    await page.evaluate(() => { SAAS.sessionToken = 'expired.token'; });
    const saved = page.evaluate(() => new Promise((r) => saveToCloud((e) => r(e ? e.message : 'saved'))));

    const overlay = page.locator('#reauth-overlay');
    await expect(overlay).toBeVisible({ timeout: 10000 });
    await expect(page.locator('#auth-email')).not.toBeVisible(); // not thrown out to login
    // No wrong-password step here: auth-gateway locks an email after 5 failed
    // logins in 15 min (success does not reset it) and auth.spec.js already
    // spends one per run. The wrong-password path is covered in
    // tests/regression.test.js against a fake server.
    await page.locator('#reauth-password').fill(shop.password);
    await page.locator('#reauth-submit').click();
    await expect(overlay).toBeHidden({ timeout: 15000 });
    expect(await saved).toBe('saved');
    await expect(signOutBtn(page)).toBeVisible();
  });

  test('token expired while closed: login with a reason, no PIN, no store-proxy call', async ({ page }) => {
    await login(page);
    // batch44: after a load the app reserves offline invoice numbers in the
    // background. Let that finish first, so only calls made by the reopen count.
    await page.waitForFunction(() => {
      try { return JSON.parse(localStorage.getItem(invPoolKey()) || '[]').length >= INV_POOL_SIZE; } catch (e) { return false; }
    }, null, { timeout: 30000 });
    const calls = watchStoreProxy(page);
    await reopen(page, { expired: true });
    await expect(page.locator('#auth-email')).toBeVisible({ timeout: 10000 });
    await expect(page.locator('#auth-login-err')).toContainText(/expired.*sign in again/i);
    await expect(page.locator('#pin-screen')).toBeHidden();
    await expect(signOutBtn(page)).not.toBeVisible();
    expect(calls).toEqual([]);
    // The shop's cached copy goes with the session, same as a forced sign-out.
    expect(await page.evaluate(() => localStorage.getItem('ssj_cache'))).toBeNull();
  });
});
