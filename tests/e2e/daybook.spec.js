// Day Book arithmetic sanity check. Walks the flow listed for 10-daybook.js
// in skills/verify-ui.md ("confirm cash-in/out derivation").
//
// This test assumes Day Book has already been started for the test shop
// (it was, by hand, when the shop was created — see HANDOFF.md). If Day
// Book has never been started, this test will see the "Set up your Day
// Book" screen instead and fail with a clear message rather than silently
// doing the wrong thing.
//
// It deliberately does NOT assert exact rupee figures for Cash In/Out —
// other specs in this suite (and Tanish's own manual use) add entries to
// the same shop, so the only thing worth pinning down here is the
// relationship between the four numbers, which must hold no matter what
// today's actual entries are.

const { test, expect } = require('@playwright/test');
const { login, goToTab } = require('./fixtures/testShop');

function rupeesToNumber(text) {
  return Number(text.replace(/[^\d-]/g, ''));
}

test.describe('daybook', () => {
  test('Closing = Opening + Cash In − Cash Out', async ({ page }) => {
    await login(page);
    await goToTab(page, 'daybook');

    await expect(
      page.getByText('Set up your Day Book'),
      'Day Book was never started for this test shop — start it once by hand (Opening cash), then re-run.'
    ).not.toBeVisible({ timeout: 10000 });

    const metric = (label) => page.locator('.metric', { hasText: label }).locator('.metric-value');

    await expect(metric('Opening')).toBeVisible({ timeout: 10000 });
    const opening = rupeesToNumber(await metric('Opening').innerText());
    const cashIn = rupeesToNumber(await metric('Cash In').innerText());
    const cashOut = rupeesToNumber(await metric('Cash Out').innerText());
    const closing = rupeesToNumber(await metric('Closing').innerText());

    expect(closing).toBe(opening + cashIn - cashOut);
  });
});
