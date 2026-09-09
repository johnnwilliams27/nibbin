import assert from 'node:assert/strict';
import { test } from 'node:test';
import * as api from '../src/lib/reference-result.ts';
const result = { health_factor: '1.6633', headroom: '4112.50', max_debt_before_liquidation: '10312.50', inputs: { collateral: '12500', debt: '6200', threshold: '0.825' }, formula: '(collateral * threshold) / debt' };

test('reference result preserves signed decimal strings and supplied input units', () => {
  assert.equal(typeof api.parseReferenceResult, 'function');
  assert.deepEqual(api.parseReferenceResult(JSON.stringify(result)), result);
  assert.equal(api.parseReferenceResult(JSON.stringify({ ...result, headroom: '-12.00' })).headroom, '-12.00');
});

test('malformed or unrelated content never becomes a formatted reference result', () => {
  assert.equal(typeof api.parseReferenceResult, 'function');
  for (const content of ['not JSON', 'null', '[]', '{}', JSON.stringify({ ...result, health_factor: 'Infinity' }), JSON.stringify({ ...result, headroom: '<img>' }), JSON.stringify({ ...result, inputs: { ...result.inputs, debt: '0' } }), JSON.stringify({ ...result, formula: 'trust me' })]) assert.equal(api.parseReferenceResult(content), null);
});

test('settlement countdown uses submission plus policy duration, failing closed on unknown timing', () => {
  assert.equal(typeof api.settlementWait, 'function');
  assert.equal(api.settlementWait(1000n, 900n, 1899n), 1n);
  assert.equal(api.settlementWait(1000n, 900n, 1900n), 0n);
  assert.equal(api.settlementWait(1000n, 900n, 2000n), 0n);
  assert.equal(api.settlementWait(0n, 900n, 2000n), null);
  assert.equal(api.settlementWait(1000n, null, 2000n), null);
});
