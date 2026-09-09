import assert from 'node:assert/strict';
import { chromium } from 'playwright';
const base = 'http://localhost:3100';
const browser = await chromium.launch({channel:'chrome',headless:true});
try {
  for (const width of [390,1280]) {
    const context = await browser.newContext({viewport:{width,height:844}});
    await context.route('**/*', route => new URL(route.request().url()).origin === base ? route.continue() : route.abort());
    const page = await context.newPage();
    page.setDefaultTimeout(3000);
    try {
      await page.goto(`${base}/try/`);
      const trigger = page.getByRole('button',{name:'What is a health factor?'});
      await trigger.focus();
      const tooltip = page.getByRole('tooltip');
      await tooltip.waitFor();
      assert.match(await tooltip.innerText(),/liquidation/i);
      assert.equal(await tooltip.evaluate(el=>getComputedStyle(el).backgroundColor),'rgb(23, 29, 38)','tooltip needs an opaque marketplace surface');
      assert.equal(await trigger.getAttribute('aria-describedby'),await tooltip.getAttribute('id'));
      const box=await tooltip.boundingBox();
      assert.ok(box.x>=0 && box.x+box.width<=width,'tooltip must fit the viewport');
      await page.keyboard.press('Escape');
      await tooltip.waitFor({state:'hidden'});
      assert.equal(await trigger.evaluate(el=>document.activeElement===el),true);
      await trigger.click();
      await tooltip.waitFor();
      await trigger.click();
      await tooltip.waitFor({state:'hidden'});
      await page.getByRole('heading',{name:'Try a hire',exact:true}).click();
      await trigger.hover();
      await tooltip.waitFor();
      await tooltip.hover();
      assert.equal(await tooltip.isVisible(),true,'hovering tooltip keeps it open');
      await page.getByRole('heading',{name:'Try a hire',exact:true}).click();
      await tooltip.waitFor({state:'hidden'});
      console.log(`PASS ${width}px: focus, Escape, tap toggle, hover, dismissal, viewport fit`);
    } finally {await context.close();}
  }
} finally {await browser.close();}
