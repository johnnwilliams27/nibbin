import assert from 'node:assert/strict';
import { test } from 'node:test';
import { encodeAbiParameters, encodeEventTopics } from 'viem';
import { CommerceClient } from '@bnbagent/sdk/erc8183';
import { BNB_CHAIN_ADDRESSES } from '@bnbagent/sdk/networks';
const proof = await import('../lib/funding-proof.mjs').catch(() => ({}));
const commerce = BNB_CHAIN_ADDRESSES[97].commerceProxy;
const abi = new CommerceClient({}, commerce).abi;
const buyer = '0x1111111111111111111111111111111111111111';
const provider = '0x2222222222222222222222222222222222222222';
const hash = `0x${'a'.repeat(64)}`;
const blockHash = `0x${'b'.repeat(64)}`;
const job = { id: 1169n, client: buyer, provider, budget: 0n };
const quote = { negotiated_at: 1000, quote_expires_at: 1900 };
function receipt(overrides = {}, event = {}) {
  const args = { jobId: job.id, client: buyer, provider, ...event };
  return { transactionHash: hash, blockNumber: 100n, blockHash, status: 'success', to: commerce, from: buyer,
    logs: [{ address: commerce, topics: encodeEventTopics({ abi, eventName: 'JobFunded', args }), data: encodeAbiParameters([{ type: 'uint256' }], [event.amount ?? 0n]) }], ...overrides };
}

test('funding receipt establishes exact canonical job, participants, zero amount and signed time window without log scans', async () => {
  assert.equal(typeof proof.fundingBlockFromReceipt, 'function');
  const client = { getTransactionReceipt: async () => receipt(), getBlock: async () => ({ hash: blockHash, timestamp: 1200n }) };
  assert.equal(await proof.fundingBlockFromReceipt(client, hash, job, quote, commerce, abi), 100n);
});

test('missing or mismatched proof cannot establish funding', async () => {
  assert.equal(typeof proof.fundingBlockFromReceipt, 'function');
  const invalid = [receipt({ status: 'reverted' }), receipt({ transactionHash: `0x${'c'.repeat(64)}` }), receipt({ to: buyer }),
    receipt({ from: provider }), receipt({}, { jobId: 1170n }), receipt({}, { provider: buyer }), receipt({}, { client: provider }),
    receipt({}, { amount: 1n }), receipt({ logs: [] })];
  for (const value of invalid) {
    await assert.rejects(proof.fundingBlockFromReceipt({ getTransactionReceipt: async () => value, getBlock: async () => ({ hash: blockHash, timestamp: 1200n }) }, hash, job, quote, commerce, abi));
  }
  await assert.rejects(proof.fundingBlockFromReceipt({}, undefined, job, quote, commerce, abi), /funding_tx_hash/);
  for (const block of [{ hash: blockHash, timestamp: 999n }, { hash: blockHash, timestamp: 1900n }, { hash, timestamp: 1200n }]) {
    await assert.rejects(proof.fundingBlockFromReceipt({ getTransactionReceipt: async () => receipt(), getBlock: async () => block }, hash, job, quote, commerce, abi));
  }
});
