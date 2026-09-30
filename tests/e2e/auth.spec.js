// Login, logout, and the app-wide PIN lock screen.
// Walks the flow listed for 05-auth-login.js in skills/verify-ui.md.
//
// Rewritten 27 Sep 2026 per HANDOFF.md: the PIN screen (#pin-screen) is
// lockApp()'s app-wide inactivity/session lock (js/04-orders-detail.js,
// `ssj_unlocked`), re-triggered after ~3 min idle — it is NOT a
// Settings-specific gate (there is no such thing; nothing in the app asks
// for a PIN just to open the Settings tab). The old version of this test
// asserted a gate that was never built. This version idles past the real
// 3-minute inactivity window (via Playwright's fake clock, so the test
// doesn't actually wait 3 minutes) and asserts the lock blocks the whole
// app, not any one tab.
//
// Selector note: JewelOS renders every screen's markup into the DOM up front
// and toggles visibility (no router/mount-unmount), so several ids repeat
// text but not the id itself — e.g. the login, signup and forgot-password
// forms all have an email field with the SAME placeholder ("you@email.com")
// but different real ids (#auth-email / #signup-email / #forgot-email).
// This suite always selects by the real element id for that reason —
// placeholder/text selectors would hit Playwright's strict-mode "multiple
// elements match" error. Ids were captured directly from the live DOM
// (26 Sep 2026); if a future rebuild renames one, that's the first thing to
// fix when a spec fails.

const { test, expect } = require('@playwright/test');
const { shop } = require('./fixtures/testShop');

test.describe('auth', () => {
  test('shows the login form when signed out', async ({ page }) => {
    await page.goto('/');
    await expect(page.locator('#auth-email')).toBeVisible();
    await expect(page.locator('#auth-password')).toBeVisible();
  });

  test('rejects the wrong password', async ({ page }) => {
    await page.goto('/');
    await page.locator('#auth-email').fill(shop.email);
    await page.locator('#auth-password').fill('definitely-wrong-password');
    await page.locator('.auth-btn').filter({ hasText: /sign in/i }).click();

    // Should NOT reach the dashboard — the password field is still there
    // (whatever the exact error copy is) rather than the shop dashboard.
    await expect(page.locator('#auth-password')).toBeVisible({ timeout: 10000 });
    await expect(page.getByRole('button', { name: /sign out/i })).not.toBeVisible();
  });

  test('logs in with valid credentials and reaches the dashboard', async ({ page }) => {
    await page.goto('/');
    await page.locator('#auth-email').fill(shop.email);
    await page.locator('#auth-password').fill(shop.password);
    await page.locator('.auth-btn').filter({ hasText: /sign in/i }).click();

    await expect(page.getByRole('button', { name: /sign out/i })).toBeVisible({ timeout: 15000 });
    await expect(page.getByText(shop.name)).toBeVisible();
  });

  test('logs out back to the login form', async ({ page }) => {
    const { login } = require('./fixtures/testShop');
    await login(page);

    await page.getByRole('button', { name: /sign out/i }).first().click();
    // saasLogout() routes through the app's own safeConfirm modal, not a
    // native confirm() — the button click only opens it.
    await page.locator('#safe-confirm-ok').click();

    await expect(page.locator('#auth-email')).toBeVisible({ timeout: 10000 });
  });

  test('inactivity locks the whole app behind the PIN screen', async ({ page }) => {
    const { login } = require('./fixtures/testShop');

    // Install the fake clock BEFORE navigating — resetInactivityTimer()'s
    // setTimeout is armed during the post-login boot sequence, and a clock
    // installed later would not know about a timer already scheduled on
    // the real one. Time runs normally (real-time-backed) until fastForward
    // jumps it, so login/dismiss-modal clicks below behave exactly as any
    // other spec's — see Clock docs: "timers run normally... until paused".
    await page.clock.install();
    await login(page);

    // Fresh Playwright context = empty localStorage = isPinSet() is false
    // (it's a device-local flag, not shop data), so login() above landed
    // straight on the dashboard with no PIN prompt — same as every other
    // spec. Set a real device PIN now, via the app's own hashing helper
    // (not a duplicated implementation here), so the lock screen this test
    // triggers next takes the real "Enter PIN" verify path instead of
    // first-time PIN setup.
    await page.evaluate((pin) => window._doSetPin(pin), shop.pin);

    const signOutBtn = page.getByRole('button', { name: /sign out/i }).first();
    await expect(signOutBtn).toBeVisible();

    // Jump past the real 5-minute inactivity window (INACTIVITY_MS,
    // js/01-sync-core.js) in one step instead of actually waiting.
    await page.clock.fastForward('05:05');

    const overlay = page.locator('#inactivity-overlay');
    await expect(overlay).toBeVisible({ timeout: 5000 });
    await overlay.getByRole('button', { name: /enter pin to unlock/i }).click();

    const pinScreen = page.locator('#pin-screen');
    await expect(pinScreen).toBeVisible();
    await expect(page.getByText('Owner Access Only')).toBeVisible();
    // Blocks the whole app, not any one tab — no tab was ever opened here,
    // and the app chrome behind the lock is gone.
    await expect(signOutBtn).not.toBeVisible();

    // Done manipulating time — resume real time so the pad's own short
    // (80ms) verify delay just plays out normally like any other click.
    await page.clock.resume();

    const pinPad = page.locator('#pin-pad');
    const wrongDigits = shop.pin === '1111' ? '2222' : '1111';
    for (const d of wrongDigits) {
      await pinPad.getByText(d, { exact: true }).click();
    }
    await expect(page.getByText('Incorrect PIN. Try again.')).toBeVisible({ timeout: 5000 });
    await expect(pinScreen).toBeVisible();
    await expect(signOutBtn).not.toBeVisible();

    // Pad resets itself after a wrong attempt — re-enter the real PIN.
    for (const d of shop.pin) {
      await pinPad.getByText(d, { exact: true }).click();
    }
    await expect(pinScreen).not.toBeVisible({ timeout: 5000 });
    await expect(signOutBtn).toBeVisible();
  });
});
