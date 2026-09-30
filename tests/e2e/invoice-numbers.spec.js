// F3 — invoice numbers must never repeat (audit R4/R5, HANDOFF 29 Sep).
//
// The bug: only the FIRST sale in a session asks the server's atomic counter
// for a number. After that sale, clearSale() pre-fills #s-invno with this
// device's own S.nextInvNo, and initSaleDate() skips the counter because the
// field is no longer empty. So the second sale on device A uses a number the
// server never handed out — and the next device to ask the server gets that
// same number. A GST invoice series with duplicates is a compliance problem,
// not a cosmetic one.
//
// Spec (Cowork, 29 Sep): two consecutive sales plus one on a second browser
// must give three distinct numbers.

const { test, expect } = require('@playwright/test');
const { login, goToTab, runId } = require('./fixtures/testShop');

// Records a small custom-mode cash sale, fully paid, and returns the invoice
// number it was actually SAVED under (read from S.sales, not from the form,
// so the assertion checks what the shop's records hold).
async function recordSale(page, customer) {
  await goToTab(page, 'sale');
  await page.locator('#mode-btn-custom').click();
  await page.locator('#s-cust').fill(customer);
  const itemCard = page.locator('#custom-sale-items');
  await itemCard.locator('#csi-name-0').fill('E2E inv item');
  await itemCard.locator('input[placeholder="0.000"]').first().fill('1');
  await expect(page.getByText('Item Total')).toBeVisible();
  const grandTotalText = await page.getByText('Grand Total').locator('..').innerText();
  const grandTotal = Number(grandTotalText.replace(/[^\d]/g, ''));
  await page.locator('#split-payments-wrap input[type="text"]').first().fill(String(grandTotal));
  await expect(page.getByText('✓ Fully Settled', { exact: true })).toBeVisible();
  await page.locator('#panel-sales').getByRole('button', { name: /record & sync sale/i }).click();
  await expect(page.getByText('Sale recorded', { exact: false })).toBeVisible({ timeout: 15000 });
  // The app jumps back to Home 900 ms after a save; wait for it, or the next
  // sale's tab click gets undone mid-fill.
  await expect(page.locator('#panel-dashboard')).toHaveClass(/active/);
  return page.evaluate(function (c) {
    var s = S.sales.filter(function (x) { return x.customer === c; });
    return s.length === 1 ? s[0].invNo : 'found ' + s.length + ' sales for ' + c;
  }, customer);
}

test.describe('invoice numbers', () => {
  test('two sales on one device plus one on a second device get three distinct numbers', async ({ browser }) => {
    test.setTimeout(90 * 1000);
    const id = runId();

    const ctxA = await browser.newContext();
    const pageA = await ctxA.newPage();
    await login(pageA);
    const inv1 = await recordSale(pageA, 'E2E Inv A1 ' + id);
    const inv2 = await recordSale(pageA, 'E2E Inv A2 ' + id);

    // Second "device": its own storage, logs in fresh, asks the server.
    const ctxB = await browser.newContext();
    const pageB = await ctxB.newPage();
    await login(pageB);
    const inv3 = await recordSale(pageB, 'E2E Inv B1 ' + id);

    // Device B loaded the shop's full sales list at login, then added its own
    // sale — so it sees every number in use. Each new number must appear once.
    const counts = await pageB.evaluate(function (nums) {
      return nums.map(function (n) {
        return S.sales.filter(function (x) { return x.invNo === n; }).length;
      });
    }, [inv1, inv2, inv3]);

    await ctxA.close();
    await ctxB.close();

    const all = [inv1, inv2, inv3];
    for (const n of all) expect(n).toMatch(/^INV-\d+$/);
    expect(new Set(all).size, 'invoice numbers were ' + all.join(', ')).toBe(3);
    expect(counts, 'times each of ' + all.join(', ') + ' appears in the shop').toEqual([1, 1, 1]);
  });
});
