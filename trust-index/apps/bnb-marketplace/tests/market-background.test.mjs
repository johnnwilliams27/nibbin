import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import ts from 'typescript';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
const require=createRequire(import.meta.url);
async function render(pathname) {
 const source=await readFile(new URL('../src/components/MarketBackground.tsx',import.meta.url),'utf8');
 const compiled=ts.transpileModule(source,{compilerOptions:{jsx:ts.JsxEmit.ReactJSX,module:ts.ModuleKind.CommonJS}}).outputText;
 const exports={};new Function('require','exports',compiled)(id=>id==='next/navigation'?{usePathname:()=>pathname}:require(id),exports);
 return renderToStaticMarkup(React.createElement(exports.MarketBackground));
}
test('home background includes a noninteractive decorative BNB mark',async()=>{const html=await render('/');assert.match(html,/market-bnb-mark/);assert.match(html,/aria-hidden="true"/);assert.match(html,/focusable="false"/);assert.doesNotMatch(html,/<a |<button /);});
test('every page uses the same decorative BNB mark inside the primary orbit',async()=>{const home=await render('/');for(const route of ['/try','/agents/42','/methodology','/categories/yield']){const html=await render(route);assert.match(html,/<div class="market-orbit market-orbit-one"><svg class="market-bnb-mark/);assert.equal(html,home);}});

test('mark shares the primary orbit coordinate system as it scales and moves',async()=>{
 const html=await render('/');
 assert.match(html, /<div class="market-orbit market-orbit-one"><svg class="market-bnb-mark/);
});
