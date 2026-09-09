import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import test from 'node:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import ts from 'typescript';
import * as avatar from '../src/lib/avatar.ts';

// Execute the real TSX component with the existing compiler; no DOM dependency.
const require = createRequire(import.meta.url);
const compiled = ts.transpileModule(readFileSync(new URL('../src/components/AgentAvatar.tsx', import.meta.url), 'utf8'), {
  compilerOptions: { jsx: ts.JsxEmit.ReactJSX, module: ts.ModuleKind.CommonJS },
}).outputText;
const componentModule = { exports: {} };
new Function('require', 'module', 'exports', compiled)(
  (specifier) => specifier === '@/lib/avatar' ? avatar : require(specifier), componentModule, componentModule.exports,
);
const { AgentAvatar } = componentModule.exports;

test('rendered avatar has fixed dimensions, privacy controls and no duplicate accessible name', () => {
  const html = renderToStaticMarkup(createElement(AgentAvatar, { imageUrl: 'https://images.example.com/a.png', name: 'Yield Agent' }));
  assert.match(html, /<img /);
  assert.match(html, /width="56" height="56"/);
  assert.match(html, /loading="lazy"/);
  assert.match(html, /referrerPolicy="no-referrer"/);
  assert.match(html, /alt=""/);
  assert.match(html, /aria-hidden="true"/);
});

test('rendered fallback makes no image request for missing or unsafe URLs', () => {
  for (const imageUrl of [null, 'javascript:alert(1)', 'https://127.0.0.1/a.png']) {
    const html = renderToStaticMarkup(createElement(AgentAvatar, { imageUrl, name: 'Yield Agent' }));
    assert.doesNotMatch(html, /<img /);
    assert.match(html, />YA<\/span>/);
  }
});
