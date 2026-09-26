// Create a Girvi (pawn) loan through the 5-step wizard, then record a
// payment against it through the Ledger and confirm the balance drops by
// the right amount. Walks the flow listed for 08-girvi-viewmode.js in
// skills/verify-ui.md — deliberately does NOT touch girviLedgerState's
// interest math itself (house rule: build additive views on top of it,
// don't second-guess the engine — this test checks the UI wiring to it).
//
// Backdated-payment note: this suite intentionally exercises a payment
// dated BEFORE the loan's own start date (the loan is created "today" by
// this test, so any backdated date qualifies). Per docs/TESTING-STRATEGY.md
// §4.3 this is meant to be honoured, clamped to day one — it must still
// reduce the outstanding balance, not be silently dropped. (Verified by
// hand against this same test shop on 26 Sep 2026: a 6-day-backdated ₹5,000
// payment correctly took the balance from ₹50,000 to ₹45,000 — nothing was
// lost, it just doesn't get extra interest relief it didn't earn.)

const { test, expect } = require('@playwright/test');
const { login, goToTab, runId } = require('./fixtures/testShop');

test.describe('girvi', () => {
  test('creates a loan and a backdated payment correctly reduces the balance', async ({ page }) => {
    const id = runId();
    const customerName = 'E2E Girvi Customer ' + id;
    const principal = 20000;
    const paymentAmount = 5000;

    await login(page);
    await goToTab(page, 'girvi');

    await page.locator('#panel-girvi').getByRole('button', { name: /new girvi/i }).first().click();

    // Step 1 — customer.
    await page.locator('#gf-cust').fill(customerName);
    await page.locator('#gf-phone').fill('9' + String(Date.now()).slice(-9));
    await page.locator('#gf-next-btn').click();

    // Step 2 — item. Default type (Ring) is fine; just fill description + weight.
    const item = page.locator('#gf-item-card-0');
    await item.locator('input[placeholder*="Ladies 22K gold"]').fill('E2E pledge ' + id);
    await item.locator('input[placeholder="0.00"]').first().fill('10'); // gross wt (g)
    await page.locator('#gf-next-btn').click();

    // Step 3 — photos (optional, skip).
    await page.locator('#gf-next-btn').click();

    // Step 4 — loan terms.
    await page.locator('#gf-principal').fill(String(principal));
    // Leave the default 2%/mo rate; set a duration so the review step has one.
    await page.locator('#gf-duration').fill('3');
    await page.locator('#gf-next-btn').click();

    // Step 5 — review & create. "Next" and "Create Girvi" are the SAME
    // button (#gf-next-btn) with its label swapped per wizard step, not two
    // separate elements — confirmed against the live DOM 26 Sep 2026.
    await expect(page.getByText('LOAN SUMMARY')).toBeVisible();
    await expect(page.getByText(customerName)).toBeVisible();
    await page.locator('#gf-next-btn').click();

    // Back on the Girvi list — our loan's card should be there. Cards are
    // flat `.girvi-card` divs (no nesting), so this is unambiguous.
    const card = page.locator('.girvi-card', { hasText: customerName });
    await expect(card).toBeVisible({ timeout: 10000 });
    // exact: true — the card also has a principal line ("₹20,000 @ 2%/mo")
    // that contains this same substring, which trips Playwright's strict mode.
    await expect(card.getByText('₹' + principal.toLocaleString('en-IN'), { exact: true })).toBeVisible();

    // Open its Ledger and record a payment dated before the loan started
    // (see file header — this is deliberate, not a mistake).
    await card.getByRole('button', { name: /ledger/i }).click();
    await expect(page.getByText('LOAN BALANCE', { exact: false })).toBeVisible({ timeout: 10000 });

    const backdate = new Date();
    backdate.setDate(backdate.getDate() - 6);
    const backdateStr = backdate.toISOString().slice(0, 10);

    await page.locator('#gl-amount').fill(String(paymentAmount));
    await page.locator('#gl-date').fill(backdateStr);
    await page.getByRole('button', { name: /record entry/i }).click();

    // Balance must reflect the payment — this is the thing that would
    // silently fail if a backdated payment got dropped instead of clamped.
    // Scoped to the "Loan Balance" summary card specifically: with a
    // same-day loan, accrued interest is 0, so "Outstanding" (balance +
    // interest) shows the identical figure and getByText alone hits
    // Playwright's strict mode across both cards.
    const expectedBalance = principal - paymentAmount;
    const balanceCard = page.locator('.gl-sum-card').filter({ hasText: 'Loan Balance' });
    await expect(balanceCard.getByText('₹' + expectedBalance.toLocaleString('en-IN'))).toBeVisible({ timeout: 10000 });
  });
});
