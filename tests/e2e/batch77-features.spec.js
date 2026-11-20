// End-to-end check of the batch77 features, clicking through the real screens.
// Safety: every test replaces saveToCloud with a stub and works on in-page sample data only, so nothing is written to the test shop's cloud data.
const { test, expect } = require('@playwright/test');
const { login, goToTab } = require('./fixtures/testShop');

async function prep(page) {
  await login(page);
  await page.evaluate(() => {
    window.saveToCloud = function (cb) { if (cb) cb(null); };   // nothing leaves this page
    window.saveCache = function () {};
  });
}
const PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';

test.describe('batch77 features', () => {
  test('1 dashboard: Stock Value is dots until the eye is tapped', async ({ page }) => {
    await prep(page);
    await page.evaluate(() => {
      S.products = [{ id: 'e1', name: 'Chain', sku: 'E-1', cat: 'Chains', metal: 'gold', purity: '22K', weight: 10, netWeight: 10, status: 'available', qty: 1, mcRate: 0, costRate: 6000 }];
      _dashStockShown = false; renderDash();
    });
    const card = page.locator('.fin-snap-card').filter({ hasText: 'Stock Value' });
    await expect(card).toContainText('•••');
    await expect(card).not.toContainText('₹');
    await card.getByRole('button').click();
    await expect(card).toContainText('₹');
    await card.getByRole('button').click();
    await expect(card).toContainText('•••');
  });

  test('2 phone: stock cards use three compact columns', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await prep(page);
    await page.evaluate(() => {
      S.products = [{ id: 'e1', name: 'Compact Chain', sku: 'E-1', cat: 'Chains', metal: 'gold', purity: '22K', weight: 10, netWeight: 9.5, status: 'available', qty: 1, mcRate: 0, costRate: 6000 }];
    });
    await goToTab(page, 'stock');
    await page.evaluate(() => renderInv());
    const rows = page.locator('#inv-cards .inv-card-rows').first();
    await expect(rows).toBeVisible();
    const cols = await rows.evaluate((el) => getComputedStyle(el).gridTemplateColumns.split(' ').length);
    expect(cols).toBe(3);
  });

  test('3 sale: a small balance gets an Adjust button that turns it into discount', async ({ page }) => {
    await prep(page);
    await goToTab(page, 'sale');
    await page.evaluate(() => {
      document.getElementById('s-making').value = '1500';
      document.getElementById('s-disc').value = '0';
      updateSum();
    });
    // the first payment row starts as "pay everything"; the customer pays 1,000 of 1,500, leaving a small balance
    const pay = page.locator('#split-payments-wrap .split-pay-row input').first();
    await pay.fill('1000');
    const adj = page.locator('#s-adjust-btn');
    await expect(adj).toBeVisible();
    await expect(adj).toContainText('500');
    await adj.click();
    const disc = await page.evaluate(() => parseFloat(document.getElementById('s-disc').value));
    expect(disc).toBeGreaterThan(400);
    expect(disc).toBeLessThanOrEqual(500);
    await expect(adj).toBeHidden();                       // balance is now zero
    // a big balance gets no button
    await page.evaluate(() => { document.getElementById('s-disc').value = '0'; document.getElementById('s-making').value = '50000'; updateSum(); });
    await pay.fill('1000');
    await expect(adj).toBeHidden();
  });

  test('4 orders: four stages, delivered and billed orders leave the list, filter brings them back, and the Estimate shows a loss in words', async ({ page }) => {
    await prep(page);
    await page.evaluate(() => {
      const mk = (id, no, status, extra) => Object.assign({ id, ordNo: no, createdAt: new Date().toISOString(), customer: 'E2E ' + no, phone: '', status, delivery: '2030-01-01', items: [{ desc: 'Ring', metal: 'gold', purity: '22K', estWt: 10, qty: 1, making: 0 }], quote: 1000, advance: 0, ledger: [] }, extra || {});
      S.orders = [mk('o1', 'ORD-T1', 'new'), mk('o2', 'ORD-T2', 'progress'), mk('o3', 'ORD-T3', 'delivered', { billedSaleId: 's1', billedInvNo: 'INV-1' }), mk('o4', 'ORD-T4', 'delivered')];
    });
    await goToTab(page, 'orders');
    await page.evaluate(() => { renderOrders(); renderOrdersPipeline(); });
    const pipe = page.locator('#orders-pipeline');
    for (const label of ['New', 'Making', 'Ready', 'Done']) await expect(pipe).toContainText(label);
    for (const gone of ['Design', 'Polish', 'QC']) await expect(pipe).not.toContainText(gone);
    const list = page.locator('#ord-list');
    await expect(list).toContainText('ORD-T1');
    await expect(list).toContainText('ORD-T4');          // delivered but not billed yet: still listed
    await expect(list).not.toContainText('ORD-T3');      // delivered and billed: gone
    await page.evaluate(() => { document.getElementById('ord-filter').value = 'delivered'; renderOrders(); });
    await expect(list).toContainText('ORD-T3');
    await expect(pipe).toContainText('Est. loss');       // 1,000 quote against ten grams of gold
  });

  test('5 orders: Assign to Karigar is a form (no browser pop-ups) and saves the stage', async ({ page }) => {
    await prep(page);
    let dialogs = 0; page.on('dialog', (d) => { dialogs++; d.dismiss(); });
    await page.evaluate(() => {
      S.orders = [{ id: 'o1', ordNo: 'ORD-K1', createdAt: new Date().toISOString(), customer: 'E2E K', phone: '', status: 'progress', delivery: '2030-01-01', items: [{ desc: 'Ring', metal: 'gold', purity: '22K', estWt: 5, qty: 1, making: 0 }], quote: 50000, advance: 0, ledger: [] }];
      openAssignKarigarModal('o1');
    });
    const modal = page.locator('#assign-kg-modal.open');
    await expect(modal).toBeVisible();
    await modal.locator('#ak-name').fill('E2E Karigar');
    await modal.locator('#ak-task').fill('Setting');
    await modal.locator('#ak-cost').fill('300');
    await modal.getByRole('button', { name: 'Assign' }).click();
    await expect(modal).toBeHidden();
    const st = await page.evaluate(() => S.orders[0].items[0].karigarStages[0]);
    expect(st.task).toBe('Setting');
    expect(st.karigarCost).toBe(300);
    expect(dialogs).toBe(0);
  });

  test('6 girvi: top-up, statement, photos, financier placement and profile', async ({ page }) => {
    await prep(page);
    await page.evaluate((png) => {
      S.girvi = [{ id: 'g1', grvNo: 'GRV-E2E', customer: 'E2E Ramesh', phone: '9000000001', principal: 50000, interestRate: 2, rateType: 'monthly', compound: false, startDate: dbDayKey(new Date(Date.now() - 60 * 86400000)), status: 'active', customerId: 'c1', item: { type: 'Chain', purity: '22K', weight: 20 }, payments: [], ledger: [] }];
      S.customers = [{ id: 'c1', name: 'E2E Ramesh', phone: '9000000001', ornamentPhotos: [{ id: 'ph1', girviId: 'g1', dataUrl: png, ts: new Date().toISOString() }] }];
      S.girviCfg = { financiers: [] };
    }, PNG);
    await goToTab(page, 'girvi');
    await page.evaluate(() => renderGirvi());
    const card = page.locator('.girvi-card', { hasText: 'E2E Ramesh' });
    await expect(card).toBeVisible();
    // top-up
    await card.getByRole('button', { name: /top-up/i }).click();
    await page.locator('#gl-amount').fill('10000');
    await page.getByRole('button', { name: /record entry/i }).click();
    await expect.poll(() => page.evaluate(() => S.girvi[0].payments.map((p) => p.type).join(','))).toBe('topup');
    const out = await page.evaluate(() => dbAutoLines(dbDayKey(new Date())).filter((l) => l.src === 'girvi' && l.cat === 'girvi-topup').map((l) => l.dir + l.amount).join());
    expect(out).toBe('out10000');
    await page.evaluate(() => closeGirviLedgerModal());
    // detail: statement and photos
    await page.evaluate(() => openGirviDetail('g1'));
    const detail = page.locator('summary', { hasText: 'Day-by-day statement' });
    await detail.scrollIntoViewIfNeeded();
    await detail.click();
    await expect(page.getByText('Loan given')).toBeVisible();
    await expect(page.getByText('Still owed')).toBeVisible();
    const photos = page.locator('summary', { hasText: 'View photos of the ornament' });
    await photos.scrollIntoViewIfNeeded();
    await photos.click();
    await page.locator('button[onclick^="openPhotoViewer"]').first().click();
    await expect(page.locator('#photo-viewer')).toBeVisible();
    await page.evaluate(() => { pvSetZoom(2); });
    const w = await page.evaluate(() => document.getElementById('pv-img').style.width);
    expect(w).toBe('200%');
    await page.evaluate(() => { closePhotoViewer(); });
    await page.evaluate(() => closeGirviDetail && closeGirviDetail());
    // place with a new financier, then the profile
    await page.evaluate(() => { renderGirvi(); });
    await page.evaluate(() => girviFinancierBtn('g1'));
    const fm = page.locator('#fin-modal.open');
    await expect(fm).toContainText('with a financier');
    await fm.locator('#pf-pick').selectOption('__new');
    await fm.locator('#pf-name').fill('E2E Finance');
    await fm.locator('#pf-rate').fill('1');
    await fm.getByRole('button', { name: /place with financier/i }).click();
    await expect(fm).toContainText('E2E Finance');
    await expect(fm).toContainText('GRV-E2E');
    const linked = await page.evaluate(() => ({ id: !!S.girvi[0].financerId, n: finList().length }));
    expect(linked).toEqual({ id: true, n: 1 });
    // pay the financier: Day Book debit
    await fm.locator('#fin-pay-amt').fill('250');
    await fm.getByRole('button', { name: /record payment/i }).click();
    await expect.poll(() => page.evaluate(() => finList()[0].payments.length)).toBe(1);
    const debit = await page.evaluate(() => (S.dayBook.entries || []).some((e) => e.dir === 'out' && e.amount === 250 && /E2E Finance/.test(e.note)));
    expect(debit).toBe(true);
  });

  test('7 day book: credit left, debit right, GPay account balance, cash totals untouched', async ({ page }) => {
    await prep(page);
    await goToTab(page, 'daybook');
    await expect(page.getByText('Set up your Day Book')).toHaveCount(0);
    const before = await page.evaluate(() => { const v = dbDayView(dbToday()); return { in: v.totalIn, out: v.totalOut }; });
    await page.evaluate(() => { renderDayBook(); });
    await page.getByRole('button', { name: '+ Account' }).click();
    await page.locator('#db-acct-name').fill('E2E GPay');
    await page.locator('#db-acct-open').fill('1000');
    await page.getByRole('button', { name: 'Save Account' }).click();
    await expect(page.locator('#db-body')).toContainText('E2E GPay');
    // credit through the account
    await page.getByRole('button', { name: '+ Add Entry' }).click();
    await page.locator('.db-cat-chip').first().click();
    await page.locator('#db-entry-amt').fill('300');
    await page.locator('#db-entry-note').fill('E2E nose pin sold');
    await page.locator('#db-entry-acct').selectOption({ label: 'E2E GPay' });
    await page.getByRole('button', { name: 'Save Entry' }).click();
    await expect(page.locator('#db-body')).toContainText('E2E nose pin sold');
    // cash debit
    await page.getByRole('button', { name: '+ Add Entry' }).click();
    await page.locator('.db-cat-chip').nth(1).click();
    await page.locator('#db-entry-amt').fill('75');
    await page.locator('#db-entry-note').fill('E2E tea');
    await page.getByRole('button', { name: 'Save Entry' }).click();
    const after = await page.evaluate(() => { const v = dbDayView(dbToday()); return { in: v.totalIn, out: v.totalOut, bal: dbAccountBalance(S.dayBook.accounts.filter((a) => a.name === 'E2E GPay')[0].id) }; });
    expect(after.bal).toBe(1300);
    expect(after.in).toBe(before.in);            // the GPay credit never touches cash
    expect(after.out).toBe(before.out + 75);
    // left column holds the credit, right column the debit
    const left = await page.locator('#db-body').getByText('CREDIT').locator('xpath=ancestor::div[contains(@class,"card")][1]').textContent();
    const right = await page.locator('#db-body').getByText('DEBIT').locator('xpath=ancestor::div[contains(@class,"card")][1]').textContent();
    expect(left).toContain('E2E nose pin sold');
    expect(right).toContain('E2E tea');
    expect(left).not.toContain('E2E tea');
  });

  test('8 purchases: supplier profile pays the oldest bill first', async ({ page }) => {
    await prep(page);
    await goToTab(page, 'stock');
    await page.evaluate(() => {
      S.purchases = [
        { id: 'b1', billNo: 'E2E-1', date: '2026-10-01', supplier: 'E2E Bullion', totalAmount: 3000, amountPaid: 0, supplierPayments: [] },
        { id: 'b2', billNo: 'E2E-2', date: '2026-10-20', supplier: 'E2E Bullion', totalAmount: 5000, amountPaid: 0, supplierPayments: [] }];
      switchInvSub('purchases');
    });
    await page.locator('#pbsl-table-wrap tr:visible, #pbsl-cards .inv-card:visible').filter({ hasText: 'E2E Bullion' }).first().click();
    const m = page.locator('#pbsup-modal.open');
    await expect(m).toContainText('8,000');
    await m.locator('#spf-amt').fill('3500');
    await m.getByRole('button', { name: /record payment/i }).click();
    await expect.poll(() => page.evaluate(() => S.purchases.map((b) => b.id + ':' + b.pendingAmount).join(','))).toBe('b1:0,b2:4500');
  });

  test('9 labels: the printed barcode is real bars, with weights on the tag', async ({ page, context }) => {
    await prep(page);
    await page.evaluate(() => {
      S.products = [{ id: 'l1', name: 'Label Ring', sku: 'LBL-001', cat: 'Rings', metal: 'gold', purity: '22K', weight: 5, netWeight: 4.6, stoneWt: 0.4, huid: '', status: 'available', qty: 1, mcRate: 0, costRate: 6000 }];
    });
    const [popup] = await Promise.all([context.waitForEvent('page'), page.evaluate(() => openBarcodeLabels(['l1']))]);
    await popup.waitForLoadState();
    const bars = await popup.locator('.lbar svg rect').count();
    expect(bars).toBeGreaterThan(20);
    const text = await popup.locator('.lbl').first().textContent();
    expect(text).toContain('LBL-001');
    expect(text).toContain('Net 4.60g');
    expect(text).toContain('Stone 0.40g');
    expect(await popup.locator('select option').count()).toBe(2);   // A4 sheet / tag printer
    await popup.close();
  });

  test('10 settings: sample data loads behind a progress bar and Clear removes it', async ({ page }) => {
    await prep(page);
    await page.evaluate(() => {
      S.products = []; S.sales = []; S.orders = []; S.girvi = []; S.customers = []; S.purchases = []; S.suppliers = []; S.karigars = []; S.karigarPayments = [];
      S.kgJobs = []; S.kgLedger = []; S.kgSalary = []; S.kgAgreements = []; S.kgRoutes = []; S.kgParked = [];
      S.dayBook = { opening: null, entries: [], closes: [], accounts: [] }; S.girviCfg = { financiers: [] };
      window.prompt = function () { return 'DEMO'; };
      DEMO_STEP_MS = 120;
      loadDemoData();
    });
    await expect(page.locator('#demo-loading')).toBeVisible();
    await expect(page.locator('#demo-loading')).toContainText('Loading sample data');
    await expect(page.locator('#demo-loading')).toBeHidden({ timeout: 15000 });
    const n = await page.evaluate(() => ({ c: S.customers.length, p: S.purchases.length, f: finList().length, g: S.girvi.length, s: S.sales.length }));
    expect(n.c).toBeGreaterThanOrEqual(5);
    expect(n.p).toBe(2); expect(n.f).toBe(1); expect(n.g).toBeGreaterThan(0); expect(n.s).toBeGreaterThan(0);
    await goToTab(page, 'stock');
    await page.evaluate(() => switchInvSub('purchases'));
    await expect(page.locator('#inv-sub-purchases')).toContainText('Demo Bullion Traders');
  });
});
