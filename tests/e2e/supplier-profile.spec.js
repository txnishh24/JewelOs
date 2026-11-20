// Supplier profile opens from the Supplier Ledger and shows the supplier's bills and what is owed.
// Uses local in-page data only (nothing is saved): two fake bills for one fake supplier, removed again at the end.
const { test, expect } = require('@playwright/test');
const { login, goToTab } = require('./fixtures/testShop');

test.describe('supplier profile', () => {
  test('tap a supplier in the ledger to open their profile', async ({ page }) => {
    await login(page);
    await goToTab(page, 'stock');
    await page.evaluate(() => {
      window.__keep = S.purchases;
      S.purchases = [
        { id: 'e2e-b1', billNo: 'E2E-PB-1', date: '2026-10-01', supplier: 'E2E Bullion Co', totalAmount: 3000, amountPaid: 1000, supplierPayments: [] },
        { id: 'e2e-b2', billNo: 'E2E-PB-2', date: '2026-10-20', supplier: 'E2E Bullion Co', totalAmount: 5000, amountPaid: 0, supplierPayments: [] },
      ];
      switchInvSub('purchases');
    });
    const row = page.locator('#pbsl-table-wrap tr:visible, #pbsl-cards .inv-card:visible').filter({ hasText: 'E2E Bullion Co' }).first();
    await row.click();
    const modal = page.locator('#pbsup-modal.open');
    await expect(modal).toBeVisible();
    await expect(modal).toContainText('E2E Bullion Co');
    await expect(modal).toContainText('E2E-PB-1');
    await expect(modal).toContainText('E2E-PB-2');
    await expect(modal).toContainText('7,000');       // 8,000 bought - 1,000 paid
    await expect(modal.getByRole('button', { name: /record payment/i })).toBeVisible();
    await page.evaluate(() => { closeSupplierProfile(); S.purchases = window.__keep; });
  });
});
