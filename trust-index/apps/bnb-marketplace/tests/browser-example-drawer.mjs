import assert from 'node:assert/strict';
import { chromium } from 'playwright';

const base = 'http://localhost:3100';
const browser = await chromium.launch({ channel: 'chrome', headless: true });
try {
  for (const width of [390, 1280]) {
    for (const reducedMotion of ['no-preference', 'reduce']) {
      const context = await browser.newContext({ viewport: { width, height: 844 }, reducedMotion });
      await context.route('**/*', route => new URL(route.request().url()).origin === base ? route.continue() : route.abort());
      const page = await context.newPage();
      page.setDefaultTimeout(5000);
      try {
        await page.goto(`${base}/try/`);
        const input = page.getByLabel('Collateral value', { exact: true });
        await input.fill('13500');
        const trigger = page.getByRole('button', { name: 'View an example result' });
        const dialog = page.getByRole('dialog');
        await trigger.click();
        await dialog.waitFor();
        const entry = await dialog.evaluate(el => el.getAnimations().filter(a => a.effect?.target === el).map(a => a.effect.getKeyframes()));
        if (reducedMotion === 'reduce') assert.equal(entry.length, 0);
        else assert.ok(entry.some(frames => frames.some(frame => frame.transform?.includes('100%'))), 'drawer enters from the right');
        await dialog.evaluate(el => Promise.all(el.getAnimations().map(a => a.finished.catch(() => {}))));
        const bounds = await dialog.boundingBox();
        assert.ok(bounds.x >= -1 && bounds.x + bounds.width <= width + 1, 'drawer fits viewport');
        assert.equal(await dialog.getByRole('button', { name: 'Close', exact: true }).evaluate(el => document.activeElement === el), true);
        // Pause the real exit to check modality before allowing it to finish.
        await dialog.evaluate(el => {
          el.querySelector('button').click();
          for (const animation of el.getAnimations()) animation.pause();
        });
        if (reducedMotion === 'no-preference') {
          assert.equal(await dialog.evaluate(el => el.open && el.matches(':modal')), true, 'focus trap remains active during exit');
          await dialog.evaluate(el => { for (const animation of el.getAnimations()) animation.finish(); });
        }
        await dialog.waitFor({ state: 'hidden' });
        await page.waitForFunction(() => document.activeElement?.textContent?.includes('View an example result'));
        assert.equal(await input.inputValue(), '13500');
        await trigger.click();
        await page.keyboard.press('Escape');
        await dialog.waitFor({ state: 'hidden' });
        await page.waitForFunction(() => document.body.style.overflow !== 'hidden');
        assert.equal(await input.inputValue(), '13500');
        console.log(`PASS ${width}px / ${reducedMotion}: entry, modal exit, Escape, focus, retained input`);
      } finally { await context.close(); }
    }
  }
} finally { await browser.close(); }
