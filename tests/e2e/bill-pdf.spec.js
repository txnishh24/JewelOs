// The bill PDF: builds a real PDF file in the browser (html2canvas + jsPDF from cdnjs, so this needs internet).
// Checks the file starts with %PDF and is a real size; does not look at how it is laid out (open one by eye).
const { test, expect } = require('@playwright/test');
const { login } = require('./fixtures/testShop');

test.describe('bill pdf', () => {
  test('buildBillPdfBlob returns a real PDF', async ({ page }) => {
    await login(page);
    const res = await page.evaluate(() => new Promise((resolve) => {
      const sale = { invNo: 'E2E-PDF-1', date: new Date().toISOString(), customer: 'PDF Test', phone: '', gst: 3,
        items: [{ name: 'Ring', purity: '22K', metal: 'gold', weight: 5, qty: 1, lockedRate: 7200, making: 500, diamond: 0 }] };
      buildBillPdfBlob(sale, 'gst', async (blob) => {
        if (!blob) return resolve({ ok: false });
        const head = new TextDecoder().decode(new Uint8Array(await blob.arrayBuffer()).slice(0, 5));
        resolve({ ok: true, head, size: blob.size, type: blob.type });
      });
    }));
    expect(res.ok, 'PDF was not produced (offline, or a library failed to load)').toBe(true);
    expect(res.head).toBe('%PDF-');
    expect(res.size).toBeGreaterThan(5000);
  });
});
