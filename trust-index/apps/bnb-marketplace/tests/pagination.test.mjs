import assert from 'node:assert/strict';
import { test } from 'node:test';
import { paginateGroups, readPage, writePage, pageNumbers, pageAfterChange } from '../src/lib/pagination.ts';
import { discoverAgents, readExplorerState, writeExplorerState } from '../src/lib/sorting.ts';

test('12-item pages cross measured/unknown boundary without omissions or duplicates', () => {
  const ranked = Array.from({ length: 14 }, (_, i) => `rated-${i}`);
  const unknown = Array.from({ length: 15 }, (_, i) => `unknown-${i}`);
  const pages = [1, 2, 3].map((n) => paginateGroups(ranked, unknown, n));
  assert.deepEqual(pages.map((p) => [p.start, p.end]), [[1, 12], [13, 24], [25, 29]]);
  assert.deepEqual(pages.flatMap((p) => [...p.ranked, ...p.unranked]), [...ranked, ...unknown]);
  assert.equal(pages[1].ranked.length, 2);
  assert.equal(pages[1].unranked.length, 10);
  assert.equal(pages[2].ranked.length, 0);
});

test('URL page accepts positive safe integers and clamps to available matches', () => {
  for (const value of ['0', '-1', 'abc', '1.5', 'Infinity', '9007199254740992']) assert.equal(readPage(`?page=${value}`), 1);
  assert.equal(readPage('?page=12'), 12);
  assert.equal(paginateGroups([1, 2], [], 999).page, 1);
  assert.deepEqual(paginateGroups([], [], 99), { page: 1, pageCount: 1, total: 0, start: 0, end: 0, ranked: [], unranked: [] });
});

test('page links retain filters, search, view and unrelated URL state', () => {
  const state = readExplorerState('?q=venus&category=yield&filter=assessed&view=table');
  const url = writePage(writeExplorerState(state, '?utm_source=demo'), 3);
  assert.deepEqual(readExplorerState(url), state);
  assert.equal(readPage(url), 3);
  assert.equal(new URLSearchParams(url).get('utm_source'), 'demo');
  assert.equal(new URLSearchParams(writePage(url, 1)).has('page'), false);
});

test('changing search, filters, category or sort resets page; switching view preserves it', () => {
  for (const patch of [{ query: 'new' }, { filters: [] }, { categories: [] }, { sort: 'name' }]) assert.equal(pageAfterChange(5, patch), 1);
  assert.equal(pageAfterChange(5, { view: 'table' }), 5);
});

test('filtering a later page cannot leave an empty slice and reference agents stay excluded', () => {
  const rows = Array.from({ length: 30 }, (_, i) => ({ agent_id: `${i}`, name: `Agent ${String(i).padStart(2, '0')}`, description: '', category: i < 2 ? 'yield' : 'rebalancing', protocols: [], assessment: null, is_reference_agent: false }));
  rows.push({ ...rows[0], agent_id: 'reference', is_reference_agent: true });
  const state = readExplorerState('?category=yield');
  const matches = discoverAgents(rows, state);
  const page = paginateGroups(matches.ranked, matches.unranked, 3);
  assert.equal(page.page, 1);
  assert.equal(page.total, 2);
  assert.deepEqual(page.unranked.map((a) => a.agent_id), ['0', '1']);
});

test('numbered navigation includes endpoints and current page with bounded gaps', () => {
  assert.deepEqual(pageNumbers(1, 3), [1, 2, 3]);
  assert.deepEqual(pageNumbers(1, 100), [1, 2, 3, 4, 'gap', 100]);
  assert.deepEqual(pageNumbers(50, 100), [1, 'gap', 49, 50, 51, 'gap', 100]);
  assert.deepEqual(pageNumbers(100, 100), [1, 'gap', 97, 98, 99, 100]);
});
