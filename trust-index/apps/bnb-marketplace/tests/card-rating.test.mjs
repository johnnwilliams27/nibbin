import assert from 'node:assert/strict';
import { test } from 'node:test';
import * as evidence from '../src/lib/evidence.ts';

const agent = (composite, extra = {}) => ({ is_reference_agent: false, scan_total_score: 99,
  assessment: { composite, coverage: 'moderate', gates_fired: [], ...extra } });

test('cards expose published scores alongside coverage, including a genuine zero', () => {
  assert.equal(typeof evidence.cardRating, 'function');
  assert.deepEqual(evidence.cardRating(agent(0.82)), { score: 82, coverage: 'moderate' });
  assert.deepEqual(evidence.cardRating(agent(82)), { score: 82, coverage: 'moderate' });
  assert.deepEqual(evidence.cardRating(agent(0)), { score: 0, coverage: 'moderate' });
});

test('cards never substitute registry scores, missing evidence, invalid ratings or our own demo', () => {
  assert.equal(typeof evidence.cardRating, 'function');
  for (const value of [null, undefined, NaN, Infinity, -1, 101, '82']) {
    assert.equal(evidence.cardRating(agent(value)), null);
  }
  assert.equal(evidence.cardRating({ assessment: null, scan_total_score: 99 }), null);
  assert.equal(evidence.cardRating({ ...agent(0.82), is_reference_agent: true }), null);
  assert.equal(evidence.cardRating(agent(0.82, { coverage: 'unknown' })), null);
});

test('recorded safety flags take priority over a card score', () => {
  assert.equal(typeof evidence.cardRating, 'function');
  assert.equal(evidence.cardRating(agent(0.82, { gates_fired: ['prompt_injection'] })), null);
});
