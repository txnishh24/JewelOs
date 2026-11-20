// The tag barcode must be a REAL Code 128: draw the label barcode the app prints, then read it back with the same
// scanner library the app uses on iPhones (html5-qrcode from cdnjs, so this needs internet). Also checks that
// looking up a scanned code shows the right item. Does not test the live camera (needs a phone).
const { test, expect } = require('@playwright/test');
const { login } = require('./fixtures/testShop');

test.describe('barcode scan', () => {
  test('printed barcodes decode back to the SKU, and the lookup card shows the item', async ({ page }) => {
    await login(page);
    const out = await page.evaluate(() => new Promise((resolve) => {
      _scanLoadLib(async (ok) => {
        if (!ok) return resolve({ loaded: false });
        const holder = document.createElement('div'); holder.id = 'bc-test-holder'; holder.style.display = 'none'; document.body.appendChild(holder);
        const results = [];
        for (const sku of ['GLD-001', 'SLV-042', 'ITEM-9', 'NP-22K-0007']) {
          const svg = _barcodeSVG(sku);
          const img = new Image();
          await new Promise((r) => { img.onload = r; img.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg); });
          const c = document.createElement('canvas'); c.width = 600; c.height = 160;
          const ctx = c.getContext('2d'); ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, 600, 160); ctx.drawImage(img, 0, 20, 600, 120);
          const blob = await new Promise((r) => c.toBlob(r, 'image/png'));
          const lib = new Html5Qrcode('bc-test-holder', { formatsToSupport: [Html5QrcodeSupportedFormats.CODE_128], verbose: false });
          let text = null;
          try { text = await lib.scanFile(new File([blob], 'b.png', { type: 'image/png' }), false); } catch (e) { text = 'ERR ' + e; }
          results.push({ sku, text });
        }
        // lookup card
        S.products.push({ id: 'bc-p1', name: 'Scan Test Ring', sku: 'SCAN-TEST-1', cat: 'Rings', metal: 'gold', purity: '22K', weight: 5, netWeight: 4.6, stoneWt: 0.4, huid: '', status: 'available', qty: 1 });
        openScanModal(); scanStop(); scanShow('scan-test-1');
        const card = document.getElementById('scan-result').textContent;
        S.products = S.products.filter((p) => p.id !== 'bc-p1');
        resolve({ loaded: true, results, card });
      });
    }));
    expect(out.loaded, 'scanner library did not load (offline?)').toBe(true);
    for (const r of out.results) expect(r.text, 'barcode for ' + r.sku).toBe(r.sku);
    expect(out.card).toContain('Scan Test Ring');
    expect(out.card).toContain('22K');
    expect(out.card).toContain('In stock');
  });
});
