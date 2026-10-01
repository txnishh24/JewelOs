// Shared test-shop credentials and small helpers used across every spec.
//
// IMPORTANT: every spec in this suite runs against the SAME live, permanent
// shop ("E2E Test Shop (do not delete)") on the real production Supabase
// backend — there is no local/offline mode for JewelOS to test against.
// See tests/e2e/README.md for why, and for the isolation rule that makes
// this safe: every piece of data a test creates gets an `E2E-<runId>`
// marker in its name/description so runs never collide or get mistaken
// for real shop data.

const shop = {
  email: process.env.E2E_SHOP_EMAIL,
  password: process.env.E2E_SHOP_PASSWORD,
  pin: process.env.E2E_SHOP_PIN,
  name: process.env.E2E_SHOP_NAME || 'E2E Test Shop (do not delete)',
};

for (var key of ['email', 'password', 'pin']) {
  if (!shop[key]) {
    throw new Error(
      'Missing E2E_SHOP_' + key.toUpperCase() + ' — copy .env.test.example to .env.test ' +
      'and fill in the test shop credentials (see tests/e2e/README.md).'
    );
  }
}

// One marker per test run so parallel/repeated runs never collide and
// test data is trivially identifiable (and grep-able) in the live shop.
function runId() {
  return 'E2E-' + Date.now().toString(36);
}

// The bottom nav's "Powered by Netlify" badge is a KNOWN, currently-live bug
// (see docs/TESTING-STRATEGY.md / HANDOFF.md, confirmed live 26 Sep 2026):
// it renders on top of the Day Book / Reports nav buttons at narrow viewport
// widths and swallows the first tap. It is a hosting/deploy issue, not an
// app bug, and dismissing it once (clicking its own close button) keeps it
// away for the rest of the session. Specs that navigate the bottom nav call
// this first so the badge doesn't make an unrelated test flaky.
async function dismissNetlifyBadge(page) {
  const closeBtn = page.getByRole('button', { name: /close/i }).last();
  const badge = page.getByText('Powered by Netlify');
  if (await badge.isVisible().catch(() => false)) {
    // The badge widget's own "✕" — try a couple of ways to find it since
    // it's third-party markup we don't control.
    const netlifyClose = page.locator('text=Powered by Netlify').locator('..').getByRole('button');
    if (await netlifyClose.count()) {
      await netlifyClose.first().click().catch(() => {});
    } else {
      await closeBtn.click().catch(() => {});
    }
  }
}

// The "What's New" changelog modal (showV18Changelog, js/08-girvi-viewmode.js)
// fires 2s after every login (js/05-auth-login.js bootApp), gated by a
// localStorage "seen" flag — every Playwright context starts with empty
// storage, so it fires on EVERY test run here, then sits full-screen
// (z-index 2000) over everything until its own button dismisses it. Confirmed
// this is what was blocking girvi.spec.js's #gf-next-btn and sale.spec.js's
// #mode-btn-custom clicks (Playwright reported "<div id="v18-modal"> intercepts
// pointer events"), 27 Sep 2026.
async function dismissV18Modal(page) {
  try {
    await page.locator('#v18-modal').waitFor({ state: 'visible', timeout: 3000 });
    await page.getByRole('button', { name: /got it/i }).click();
  } catch (e) {
    // Didn't show within the window — nothing to dismiss.
  }
}

// Logs in as the test shop owner and waits for the dashboard. Every spec but
// auth.spec.js starts here — auth.spec.js tests the login form itself, so it
// fills it in by hand instead of using this helper.
async function login(page) {
  await page.goto('/');
  await page.locator('#auth-email').fill(shop.email);
  await page.locator('#auth-password').fill(shop.password);
  await page.locator('.auth-btn').filter({ hasText: /sign in/i }).click();
  await page.getByRole('button', { name: /sign out/i }).waitFor({ timeout: 15000 });
  await dismissNetlifyBadge(page);
  await dismissV18Modal(page);
  await confirmRatesOnce(page);
}

// batch40 (QA 1 Oct P1-6): a shop still on the sample rates may not bill or
// open a Girvi until the owner saves rates. The test shop never had, so the
// first run after batch40 saves its current rates once through the real
// Stock-tab button; later runs skip this (S.rates.setAt is stored).
async function confirmRatesOnce(page) {
  if (await page.evaluate(() => ratesConfirmed())) return;
  await goToTab(page, 'stock');
  await page.locator('.rate-save').click();
  await page.getByText(/Rates saved/i).first().waitFor({ timeout: 15000 });
  await goToTab(page, 'home');
}

// Bottom-nav tab ids, captured from the live DOM (26 Sep 2026). The app
// renders every panel up front (see the note atop auth.spec.js), so these
// are the stable handles — the visible LABEL text ("DAY BOOK" etc.) is
// css text-transform, not the real text, and isn't reliable across builds.
const TAB_ID = {
  home: '#bn-dashboard',
  stock: '#bn-inventory',
  sale: '#bn-sales',
  girvi: '#bn-girvi',
  orders: '#bn-orders',
  customers: '#bn-customers',
  reports: '#bn-reports',
  daybook: '#bn-daybook',
  settings: '#bn-settings',
};

// Clicks a bottom-nav tab (see TAB_ID for the valid keys), dismissing the
// Netlify badge first — see dismissNetlifyBadge for why that matters
// specifically for this click (the badge sits on top of this same row).
async function goToTab(page, key) {
  await dismissNetlifyBadge(page);
  await page.locator(TAB_ID[key]).click();
}

module.exports = { shop, runId, dismissNetlifyBadge, dismissV18Modal, login, goToTab, TAB_ID };
