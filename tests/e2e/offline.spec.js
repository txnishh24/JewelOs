// Offline billing (batch44, Tanish 1 Oct): with the internet cut, a sale takes
// one of this phone's reserved invoice numbers and is kept on the phone; when
// the internet returns it is replayed onto the cloud copy and saved.
// Runs against the live test shop like every other spec (tests/e2e/README.md).

const { test, expect } = require('@playwright/test');
const { login, goToTab, runId } = require('./fixtures/testShop');

test('a sale made offline gets a reserved number and reaches the cloud when back online', async ({ page, context }) => {
  test.setTimeout(150000);
  const id = runId();
  await login(page);

  // The pool fills in the background after the login load.
  await page.waitForFunction(() => {
    try { return JSON.parse(localStorage.getItem(invPoolKey()) || '[]').length >= INV_POOL_SIZE; } catch (e) { return false; }
  }, null, { timeout: 30000 });
  const reserved = await page.evaluate(() => JSON.parse(localStorage.getItem(invPoolKey()))[0]);

  await context.setOffline(true);

  await goToTab(page, 'sale');
  await page.locator('#mode-btn-custom').click();
  await page.locator('#s-cust').fill('E2E Offline Customer ' + id);
  const itemCard = page.locator('#custom-sale-items');
  await itemCard.locator('#csi-name-0').fill('E2E offline ring ' + id);
  await itemCard.locator('input[placeholder="0.000"]').first().fill('2');
  await page.locator('#panel-sales').getByRole('button', { name: /record & sync sale/i }).click();

  await expect(page.getByText('Saved offline: ' + reserved)).toBeVisible({ timeout: 15000 });
  expect(await page.evaluate(() => offlineSalesPending())).toBe(1);

  // Back online: the app reloads from the cloud, replays the outbox and saves.
  // If the reconnect load goes out before the connection is really back, the
  // 60 s auto-refresh does it instead -- allow for that.
  await context.setOffline(false);
  await expect.poll(() => page.evaluate(() => offlineSalesPending()), { timeout: 90000 }).toBe(0);

  // Proof it is in the cloud, not just on this phone: a fresh load has it.
  const inCloud = await page.evaluate((inv) => new Promise((resolve) => {
    loadFromCloud(() => resolve(S.sales.some((s) => s.invNo === inv)));
  }), reserved);
  expect(inCloud).toBe(true);
});
