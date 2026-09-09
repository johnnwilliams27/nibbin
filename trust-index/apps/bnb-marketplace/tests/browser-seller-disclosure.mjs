// Start the local preview, then: node tests/browser-seller-disclosure.mjs
import assert from 'node:assert/strict';
import { chromium } from 'playwright';
const base = process.env.REVIEW_TEST_URL ?? 'http://localhost:3100';
assert.ok(['localhost','127.0.0.1'].includes(new URL(base).hostname));
const browser = await chromium.launch({channel:'chrome',headless:true});
try {
  for(const reducedMotion of ['no-preference','reduce']) {
    const context = await browser.newContext({reducedMotion});
    try {
      await context.route('**/*', route => new URL(route.request().url()).origin === new URL(base).origin ? route.continue() : route.abort());
      const page = await context.newPage();
      await page.addInitScript(()=>{window.walletCalls=0;window.ethereum={request:()=>{window.walletCalls++;throw new Error('No wallet call allowed in disclosure test');}};});
      await page.goto(`${base}/try/`);
      const button = page.getByRole('button',{name:'Seller and contract details'});
      await button.waitFor();
      const panelId = await button.getAttribute('aria-controls');
      const read = () => page.evaluate(id => {const el=document.getElementById(id);return {inert:el.inert,hidden:el.getAttribute('aria-hidden'),height:el.getBoundingClientRect().height,animated:el.getAnimations().some(a=>a.playState==='running')};},panelId);
      assert.equal((await read()).height,0);
      assert.equal((await read()).inert,true);
      await button.focus();
      await page.keyboard.press('Enter');
      assert.equal(await button.getAttribute('aria-expanded'),'true');
      let opening=await read();
      assert.equal(opening.inert,false);
      if(reducedMotion==='no-preference') assert.equal(opening.animated,true,'opening must transition');
      await page.waitForFunction(id=>!document.getElementById(id).getAnimations().some(a=>a.playState==='running'),panelId);
      assert.ok((await read()).height>0);
      await page.keyboard.press('Space');
      assert.equal(await button.getAttribute('aria-expanded'),'false');
      const closing=await read();
      assert.equal(closing.inert,true,'closed content becomes inert immediately, not after animation');
      assert.equal(closing.hidden,'true');
      if(reducedMotion==='no-preference') assert.equal(closing.animated,true,'closing must transition without unmounting');
      else assert.equal(closing.animated,false,'reduced motion must not animate');
      await page.waitForFunction(id=>document.getElementById(id).getBoundingClientRect().height===0,panelId);
      assert.equal(await button.evaluate(el=>document.activeElement===el),true);
      assert.equal(await page.evaluate(()=>window.walletCalls),0);
      console.log(`PASS ${reducedMotion}: keyboard open/close, inert closed panel, bidirectional motion, zero wallet calls`);
    } finally {await context.close();}
  }
} finally {await browser.close();}
