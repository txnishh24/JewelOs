// Requested by Cowork in HANDOFF.md (2026-10-05, "phone test of Edit Bill /
// Reports: NOT run, handed to Claude Code") -- Cowork cannot click through
// Edit Bill or Reports itself (no login access, and its own DB access is
// read-only), so this is the first DOM/wiring coverage for all three paths
// it asked for. See tests/e2e/README.md for selector conventions and why
// every spec shares the one test shop.
//
// The money-logic these guard (Edit Bill's live-preview/save agreement,
// Day Book never posting old-gold/advance money as cash) already has
// thorough pure-function coverage in tests/regression.test.js under "QA
// M3" / "QA M3 follow-up" -- these tests exist to prove the real DOM path
// (click Edit, type into the real inputs, click Save) actually reaches
// that logic, not to re-derive it.

const { test, expect } = require('@playwright/test');
const { login, goToTab, runId } = require('./fixtures/testShop');

async function readGoldRate(page) {
  const rateText = await page.getByText(/22K\s*₹[\d,]+\/g/).innerText();
  return Number(rateText.match(/₹([\d,]+)\/g/)[1].replace(/,/g, ''));
}

async function createFullyPaidCashSale(page, custName, itemLabel, grossWeightG, ratePerGram) {
  const grandTotal = ratePerGram * grossWeightG;
  await goToTab(page, 'sale');
  await page.locator('#mode-btn-custom').click();
  await page.locator('#s-cust').fill(custName);
  const itemCard = page.locator('#custom-sale-items');
  await itemCard.locator('#csi-name-0').fill(itemLabel);
  await itemCard.locator('input[placeholder="0.000"]').first().fill(String(grossWeightG));
  await expect(page.getByText('Item Total')).toBeVisible();
  const payAmount = page.locator('#split-payments-wrap input[type="text"]').first();
  await payAmount.fill(String(grandTotal));
  await expect(page.getByText('✓ Fully Settled', { exact: true })).toBeVisible();
  await page.locator('#panel-sales').getByRole('button', { name: /record & sync sale/i }).click();
  const confirmText = await page.getByText(/Sale recorded! Invoice/).innerText({ timeout: 15000 });
  await expect(page.locator('#panel-dashboard')).toHaveClass(/active/, { timeout: 5000 });
  return { grandTotal, invNo: confirmText.match(/Invoice:\s*(\S+)/)[1] };
}

async function openCustomerHistory(page, custName) {
  await goToTab(page, 'customers');
  const custRow = page.locator('#cust-list > div', { hasText: custName });
  await expect(custRow.first()).toBeVisible({ timeout: 10000 });
  await custRow.first().click();
  await expect(page.locator('#cust-modal')).toHaveClass(/open/);
}

test.describe('edit bill', () => {
  test('live total preview matches what Save stores and what the invoice prints', async ({ page }) => {
    const id = runId();
    const discount = 500;
    await login(page);
    const ratePerGram = await readGoldRate(page);
    const custName = 'E2E EditBill Customer ' + id;
    const { grandTotal } = await createFullyPaidCashSale(page, custName, 'E2E EditBill item ' + id, 4, ratePerGram);
    const expectedAfterDiscount = grandTotal - discount;

    await openCustomerHistory(page, custName);
    await page.locator('#cust-modal').getByRole('button', { name: /edit/i }).click();
    await expect(page.locator('#edit-bill-modal')).toHaveClass(/open/);

    await page.locator('#eb-disc').fill(String(discount));
    // The original split-payment row still holds the pre-discount amount --
    // bring it down to match, or saveEditBill() correctly refuses the save
    // as an overpayment (QA 1 Oct P0-2: payments above the bill are refused).
    await page.locator('#ebsp-amt-0').fill(String(expectedAfterDiscount));
    // calcEditTotal() fires on 'oninput' synchronously -- no save yet.
    await expect(page.locator('#eb-total-display')).toContainText('₹' + expectedAfterDiscount.toLocaleString('en-IN'));

    await page.getByRole('button', { name: /save changes/i }).click();
    await expect(page.getByText(/Bill updated & saved/)).toBeVisible({ timeout: 10000 });

    // cust-modal is still open underneath (Save only closes edit-bill-modal).
    // Its "View Bill" button reads the sale fresh from S.sales, so this
    // proves the SAME total the live preview showed is what got printed,
    // not a third, independently-computed figure -- the exact M3 bug.
    await page.locator('#cust-modal').getByRole('button', { name: /view bill/i }).click();
    await expect(page.locator('#invoice-modal')).toHaveClass(/open/);
    await expect(page.frameLocator('#inv-frame').locator('.tgv'))
      .toContainText('₹' + expectedAfterDiscount.toLocaleString('en-IN'), { timeout: 10000 });
  });

  test('clearing Old Gold to 0 never posts a phantom Day Book Sale line', async ({ page }) => {
    const id = runId();
    await login(page);
    const ratePerGram = await readGoldRate(page);
    const grossWeightG = 2;
    const grandTotal = ratePerGram * grossWeightG;
    const custName = 'E2E Exchange Customer ' + id;

    await goToTab(page, 'sale');
    await page.locator('#mode-btn-custom').click();
    await page.locator('#s-cust').fill(custName);
    const itemCard = page.locator('#custom-sale-items');
    await itemCard.locator('#csi-name-0').fill('E2E exchange item ' + id);
    await itemCard.locator('input[placeholder="0.000"]').first().fill(String(grossWeightG));
    await expect(page.getByText('Item Total')).toBeVisible();

    // Cover the WHOLE bill with old gold, zero cash -- the exact shape that
    // must never post a "Sale" cash-in line (M3 follow-up #2: a plain
    // exchange sale fully covered by old gold/advance was reaching
    // dbAutoLines()'s tier-3 cash fallback).
    await page.locator('#s-oldgold-direct').fill(String(grandTotal));
    await expect(page.getByText('✓ Fully Settled', { exact: true })).toBeVisible();
    await page.locator('#panel-sales').getByRole('button', { name: /record & sync sale/i }).click();
    const confirmText = await page.getByText(/Sale recorded! Invoice/).innerText({ timeout: 15000 });
    const invNo = confirmText.match(/Invoice:\s*(\S+)/)[1];
    await expect(page.locator('#panel-dashboard')).toHaveClass(/active/, { timeout: 5000 });

    await goToTab(page, 'daybook');
    await expect(page.locator('.gl-entry', { hasText: invNo })).toHaveCount(0);

    // Edit the bill and clear Old Gold back to 0 -- the exact action the
    // M3 follow-up bug left stale (sale.oldGold.value stranded at its
    // pre-edit figure) -- and confirm it still posts nothing.
    await openCustomerHistory(page, custName);
    await page.locator('#cust-modal').getByRole('button', { name: /edit/i }).click();
    await expect(page.locator('#edit-bill-modal')).toHaveClass(/open/);
    await expect(page.locator('#eb-oldgold')).toHaveValue(String(grandTotal));
    await page.locator('#eb-oldgold').fill('0');
    await page.getByRole('button', { name: /save changes/i }).click();
    await expect(page.getByText(/Bill updated & saved/)).toBeVisible({ timeout: 10000 });
    await page.locator('#cust-modal .modal-close').click();

    await goToTab(page, 'daybook');
    await expect(page.locator('.gl-entry', { hasText: invNo })).toHaveCount(0);
  });
});

test.describe('reports', () => {
  test('no horizontal scroll at 390px, and a refund reduces Revenue and Net Cash', async ({ page }) => {
    const id = runId();
    await login(page);
    const ratePerGram = await readGoldRate(page);
    const custName = 'E2E Refund Customer ' + id;
    await createFullyPaidCashSale(page, custName, 'E2E refund item ' + id, 1, ratePerGram);

    await goToTab(page, 'reports');
    const widths = await page.locator('html').evaluate((el) => ({ scroll: el.scrollWidth, client: el.clientWidth }));
    expect(widths.scroll).toBeLessThanOrEqual(widths.client + 1); // 1px rounding tolerance

    const num = (s) => Number(s.replace(/[^\d.-]/g, ''));
    const revenueBefore = num(await page.locator('.metric', { hasText: 'Revenue' }).locator('.metric-value').innerText());
    const netCashBefore = num(await page.locator('.metric', { hasText: 'Net Cash' }).locator('.metric-value').innerText());

    await openCustomerHistory(page, custName);
    await page.locator('#cust-modal').getByRole('button', { name: /refund/i }).click();
    await expect(page.locator('#refund-modal')).toBeVisible();
    await page.getByRole('button', { name: /issue refund/i }).click();
    await page.locator('#safe-confirm-ok').click();
    await expect(page.getByText(/Refund .* issued/)).toBeVisible({ timeout: 10000 });
    await page.locator('#cust-modal .modal-close').click();

    await goToTab(page, 'reports');
    const revenueAfter = num(await page.locator('.metric', { hasText: 'Revenue' }).locator('.metric-value').innerText());
    const netCashAfter = num(await page.locator('.metric', { hasText: 'Net Cash' }).locator('.metric-value').innerText());
    expect(revenueAfter).toBeLessThan(revenueBefore);
    expect(netCashAfter).toBeLessThan(netCashBefore);
  });
});

test.describe('new sale number boxes', () => {
  test('Extra Making / GST / Discount accept typing without clearing a "0" first', async ({ page }) => {
    // Regression test for M4 (zeroFieldFocus/zeroFieldBlur, js/02-ui-inactivity-modals.js):
    // these boxes used to pre-fill "0", so the first keystroke produced "01"
    // etc. unless the jeweller backspaced first.
    await login(page);
    await goToTab(page, 'sale');
    await page.locator('#mode-btn-custom').click();

    // #s-gst is skipped: it's hidden whenever the shop has no valid GSTIN
    // (Memo Bill mode, js/02-ui-inactivity-modals.js setSaleFormBillType) --
    // a business rule unrelated to M4. #s-making and #s-disc carry the exact
    // same zeroFieldFocus/zeroFieldBlur fix and are always visible.
    for (const sel of ['#s-making', '#s-disc']) {
      const box = page.locator(sel);
      await expect(box).toHaveValue('0');
      await box.click();
      await expect(box).toHaveValue(''); // focus clears the pre-filled 0
      await page.keyboard.type('250');
      await expect(box).toHaveValue('250'); // not "0250"
      await box.blur();
      await expect(box).toHaveValue('250'); // non-empty value survives blur
    }

    // Other half of the same fix: blurring while still empty restores the 0 default.
    const disc = page.locator('#s-disc');
    await disc.click();
    await disc.fill('');
    await disc.blur();
    await expect(disc).toHaveValue('0');
  });
});
