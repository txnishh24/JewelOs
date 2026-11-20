// "Export everything (Excel)" in Settings downloads one .xlsx with a sheet per topic.
// Only checks that a real zip file (PK header) comes down with a sensible name and size; the sheets are checked in regression.test.js.
const fs = require('fs');
const { test, expect } = require('@playwright/test');
const { login, goToTab } = require('./fixtures/testShop');

test.describe('excel export', () => {
  test('the Settings button downloads an .xlsx file', async ({ page }) => {
    await login(page);
    await goToTab(page, 'settings');
    await page.locator('[data-tab="data"]').click();
    const btn = page.locator('#xl-export-btn');
    await btn.scrollIntoViewIfNeeded();
    await expect(btn).toBeVisible();
    const [download] = await Promise.all([page.waitForEvent('download', { timeout: 20000 }), btn.click()]);
    expect(download.suggestedFilename()).toMatch(/-all-data-\d{4}-\d{2}-\d{2}\.xlsx$/);
    const path = await download.path();
    const bytes = fs.readFileSync(path);
    expect(bytes.length).toBeGreaterThan(2000);
    expect(bytes.slice(0, 2).toString()).toBe('PK');
  });
});
