import assert from 'node:assert/strict';
import { test } from 'node:test';
import { decodeFunctionData } from 'viem';
import { COMMERCE_ABI, ROUTER_ABI } from '../src/lib/commerce-contracts.ts';
import * as api from '../src/lib/commerce.ts';
const context = { chainId: 97, provider: '0x1234567890123456789012345678901234567890', description: '{"signed":"quote"}', price: 1000000000000000000n, expiredAt: 10000n, jobId: 42n };

test('create binds verified seller and router as evaluator and hook', () => {
  assert.equal(typeof api.commerceCall, 'function');
  const call = api.commerceCall('create', context);
  assert.equal(call.to, '0xa206c0517B6371C6638CD9e4a42Cc9f02A33B0DE');
  const decoded = decodeFunctionData({ abi: COMMERCE_ABI, data: call.data });
  assert.equal(decoded.functionName, 'createJob');
  assert.deepEqual(decoded.args, [context.provider, '0xD7d36D66d2F1B608A0F943f722D27e3744f66F25', 10000n, context.description, '0xD7d36D66d2F1B608A0F943f722D27e3744f66F25']);
  assert.equal(call.value, '0x0');
});

test('register goes to router and funding binds exact expected budget', () => {
  const register = api.commerceCall('register', context);
  assert.equal(register.to, '0xD7d36D66d2F1B608A0F943f722D27e3744f66F25');
  assert.deepEqual(decodeFunctionData({ abi: ROUTER_ABI, data: register.data }).args, [42n, '0xd6a4217588F6B1F5657a92A3e94E6422aD771cEA']);
  assert.deepEqual(decodeFunctionData({ abi: COMMERCE_ABI, data: api.commerceCall('fund', context).data }).args, [42n, 1000000000000000000n, '0x']);
});

test('no wallet write can use another chain, a missing job, negative budget or over-cap price', () => {
  for (const patch of [{chainId: 1}, {price: -1n}, {price: 20000000000000000001n}]) assert.throws(() => api.commerceCall('fund', { ...context, ...patch }));
  assert.throws(() => api.commerceCall('fund', { ...context, jobId: null }));
});

test('receipt parser rejects foreign-contract and unrelated events', () => {
  assert.equal(api.createdJobId({ logs: [] }, 97), null);
  assert.equal(api.createdJobId({ logs: [{ address: context.provider, topics: [], data: '0x' }] }, 97), null);
});
