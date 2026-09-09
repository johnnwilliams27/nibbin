import assert from 'node:assert/strict';
import { test } from 'node:test';
const guards = await import('../lib/guards.mjs').catch(() => ({}));
const provider = '0x1111111111111111111111111111111111111111';
const buyer = '0x2222222222222222222222222222222222222222';
const contract = '0x3333333333333333333333333333333333333333';

test('only BSC chains are configured and mainnet requires a fixed buyer allowlist', () => {
  assert.equal(typeof guards.sellerConfig, 'function');
  assert.equal(guards.sellerConfig({}).chainId, 97);
  assert.throws(() => guards.sellerConfig({ REFERENCE_CHAIN_ID: '1' }));
  assert.throws(() => guards.sellerConfig({ REFERENCE_CHAIN_ID: '56' }));
  const config = guards.sellerConfig({ REFERENCE_CHAIN_ID: '56', REFERENCE_ALLOWED_BUYERS: buyer });
  assert.equal(config.maxSubmissions, 3);
  assert.throws(() => guards.sellerConfig({ REFERENCE_CHAIN_ID: '56', REFERENCE_ALLOWED_BUYERS: buyer, REFERENCE_MAX_SUBMISSIONS: '99' }));
});

test('job selection binds actual on-chain provider and buyer and rejects paid budgets', () => {
  assert.equal(typeof guards.assertJobIdentity, 'function');
  const job = { id: 4n, provider, client: buyer, budget: 0n };
  const config = { chainId: 56, allowedBuyers: [buyer.toLowerCase()] };
  assert.doesNotThrow(() => guards.assertJobIdentity(job, provider, config));
  assert.throws(() => guards.assertJobIdentity({ ...job, provider: buyer }, provider, config));
  assert.throws(() => guards.assertJobIdentity({ ...job, client: provider }, provider, config));
  assert.throws(() => guards.assertJobIdentity({ ...job, budget: 1n }, provider, config));
});

test('signing guard permits only zero-value submit to the canonical commerce contract under a gas cap', () => {
  assert.equal(typeof guards.assertSubmissionTransaction, 'function');
  const config = { chainId: 56, maxGasWei: 1000n, maxSubmissions: 3 };
  const tx = { chainId: 56, to: contract, value: 0n, data: '0x01020304abcd', gas: 100n, gasPrice: 2n, nonce: 0 };
  assert.doesNotThrow(() => guards.assertSubmissionTransaction(tx, config, contract, '0x01020304', 0));
  for (const patch of [{ to: buyer }, { data: '0xaabbccdd' }, { value: 1n }, { chainId: 97 }, { gasPrice: 100n }, { gas: undefined }, { nonce: 3 }]) {
    assert.throws(() => guards.assertSubmissionTransaction({ ...tx, ...patch }, config, contract, '0x01020304', 0));
  }
  assert.throws(() => guards.assertSubmissionTransaction(tx, config, contract, '0x01020304', 3));
  assert.throws(() => guards.assertSubmissionTransaction(tx, config, contract, '0x01020304', -1));
  assert.throws(() => guards.assertSubmissionTransaction(tx, config, contract, '0x01020304', 1));
  assert.throws(() => guards.assertSubmissionTransaction({ ...tx, chainId: 97 }, { ...config, chainId: 97 }, contract, '0x01020304', 0));
});

test('CORS never reflects unknown or null origins, and job IDs stay bounded integers', () => {
  assert.equal(typeof guards.isAllowedOrigin, 'function');
  assert.equal(guards.isAllowedOrigin('https://www.nibbin.com'), true);
  assert.equal(guards.isAllowedOrigin('https://www.nibbin.com.evil.example'), false);
  assert.equal(guards.isAllowedOrigin('null'), false);
  assert.equal(guards.parseJobId('1163'), 1163);
  for (const value of [-1, 0, '1.2', '1e3', Number.MAX_SAFE_INTEGER + 1, '12x']) assert.throws(() => guards.parseJobId(value));
});
