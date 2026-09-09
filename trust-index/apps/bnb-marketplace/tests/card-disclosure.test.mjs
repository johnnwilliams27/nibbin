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
const require = createRequire(import.meta.url);
const modules = new Map();
function loadComponent(path) {
  if (modules.has(path)) return modules.get(path).exports;
  const module = { exports: {} }; modules.set(path, module);
  const compiled = ts.transpileModule(readFileSync(path, 'utf8'), {
    compilerOptions: { jsx: ts.JsxEmit.ReactJSX, module: ts.ModuleKind.CommonJS, esModuleInterop: true },
  }).outputText;
  new Function('require', 'module', 'exports', compiled)((specifier) => {
    if (!specifier.startsWith('.') && !specifier.startsWith('@/')) return require(specifier);
    const base = specifier.startsWith('@/') ? resolve(source, specifier.slice(2)) : resolve(dirname(path), specifier);
    const target = [base, `${base}.tsx`, `${base}.ts`].find(existsSync);
    assert.ok(target, `Local import resolves: ${specifier}`);
    return loadComponent(target);
  }, module, module.exports);
  return module.exports;
}
const { AgentCard } = loadComponent(resolve(source, 'components/AgentCard.tsx'));

test('closed card has a stable inert disclosure target without mounting review details', () => {
  const agent = { agent_id: 'test', token_id: '1', chain_id: 97, name: 'Yield Agent', image_url: null,
    category: 'yield', description: 'Example description', assessment: null, protocols: [], endpoint: null, detail_status: 'read' };
  const html = renderToStaticMarkup(createElement(AgentCard, { agent }));
  const target = html.match(/aria-expanded="false" aria-controls="([^"]+)"/);
  assert.ok(target, 'closed trigger exposes its controlled details');
  const panel = html.match(new RegExp(`<div id="${target[1]}"[^>]*>`));
  assert.ok(panel, 'the panel must exist before first open so its height can transition');
  assert.match(panel[0], /aria-hidden="true"/);
  assert.match(panel[0], /inert=""/);
  assert.doesNotMatch(html, /Declared connection|<section[^>]*aria-label="Buyer reviews"/);
});
