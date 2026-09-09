import assert from 'node:assert/strict';
import { test } from 'node:test';
import { safeBrowseReturn } from '../src/lib/browse-return.ts';

test('back to agents preserves local search, sort, view and page', () => {
  assert.equal(safeBrowseReturn('/?q=health&sort=evidence&page=2'), '/?q=health&sort=evidence&page=2#agent-results');
  assert.equal(safeBrowseReturn('/compare/?view=table&page=3'), '/compare/?view=table&page=3#agent-results');
  assert.equal(safeBrowseReturn('/category/yield/'), '/category/yield/#agent-results');
});

test('untrusted stored paths cannot redirect out of browsing routes', () => {
  for (const path of [null, '', '//evil.example/', '/\\evil.example', 'javascript:alert(1)', '/try/mainnet', '/agent/56/1', '/category/unknown', '/%2F%2Fevil.example']) {
    assert.equal(safeBrowseReturn(path), '/#browse');
  }
});
