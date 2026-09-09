import assert from 'node:assert/strict';
import { test } from 'node:test';
import { sendCommerceTransaction, sellerRequest } from '../src/lib/commerce-network.ts';
import * as api from '../src/lib/commerce-network.ts';
const buyer = '0x1234567890123456789012345678901234567890';
const context = { chainId: 97, provider: buyer, description: '{}', price: 0n, expiredAt: 9999n, jobId: 42n };

test('changed wallet account or chain is rejected before simulation or any send', async () => {
  for (const [accounts, chain] of [[[buyer], '0x38'], [[], '0x61'], [['0x2234567890123456789012345678901234567890'], '0x61']]) {
    const calls = [];
    const provider = { request: async (r) => { calls.push(r.method); if (r.method === 'eth_accounts') return accounts; if (r.method === 'eth_chainId') return chain; throw new Error('A write should not be reached'); } };
    await assert.rejects(() => sendCommerceTransaction(provider, buyer, 'fund', context), /account or network changed/);
    assert.deepEqual(calls, ['eth_accounts', 'eth_chainId']);
  }
});

test('funded and submitted jobs cannot bypass supported-policy validation', async () => {
  for (const status of [1, 2]) {
    await assert.rejects(() => api.nextJobAction(97, { id: 42n, status }, { readContract: async () => buyer }), /different policy/);
  }
});

test('terminal jobs need no next action after the router clears their policy binding', async () => {
  for (const status of [3, 4, 5]) {
    const noPolicyRead = { readContract: async () => { throw new Error('Terminal jobs must not require a policy binding'); } };
    assert.equal(await api.nextJobAction(97, { id: 42n, status }, noPolicyRead), null);
  }
});

test('seller funding notification requires an exact receipt hash and safe integer job ID', () => {
  assert.equal(typeof api.fundingNotification, 'function');
  const hash = `0x${'ab'.repeat(32)}`;
  assert.deepEqual(api.fundingNotification(1169n, hash), { skill: 'notify_funded', job_id: 1169, funding_tx_hash: hash });
  for (const hash of ['', '0x12', `0x${'z'.repeat(64)}`]) assert.throws(() => api.fundingNotification(1169n, hash), /funding transaction hash/i);
  assert.throws(() => api.fundingNotification(9007199254740992n, hash), /job ID/i);
});

test('receipt storage scopes public funding metadata to chain, buyer, seller and job', () => {
  assert.equal(typeof api.fundingReceiptKey, 'function');
  const key = api.fundingReceiptKey(97, buyer, buyer, 1169n);
  assert.equal(key, `nibbin:funding:97:${buyer}:${buyer}:1169`);
  assert.notEqual(key, api.fundingReceiptKey(56, buyer, buyer, 1169n));
  assert.notEqual(key, api.fundingReceiptKey(97, buyer, buyer, 1170n));
  assert.notEqual(key, api.fundingReceiptKey(97, `0x${'22'.repeat(20)}`, buyer, 1169n));
});

test('job polling never overlaps and stops after the time bound', async () => {
  assert.equal(typeof api.pollJobUntil, 'function');
  let calls = 0;
  let finish;
  const values = [];
  const stop = api.pollJobUntil(() => { calls++; return new Promise((resolve) => { finish = resolve; }); }, (value) => values.push(value), () => true, 1, 15);
  await new Promise((resolve) => setTimeout(resolve, 25));
  assert.equal(calls, 1);
  finish('late');
  await new Promise((resolve) => setTimeout(resolve, 10));
  assert.deepEqual(values, []);
  assert.equal(calls, 1);
  stop();
});

test('seller negotiation rejects private and non-HTTPS URLs before any request', async () => {
  for (const url of ['http://localhost:9000', 'https://127.0.0.1', 'javascript:alert(1)', 'http://example.com']) {
    await assert.rejects(() => sellerRequest(url, { skill: 'negotiate' }), /public HTTPS/);
  }
});
