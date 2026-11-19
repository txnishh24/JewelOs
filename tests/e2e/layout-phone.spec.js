// R34 A + B: phone layout. Bill preview must be scaled to fit, and no tab may scroll sideways, at 390 and 360 wide.
// isMobile + hasTouch gives (pointer:coarse), which is what a real phone reports; the R32 CSS used to sit inside a
// (hover:hover) and (pointer:fine) block and so never applied on a phone (found R34).
const { test, expect } = require('@playwright/test');
const { login, goToTab } = require('./fixtures/testShop');

const WIDTHS = [390, 360];
const TABS = ['home', 'stock', 'sale', 'girvi', 'orders', 'customers', 'reports', 'daybook', 'settings'];

for (const w of WIDTHS) {
  test.describe('phone layout ' + w, () => {
    test.use({ viewport: { width: w, height: 800 }, isMobile: true, hasTouch: true });

    test('bill preview fits (GST and memo)', async ({ page }) => {
      await login(page);
      for (const bt of ['gst', 'memo']) {
        const m = await page.evaluate(async (bt) => {
          var sale = (S.sales || [])[0];
          if (!sale) return { nosale: true };
          openInvoiceModal(buildInvoiceHTML(sale, bt), bt);
          CURRENT_SALE_FOR_PDF = sale;
          await new Promise(function (r) { setTimeout(r, 400); });
          var wrap = document.getElementById('inv-frame-wrap');
          var f = document.getElementById('inv-frame');
          var fr = f.getBoundingClientRect();
          var wr = wrap.getBoundingClientRect();
          return {
            nosale: false, wrapW: Math.round(wr.width), frameVisualW: Math.round(fr.width),
            scale: wrap.style.getPropertyValue('--inv-scale'),
            pageOverflow: document.documentElement.scrollWidth - window.innerWidth,
            frameRight: Math.round(fr.right), innerW: window.innerWidth
          };
        }, bt);
        test.skip(m.nosale, 'e2e shop has no sale yet');
        console.log('INVOICE ' + w + ' ' + bt + ' ' + JSON.stringify(m));
        expect(m.frameVisualW).toBeLessThanOrEqual(m.wrapW + 1);
        expect(m.pageOverflow).toBeLessThanOrEqual(0);
        // the scaled invoice's right edge (table) is inside the frame
        const fr = page.frames().find(function (x) { return x !== page.mainFrame() && x.parentFrame() === page.mainFrame(); });
        const tbl = await fr.evaluate(function () {
          var t = document.querySelector('table'); return t ? Math.round(t.getBoundingClientRect().right) : 0;
        });
        console.log('INVOICE ' + w + ' ' + bt + ' table right edge in invoice px ' + tbl);
        expect(tbl).toBeLessThanOrEqual(720);
      }
    });

    test('no tab scrolls sideways; bottom-nav labels not cut', async ({ page }) => {
      await login(page);
      const bad = [];
      for (const t of TABS) {
        await goToTab(page, t);
        await page.waitForTimeout(500);
        const r = await page.evaluate(function () {
          var over = document.documentElement.scrollWidth - window.innerWidth;
          var offender = '';
          if (over > 0) {
            var worst = 0;
            document.querySelectorAll('body *').forEach(function (el) {
              var rc = el.getBoundingClientRect();
              if (rc.width > 0 && rc.right > window.innerWidth + 1 && el.offsetParent !== null && rc.right > worst) {
                worst = rc.right; offender = el.tagName + '#' + el.id + '.' + (el.className && el.className.baseVal === undefined ? el.className : '') + ' right=' + Math.round(rc.right);
              }
            });
          }
          return { over: over, offender: offender };
        });
        console.log('TAB ' + w + ' ' + t + ' over=' + r.over + ' ' + r.offender);
        if (r.over > 0) bad.push(t + ': ' + r.offender);
      }
      const cut = await page.evaluate(function () {
        var out = [];
        document.querySelectorAll('.bnav-label').forEach(function (el) { if (el.offsetParent !== null && el.scrollWidth > el.clientWidth + 1) out.push(el.textContent); });
        return out;
      });
      console.log('NAV-CUT ' + w + ' ' + JSON.stringify(cut));
      expect(bad, 'tabs that scroll sideways').toEqual([]);
      expect(cut).toEqual([]);
    });
    // Cowork saw Reports scroll sideways (418px on 360) for manager and read-only. We cannot log in as those roles here, so the
    // role is switched on the signed-in owner session and the tab re-opened; the Reports render reads isOwner()/isStaff() live.
    test('Reports does not scroll sideways for manager, staff, read-only', async ({ page }) => {
      await login(page);
      for (const role of ['manager', 'staff', 'readonly']) {
        await page.evaluate((r) => { SAAS.user.role = r; }, role);
        await goToTab(page, 'reports');
        await page.waitForTimeout(600);
        const r = await page.evaluate(function () {
          var over = document.documentElement.scrollWidth - window.innerWidth, off = '';
          if (over > 0) { var worst = 0;
            document.querySelectorAll('body *').forEach(function (el) { var rc = el.getBoundingClientRect();
              if (rc.width > 0 && rc.right > window.innerWidth + 1 && el.offsetParent !== null && rc.right > worst) { worst = rc.right; off = el.tagName + '#' + el.id + '.' + (typeof el.className === 'string' ? el.className : '') + ' right=' + Math.round(rc.right); } }); }
          return { over: over, off: off };
        });
        console.log('REPORTS ' + w + ' ' + role + ' over=' + r.over + ' ' + r.off);
        expect(r.over, role + ' ' + r.off).toBeLessThanOrEqual(0);
      }
    });
  });
}
