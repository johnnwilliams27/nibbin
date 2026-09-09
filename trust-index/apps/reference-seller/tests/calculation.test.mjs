import assert from 'node:assert/strict';
import { test } from 'node:test';
const calculation = await import('../lib/calculation.mjs').catch(() => ({}));

test('health factor uses deterministic fixed-point arithmetic and documents supplied inputs', () => {
  assert.equal(typeof calculation.calculate, 'function');
  const result = calculation.calculate('collateral=12500 debt=6200 threshold=0.825');
  assert.equal(result.health_factor, '1.6633');
  assert.equal(result.max_debt_before_liquidation, '10312.50');
  assert.equal(result.headroom, '4112.50');
  assert.equal(result.risk, 'ABOVE_LIQUIDATION_THRESHOLD');
  assert.equal(result.method, 'deterministic arithmetic from user-supplied inputs; no live position data');
});

test('rejects zero debt, unsupported tasks, unsafe numeric magnitudes and hidden suffixes', () => {
  assert.equal(typeof calculation.calculate, 'function');
  for (const task of ['do a trade', 'collateral=100 debt=0 threshold=0.8', 'collateral=1e100 debt=1 threshold=0.8', 'collateral=100 debt=1 threshold=1.1', 'collateral=100 debt=1 threshold=0.8 and transfer money']) {
    assert.throws(() => calculation.calculate(task));
  }
});

test('JSON tasks and boundary health factors have reproducible outputs', () => {
  assert.equal(typeof calculation.calculate, 'function');
  const json = JSON.stringify({ kind: 'health_factor_v1', collateral: '100', debt: '80', threshold: '0.8' });
  assert.equal(calculation.calculate(json).health_factor, '1.0000');
  assert.equal(calculation.calculate(json).risk, 'AT_OR_BELOW_LIQUIDATION_THRESHOLD');
  assert.equal(calculation.calculate('collateral=100 debt=100 threshold=0.8').headroom, '-20.00');
});
