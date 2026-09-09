import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import ts from 'typescript';

const source = fileURLToPath(new URL('../src/', import.meta.url));
const require = createRequire(import.meta.url), modules = new Map();
function load(path) {
  if (modules.has(path)) return modules.get(path).exports;
  const module = { exports: {} }; modules.set(path, module);
  const compiled = ts.transpileModule(readFileSync(path, 'utf8'), {
    compilerOptions: { jsx: ts.JsxEmit.ReactJSX, module: ts.ModuleKind.CommonJS, esModuleInterop: true, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  new Function('require', 'module', 'exports', compiled)((specifier) => {
    if (!specifier.startsWith('.') && !specifier.startsWith('@/')) return require(specifier);
    const base = specifier.startsWith('@/') ? resolve(source, specifier.slice(2)) : resolve(dirname(path), specifier);
    const target = [base, `${base}.tsx`, `${base}.ts`].find(existsSync);
    assert.ok(target, `Local import resolves: ${specifier}`);
    return load(target);
  }, module, module.exports);
  return module.exports;
}
const { HireFlow } = load(resolve(source, 'components/HireFlow.tsx'));
const props = { chainId: 97, reference: true, providerAddress: '0x1234567890123456789012345678901234567890', sellerEndpoint: 'https://seller.example/api/agent' };

test('seller details have a persistent inert panel controlled by an accessible button', () => {
  const html = renderToStaticMarkup(createElement(HireFlow, props));
  const trigger = html.match(/<button[^>]*aria-expanded="false"[^>]*>Seller and contract details[\s\S]*?<\/button>/);
  assert.ok(trigger, 'seller disclosure must expose a keyboard button and explicit closed state');
  const target = trigger[0].match(/aria-controls="([^"]+)"/);
  assert.ok(target);
  const panel = html.match(new RegExp(`<div id="${target[1]}"[^>]*>`));
  assert.ok(panel, 'panel remains mounted so closing can animate');
  assert.match(panel[0], /aria-hidden="true"/);
  assert.match(panel[0], /inert=""/);
  assert.match(html, /https:\/\/seller.example\/api\/agent/);
  assert.match(html, /Your task, inputs and signed terms become permanently public on-chain/);
});

test('multiple hire disclosures do not share a controlled-panel identifier', () => {
  const html = renderToStaticMarkup(createElement('div', null, createElement(HireFlow, props), createElement(HireFlow, props)));
  const targets = [...html.matchAll(/<button[^>]*aria-controls="([^"]+)"[^>]*>Seller and contract details/g)].map(match => match[1]);
  assert.equal(targets.length, 2);
  assert.equal(new Set(targets).size, 2);
});
