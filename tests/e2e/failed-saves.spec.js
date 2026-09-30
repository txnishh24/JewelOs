// F4 — a failed money save must never look saved (audit R6/R7, HANDOFF 29 Sep).
//
// The bug: creating a Girvi loan or an order, when the cloud save fails,
// closed the form and showed the new record anyway ("will retry" — nothing
// retried). The next 15 s refresh then replaced the shop data from the cloud
// and the record vanished, along with the loan's ornament photos.
//
// Fixed behaviour: the form stays open with everything typed, nothing is
// left in the list, the jeweller is told "Not saved — tap to retry", and
// tapping save again once the connection is back creates it exactly once.
//
// How the failure is simulated: every store-proxy POST that is a SAVE is
// aborted; the number counter (increment_counter) is let through, as it
// would be on a flaky connection that drops the larger request.

const { test, expect } = require('@playwright/test');
const { login, goToTab, runId } = require('./fixtures/testShop');

async function blockSaves(page) {
  await page.route('**/functions/v1/store-proxy', (route) => {
    const req = route.request();
    if (req.method() === 'POST' && !(req.postData() || '').includes('increment_counter')) return route.abort();
    return route.continue();
  });
}

test.describe('failed saves (F4)', () => {
  test('a Girvi loan whose save fails stays in the open wizard, then saves once on retry', async ({ page }) => {
    const id = runId();
    const customerName = 'E2E F4 Girvi ' + id;

    await login(page);
    await goToTab(page, 'girvi');
    await page.locator('#panel-girvi').getByRole('button', { name: /new girvi/i }).first().click();
    await page.locator('#gf-cust').fill(customerName);
    await page.locator('#gf-phone').fill('9' + String(Date.now()).slice(-9));
    await page.locator('#gf-next-btn').click();
    const item = page.locator('#gf-item-card-0');
    await item.locator('input[placeholder*="Ladies 22K gold"]').fill('E2E F4 pledge ' + id);
    await item.locator('input[placeholder="0.00"]').first().fill('10');
    await page.locator('#gf-next-btn').click();
    await page.locator('#gf-next-btn').click(); // photos: skip
    await page.locator('#gf-principal').fill('15000');
    await page.locator('#gf-next-btn').click();
    await expect(page.getByText('LOAN SUMMARY')).toBeVisible();

    await blockSaves(page);
    await page.locator('#gf-next-btn').click();

    await expect(page.getByText(/not saved.*tap to retry/i)).toBeVisible({ timeout: 15000 });
    await expect(page.locator('#girvi-modal')).toBeVisible();
    const afterFail = await page.evaluate((c) => S.girvi.filter((g) => g.customer === c).length, customerName);
    expect(afterFail, 'a loan that did not save must not be in the shop data').toBe(0);

    await page.unroute('**/functions/v1/store-proxy');
    await page.locator('#gf-next-btn').click();
    await expect(page.locator('.girvi-card', { hasText: customerName })).toBeVisible({ timeout: 15000 });
    await expect(page.locator('#girvi-modal')).toBeHidden();
    const afterRetry = await page.evaluate((c) => S.girvi.filter((g) => g.customer === c).length, customerName);
    expect(afterRetry, 'retry must create the loan exactly once').toBe(1);
  });

  test('an order whose save fails stays in the open form, then saves once on retry', async ({ page }) => {
    const id = runId();
    const customerName = 'E2E F4 Order ' + id;

    await login(page);
    await goToTab(page, 'orders');
    await page.locator('#ord-add-btn').click();
    await page.locator('#of-cust').fill(customerName);
    await page.locator('#oi-desc-0').fill('E2E F4 ring ' + id);
    const d = new Date(); d.setDate(d.getDate() + 7);
    await page.locator('#of-delivery').fill(d.toISOString().slice(0, 10));

    await blockSaves(page);
    await page.getByRole('button', { name: /save & sync order/i }).click();

    await expect(page.getByText(/not saved.*tap to retry/i)).toBeVisible({ timeout: 15000 });
    await expect(page.locator('#ord-form')).toBeVisible();
    const afterFail = await page.evaluate((c) => S.orders.filter((o) => o.customer === c).length, customerName);
    expect(afterFail, 'an order that did not save must not be in the shop data').toBe(0);

    await page.unroute('**/functions/v1/store-proxy');
    await page.getByRole('button', { name: /save & sync order/i }).click();
    await expect(page.locator('#ord-form')).toBeHidden({ timeout: 15000 });
    const afterRetry = await page.evaluate((c) => S.orders.filter((o) => o.customer === c).length, customerName);
    expect(afterRetry, 'retry must create the order exactly once').toBe(1);
  });
});
