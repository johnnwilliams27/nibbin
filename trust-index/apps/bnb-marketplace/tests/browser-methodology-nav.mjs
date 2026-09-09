import assert from 'node:assert/strict';
import { chromium } from 'playwright';
const base = 'http://localhost:3100';
const browser = await chromium.launch({ channel: 'chrome', headless: true });
try {
  for (const width of [390, 1280]) {
    const context = await browser.newContext({ viewport: { width, height: 844 } });
    await context.route('**/*', route => new URL(route.request().url()).origin === base ? route.continue() : route.abort());
    const page = await context.newPage();
    page.setDefaultTimeout(5000);
    try {
      await page.goto(`${base}/methodology/`);
      const links = page.getByRole('navigation', { name: 'Methodology sections' }).getByRole('link');
      for (const link of await links.all()) {
        await page.getByRole('heading', { level: 1 }).hover();
        const before = await link.evaluate(el => getComputedStyle(el).backgroundColor);
        await link.hover();
        await page.waitForFunction(el => getComputedStyle(el).backgroundColor !== 'rgba(0, 0, 0, 0)', await link.elementHandle());
        assert.notEqual(await link.evaluate(el => getComputedStyle(el).backgroundColor), before, 'section link has visible hover feedback');
        const bounds = await link.boundingBox();
        assert.ok(bounds.height >= 44, 'section links have a comfortable touch target');
      }
      await page.keyboard.press('Tab');
      await links.first().focus();
      assert.equal(await links.first().evaluate(el => getComputedStyle(el).outlineStyle), 'solid');
      await page.getByRole('navigation', { name: 'Methodology sections' }).getByRole('link', { name: 'Evidence', exact: true }).click();
      assert.equal(new URL(page.url()).hash, '#evidence');
      console.log(`PASS ${width}px: all section hover states, touch targets, focus, anchor navigation`);
    } finally { await context.close(); }
  }
} finally { await browser.close(); }
