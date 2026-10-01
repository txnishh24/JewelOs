// Create a cash sale (Custom/Handmade billing), confirm the gold-value math
// and grand total, save it, and confirm it lands correctly in Day Book.
// Walks the flow listed for 03-billing-numbers.js in skills/verify-ui.md,
// plus the Day Book auto-posting regression (see daybook.spec.js for the
// fuller Day Book coverage — this test only checks the one line this sale
// itself should produce).
//
// Money-math note: this test reads the shop's live 22K gold rate from the
// dashboard and computes the expected total itself (gross weight × rate),
// rather than hardcoding a rupee figure — the test shop's rate can change
// (Tanish or another test touches "Set today's gold rates") and a hardcoded
// total would then fail for a reason that has nothing to do with a real bug.

const { test, expect } = require('@playwright/test');
const { login, goToTab, runId } = require('./fixtures/testShop');

test.describe('sale', () => {
  test('records a cash sale and it posts correctly to Day Book', async ({ page }) => {
    const id = runId();
    const grossWeightG = 10;

    await login(page);

    // Read today's live 22K rate off the dashboard (e.g. "22K ₹7,200/g").
    const rateText = await page.getByText(/22K\s*₹[\d,]+\/g/).innerText();
    const rateMatch = rateText.match(/₹([\d,]+)\/g/);
    const ratePerGram = Number(rateMatch[1].replace(/,/g, ''));
    const expectedTotal = ratePerGram * grossWeightG;

    await goToTab(page, 'sale');

    await page.locator('#mode-btn-custom').click();
    await page.locator('#s-cust').fill('E2E Cash Customer ' + id);

    const itemCard = page.locator('#custom-sale-items');
    // #csi-name-0 — the item-name input's real placeholder is "e.g. Gold
    // Necklace Meenakari" (buildCustomItemCard in 02-ui-inactivity-modals.js);
    // "Ladies 22K gold..." belongs to a different, unrelated input in Settings.
    await itemCard.locator('#csi-name-0').fill('E2E ring ' + id);
    // First "0.000" field in the item card is gross weight (deduction fields follow it).
    await itemCard.locator('input[placeholder="0.000"]').first().fill(String(grossWeightG));

    await expect(page.getByText('Item Total')).toBeVisible();
    // getByText for the amount hits a strict-mode wall pre-payment: the same
    // figure legitimately repeats across "Gold value", "Item Total", the
    // payment summary and the balance-due display (nothing's been paid yet,
    // so they're all equal). Scope to the item card's own total box instead —
    // one known element, checked by substring, not a page-wide text search.
    await expect(itemCard.locator('#csi-total-0')).toContainText('₹' + expectedTotal.toLocaleString('en-IN'));

    // Pay the full amount in cash (default mode).
    const payAmount = page.locator('#split-payments-wrap input[type="text"]').first();
    await payAmount.fill(String(expectedTotal));
    // Two elements contain this text ("✓ Fully Settled" and "✓ Fully Settled —
    // No balance due") — getByText substring-matches both, so scope by the
    // shorter one's exact text.
    await expect(page.getByText('✓ Fully Settled', { exact: true })).toBeVisible();

    await page.locator('#panel-sales').getByRole('button', { name: /record & sync sale/i }).click();

    // Back on the dashboard: today's sales total should have picked this up.
    // Wait for THIS sale's confirmation, then for the app's own return to the
    // dashboard (a 0.9 s timer after every sale). Waiting on the generic 'Saved'
    // could pass on an earlier save, and the timer then switched the Day Book
    // tab we had just opened back to the dashboard.
    await expect(page.getByText(/Sale recorded! Invoice/)).toBeVisible({ timeout: 15000 });
    await expect(page.locator('#panel-dashboard')).toHaveClass(/active/, { timeout: 5000 });

    // Confirm it auto-posted to Day Book as a cash-in line, not silently dropped
    // (this is the specific bug this app has had before — see docs/TESTING-STRATEGY.md).
    await goToTab(page, 'daybook');
    const cashInMetric = page.locator('.metric', { hasText: 'Cash In' }).locator('.metric-value');
    await expect(cashInMetric).toBeVisible({ timeout: 10000 });
    // We can't assert the exact Cash In figure (other tests/manual use share
    // this shop and add to the same day's total, and Day Book lines show the
    // invoice number, not the item description) — but an auto-posted "Sale"
    // line must be there, which is the thing this bug family breaks.
    await expect(page.locator('.gl-entry', { hasText: 'Sale' }).first()).toBeVisible();
  });

  test('records a UPI sale and Day Book shows the non-cash banner, not a silent gap', async ({ page }) => {
    // Regression test for the 21 Sep 2026 bug: a non-cash sale used to vanish
    // from Day Book with zero on-screen indication anything was excluded.
    // Fixed behaviour: an "Also today: ₹X across N sale(s)/payment(s) in
    // UPI, Card or Bank" banner. This test only proves the banner mechanism
    // still fires for a fresh UPI sale — see daybook.spec.js for the fuller
    // check of what the banner says.
    const id = runId();
    const grossWeightG = 3;

    await login(page);
    await goToTab(page, 'sale');

    await page.locator('#mode-btn-custom').click();
    await page.locator('#s-cust').fill('E2E UPI Customer ' + id);
    const itemCard = page.locator('#custom-sale-items');
    await itemCard.locator('#csi-name-0').fill('E2E UPI item ' + id);
    await itemCard.locator('input[placeholder="0.000"]').first().fill(String(grossWeightG));

    await expect(page.getByText('Item Total')).toBeVisible();

    const payAmount = page.locator('#split-payments-wrap input[type="text"]').first();
    const payMode = page.locator('#split-payments-wrap select').first();
    // Amount must match the computed total for "Fully Settled" — read it back
    // from the Grand Total line rather than recomputing the rate again here.
    const grandTotalText = await page.getByText('Grand Total').locator('..').innerText();
    const grandTotal = Number(grandTotalText.replace(/[^\d]/g, ''));
    await payAmount.fill(String(grandTotal));
    await payMode.selectOption('UPI');
    await expect(page.getByText('✓ Fully Settled', { exact: true })).toBeVisible();

    await page.locator('#panel-sales').getByRole('button', { name: /record & sync sale/i }).click();
    // Wait for THIS sale's confirmation, then for the app's own return to the
    // dashboard (a 0.9 s timer after every sale). Waiting on the generic 'Saved'
    // could pass on an earlier save, and the timer then switched the Day Book
    // tab we had just opened back to the dashboard.
    await expect(page.getByText(/Sale recorded! Invoice/)).toBeVisible({ timeout: 15000 });
    await expect(page.locator('#panel-dashboard')).toHaveClass(/active/, { timeout: 5000 });

    await goToTab(page, 'daybook');
    await expect(page.getByText(/Also today:.*UPI, Card or Bank/i)).toBeVisible({ timeout: 10000 });
  });
});
