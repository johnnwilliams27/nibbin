import assert from 'node:assert/strict';
import { chromium } from 'playwright';
const base=process.env.REVIEW_TEST_URL ?? 'http://localhost:3100';
assert.ok(['localhost','127.0.0.1'].includes(new URL(base).hostname));
const browser=await chromium.launch({channel:'chrome',headless:true});
try {
 const context=await browser.newContext();
 await context.route('**/*',route=>new URL(route.request().url()).origin===new URL(base).origin?route.continue():route.abort());
 const page=await context.newPage();
 for(const [query,label] of [['','Our assessment'],['?sort=invalid','Our assessment'],['?sort=name','Name A–Z']]) {
  await page.goto(`${base}/compare/${query}`);
  const sort=page.getByRole('button',{name:/^Sort /});
  await sort.waitFor();
  await page.waitForFunction(({label})=>[...document.querySelectorAll('button[aria-haspopup="listbox"]')].some(el=>el.textContent.includes(label)),{label});
  assert.match(await sort.textContent(),new RegExp(label));
 }
 console.log('PASS no-query and invalid default Our assessment; explicit name URL honored');
 await context.close();
}finally{await browser.close();}
