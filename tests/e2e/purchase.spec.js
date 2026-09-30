// Purchases (Cowork QA 30 Sep, P1 item 7): a purchase bill of ₹50,000 with
// ₹20,000 paid in cash put −₹50,000 in the Day Book — cash-out overstated by
// the ₹30,000 still owed to the supplier. The Day Book must post what was
// actually paid.

const { test, expect } = require('@playwright/test');
const { login, goToTab, runId } = require('./fixtures/testShop');

test.describe('purchase', () => {
  test('a part-paid cash purchase posts only the amount paid to the Day Book', async ({ page }) => {
    const id = runId();
    const supplier = 'E2E Supplier ' + id;

    await login(page);
    await goToTab(page, 'stock');
    await page.locator('#invsub-tab-purchases').click();
    await page.locator('#pb-add-btn').click();
    await page.locator('#pb-f-supplier').fill(supplier);
    await page.locator('#pb-f-total').fill('50000');
    // A blank Amount Paid saves as fully paid -- the box must say so, not "0".
    await expect(page.locator('#pb-f-paid')).toHaveAttribute('placeholder', /fully paid/);
    await page.locator('#pb-f-paid').fill('20000');
    await page.locator('#pb-f-paymethod').selectOption('Cash');
    await page.getByRole('button', { name: /save & sync/i }).first().click();

    await expect.poll(() => page.evaluate((s) => (S.purchases || []).filter((b) => b.supplier === s).length, supplier), { timeout: 15000 }).toBe(1);
    const result = await page.evaluate((s) => {
      const bill = S.purchases.find((b) => b.supplier === s);
      const lines = dbAutoLines(dbDayKey(bill.date)).filter((l) => l.src === 'purchase' && l.srcId === bill.id);
      return { total: bill.totalAmount, paid: bill.amountPaid, out: lines.map((l) => (l.nonCash ? 'noncash ' : '') + l.dir + ' ' + l.amount) };
    }, supplier);
    expect(result.total, 'bill total').toBe(50000);
    expect(result.paid, 'amount paid stored on the bill').toBe(20000);
    expect(result.out, 'Day Book lines for this bill').toEqual(['out 20000']);
  });
});
