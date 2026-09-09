// Local-only isolated browser; no user profile, wallet, or external requests.
import assert from 'node:assert/strict';
import { chromium } from 'playwright';
const base=process.env.REVIEW_TEST_URL ?? 'http://localhost:3100';
assert.ok(['localhost','127.0.0.1'].includes(new URL(base).hostname));
const browser=await chromium.launch({channel:'chrome',headless:true});
try {
 const context=await browser.newContext({viewport:{width:1280,height:1000},reducedMotion:'reduce'});
 await context.route('**/*',route=>new URL(route.request().url()).origin===new URL(base).origin?route.continue():route.abort());
 const page=await context.newPage();
 await page.goto(`${base}/compare/`);
 await page.locator('[data-card-base]').first().waitFor();
 const read=()=>page.locator('.agent-card').evaluateAll(cards=>cards.map(card=>({top:card.offsetTop,base:card.querySelector('[data-card-base]').getBoundingClientRect().height,natural:card.querySelector('[data-card-natural]').getBoundingClientRect().height,total:card.getBoundingClientRect().height})));
 // Vary local DOM-only content to exercise async review/title wrapping as well as current dataset.
 await page.locator('[data-card-natural]').first().evaluate(el=>{const p=document.createElement('p');p.textContent='A longer buyer review summary arriving after the first render, with enough words to wrap across several lines.';el.appendChild(p);});
 await page.waitForFunction(()=>{const cards=[...document.querySelectorAll('.agent-card')];return cards.length>2&&cards.every(card=>{const peers=cards.filter(other=>other.offsetTop===card.offsetTop);return peers.every(other=>Math.abs(other.querySelector('[data-card-base]').getBoundingClientRect().height-card.querySelector('[data-card-base]').getBoundingClientRect().height)<1);});});
 const desktop=await read();
 assert.ok(desktop.some((card,i)=>i>0&&card.natural!==desktop[0].natural),'varied natural heights');
 const peers=desktop.map((card,i)=>card.top===desktop[0].top?i:-1).filter(i=>i>0);
 assert.ok(peers.length>0,'desktop has adjacent cards');
 await page.getByRole('button',{name:'Show details',exact:true}).first().click();
 await page.waitForFunction(()=>document.querySelector('.agent-card-disclosure[data-expanded="true"]').getBoundingClientRect().height>0);
 const expanded=await read();
 assert.ok(expanded[0].total>desktop[0].total);
 for(const i of peers){assert.equal(expanded[i].total,desktop[i].total);assert.equal(expanded[i].base,desktop[i].base);}
 const scores=await page.locator('[aria-label^="Trust Index score:"]').evaluateAll(elements=>elements.map(el=>{const spans=el.querySelectorAll('span');return [getComputedStyle(spans[spans.length-2]).fontSize,getComputedStyle(spans[spans.length-1]).fontSize];}));
 assert.ok(scores.length>0);for(const [numerator,denominator]of scores)assert.equal(numerator,denominator);
 await page.setViewportSize({width:390,height:844});
 await page.waitForFunction(()=>[...document.querySelectorAll('[data-card-base]')].every(el=>Math.abs(el.getBoundingClientRect().height-Math.ceil(el.querySelector('[data-card-natural]').getBoundingClientRect().height))<1));
 const mobile=await read();assert.equal(new Set(mobile.map(card=>card.top)).size,mobile.length);
 assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
 console.log('PASS desktop row equality, varied asynchronous content, independent expansion, equal score font sizes, mobile natural heights/no overflow');
 await context.close();
} finally {await browser.close();}
