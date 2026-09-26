// Login, logout, and the owner-PIN gate on Settings.
// Walks the flow listed for 05-auth-login.js in skills/verify-ui.md.
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

  test('owner PIN gates Settings', async ({ page }) => {
    const { login, goToTab } = require('./fixtures/testShop');
    await login(page);

    await goToTab(page, 'settings');

    // Wrong PIN first — 4 digits that are NOT the real one.
    await expect(page.getByText('OWNER ACCESS ONLY')).toBeVisible({ timeout: 10000 });
    const wrongDigits = shop.pin === '1111' ? '2222' : '1111';
    const pinPad = page.locator('#pin-pad');
    for (const d of wrongDigits) {
      await pinPad.getByText(d, { exact: true }).click();
    }
    await expect(page.getByText('Shop Profile')).not.toBeVisible();

    // The pad should have reset after a wrong PIN (own retry UX) — re-enter
    // the correct one from scratch.
    for (const d of shop.pin) {
      await pinPad.getByText(d, { exact: true }).click();
    }
    await expect(page.getByText('Shop Profile')).toBeVisible({ timeout: 10000 });
  });
});
