// Regression test for the documented invoice-date bug (docs/TESTING-STRATEGY.md,
// HANDOFF.md 20 Sep 2026 audit): if a bill's date field is populated from
// `toISOString()` instead of the local IST calendar day, every bill opened
// between local midnight and 5:30am IST gets silently dated "yesterday" —
// because UTC is still on the previous day during that window (IST = UTC+5:30).
//
// This is deterministic (not "wait until 1am and hope someone notices") by
// freezing the browser clock at a fixed instant inside that bug window and
// checking what date the New Sale form actually shows.
//
// As of this suite's first run (26 Sep 2026) the plain dashboard date and
// the default #s-date value were both observed correct in normal daytime
// testing — this test exists to pin the specific midnight-window case that
// daytime testing can never catch by accident.

const { test, expect } = require('@playwright/test');
const { login, goToTab } = require('./fixtures/testShop');

test.describe('invoice date', () => {
  test('New Sale date defaults to the local IST day, even just after midnight', async ({ page }) => {
    // 2026-09-27 00:30 IST == 2026-09-26 19:00 UTC. A naive `new
    // Date().toISOString().slice(0,10)` at this instant yields "2026-09-26"
    // — one day behind the correct local date, "2026-09-27".
    //
    // setFixedTime (not clock.install) deliberately — it only freezes what
    // `new Date()` returns, leaving real setTimeout/setInterval alone, so it
    // can't hang the login flow's own timers/animations.
    await page.clock.setFixedTime(new Date('2026-09-27T00:30:00+05:30'));

    await login(page);
    await goToTab(page, 'sale');

    const dateValue = await page.locator('#s-date').inputValue();
    expect(dateValue, 'New Sale date field should be the local IST day, not the UTC day').toBe('2026-09-27');
  });
});
