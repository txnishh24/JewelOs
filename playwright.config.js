// Playwright config for JewelOS e2e tests.
// See tests/e2e/README.md for what this suite covers and why it exists.
require('dotenv').config({ path: require('path').resolve(__dirname, '.env.test') });

const { defineConfig, devices } = require('@playwright/test');

const PORT = process.env.E2E_STATIC_PORT || 4173;
const BASE_URL = `http://localhost:${PORT}`;

module.exports = defineConfig({
  testDir: './tests/e2e',
  fullyParallel: false, // all specs share ONE live test shop — see README on why serial is deliberate
  workers: 1,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  timeout: 30 * 1000,
  reporter: process.env.CI ? [['list'], ['html', { open: 'never' }]] : [['list'], ['html', { open: 'never' }]],

  use: {
    baseURL: BASE_URL,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
    // JewelOS is built for Indian jewellery shops — dates, currency and the
    // known UTC-vs-IST bug (see invoice-date.spec.js) only make sense tested
    // in the timezone/locale the app is actually used in.
    timezoneId: 'Asia/Kolkata',
    locale: 'en-IN',
  },

  projects: [
    {
      name: 'chromium',
      // JewelOS's bottom nav (#bn-*, what goToTab() in fixtures/testShop.js
      // clicks) only renders below the app's 639px breakpoint (index.html's
      // .bnav rule) — above that it shows a separate desktop tab bar
      // instead. This suite stands in for phone testing (see README), so
      // the viewport needs to stay under that breakpoint or every
      // goToTab() call finds a display:none element.
      use: { ...devices['Desktop Chrome'], viewport: { width: 393, height: 851 } },
    },
  ],

  webServer: {
    command: `node tests/e2e/static-server.js ${PORT}`,
    url: BASE_URL,
    reuseExistingServer: !process.env.CI,
    timeout: 10 * 1000,
  },
});
