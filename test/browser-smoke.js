'use strict';

// Optional browser smoke test. Run against a local docs server with:
// PLAYWRIGHT_MODULE=/path/to/playwright node test/browser-smoke.js
const assert = require('node:assert/strict');
const playwright = require(process.env.PLAYWRIGHT_MODULE || 'playwright');

(async () => {
  const browser = await playwright.chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1200, height: 900 } });
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto(process.env.LINES_URL || 'http://127.0.0.1:4173');
  assert.equal(await page.locator('.cell').count(), 81);

  await page.getByRole('button', { name: 'Analysis off' }).click();
  await page.getByText('Position analyzed').waitFor();
  assert.equal(await page.locator('#analyzeBtn').getAttribute('aria-pressed'), 'true');
  assert.notEqual(await page.locator('#engineMove').textContent(), '—');
  assert.equal(await page.locator('.suggest-start').count(), 1);
  assert.equal(await page.locator('.suggest-end').count(), 1);
  assert.ok(await page.locator('.candidate').count() >= 1);

  await page.getByRole('button', { name: 'Next move' }).click();
  await page.waitForFunction(() => document.querySelector('#turn').textContent === '1');
  await page.locator('.suggest-start').waitFor();
  await page.getByText('Position analyzed').waitFor();
  assert.notEqual(await page.locator('#engineMove').textContent(), '—');
  assert.equal(await page.locator('.suggest-start').count(), 1);
  assert.equal(await page.locator('.suggest-end').count(), 1);
  assert.deepEqual(errors, []);
  await browser.close();
  console.log('browser smoke test passed');
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
