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
const { default: TryPage } = load(resolve(source, 'app/try/page.tsx'));

test('animated exit keeps the native dialog modal until animation finishes', async () => {
  const { closeExampleDrawer } = load(resolve(source, 'components/TryPageExtras.tsx'));
  assert.equal(typeof closeExampleDrawer, 'function');
  let finish;
  let closed = false;
  const dialog = { open: true, dataset: {}, close() { closed = true; }, animate() { return { finished: new Promise((resolve) => { finish = resolve; }), cancel() {} }; } };
  const closing = closeExampleDrawer(dialog, false);
  assert.equal(closed, false, 'background cannot become interactive during exit');
  finish(); await closing;
  assert.equal(closed, true);
});

test('reduced-motion exit closes immediately without animation', async () => {
  const { closeExampleDrawer } = load(resolve(source, 'components/TryPageExtras.tsx'));
  assert.equal(typeof closeExampleDrawer, 'function');
  let closed = false;
  const dialog = { open: true, dataset: {}, close() { closed = true; }, animate() { throw new Error('Reduced motion must not animate'); } };
  const closing = closeExampleDrawer(dialog, true);
  assert.equal(closed, true);
  await closing;
});

test('cancelled exit animation cannot leave the modal stuck open', async () => {
  const { closeExampleDrawer } = load(resolve(source, 'components/TryPageExtras.tsx'));
  assert.equal(typeof closeExampleDrawer, 'function');
  let closed = false;
  const dialog = { open: true, dataset: {}, close() { closed = true; }, animate() { return { finished: Promise.reject(new Error('Animation cancelled')), cancel() {} }; } };
  await closeExampleDrawer(dialog, false);
  assert.equal(closed, true);
});

test('example preview is a closed labelled native dialog, not an inline disclosure', () => {
  const html = renderToStaticMarkup(createElement(TryPage));
  const dialog = html.match(/<dialog[^>]*>/);
  assert.ok(dialog, 'preview must have a native modal container');
  assert.match(dialog[0], /aria-labelledby="[^"]+"/);
  assert.match(dialog[0], /aria-modal="true"/);
  assert.doesNotMatch(dialog[0], / open(?:=|\s|>)/);
  assert.match(html, /aria-haspopup="dialog"/);
  assert.match(html, />Close(?:<| )/);
});

test('hire and real reviews remain outside preview; demo limitations are visible before hire', () => {
  const root = TryPage();
  const found = [];
  function walk(node, ancestors = []) {
    if (!node || typeof node !== 'object') return;
    if (Array.isArray(node)) return node.forEach((child) => walk(child, ancestors));
    found.push({ node, ancestors });
    walk(node.props?.children, [...ancestors, node]);
  }
  walk(root);
  for (const name of ['HireFlow', 'BuyerReviews']) {
    const entry = found.find(({ node }) => node.type?.name === name);
    assert.ok(entry, `${name} remains mounted directly in the page`);
    assert.ok(entry.ancestors.every((ancestor) => !['dialog', 'details'].includes(ancestor.type)));
  }
  const limitations = found.find(({ node }) => node.type === 'p' && typeof node.props.children === 'string' && node.props.children.includes('does not read a live account'));
  assert.ok(limitations, 'reference limitations are visible prose');
  assert.ok(limitations.ancestors.every((ancestor) => ancestor.type !== 'details'));
  assert.ok(!found.some(({ node }) => node.type?.name === 'DemoReviewExamples'), 'fictional examples do not sit in the hire journey');
});
