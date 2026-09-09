import assert from 'node:assert/strict';
import { test } from 'node:test';
import { privateKeyToAccount } from 'viem/accounts';
import { NegotiationHandler, buildJobDescription } from '@bnbagent/sdk/erc8183';
import { CONTRACTS } from '../src/lib/commerce-contracts.ts';
import * as api from '../src/lib/commerce-quote.ts';
const signer = privateKeyToAccount(`0x${'11'.repeat(32)}`); // Public deterministic test-only key; never funded.
async function quote() {
  const handler = new NegotiationHandler({ quoteSigner: { signQuote: (hash) => signer.signMessage({ message: hash }) }, servicePrice: '0', currency: CONTRACTS[97].paymentToken, chainId: 97, verifyingContract: CONTRACTS[97].commerceProxy });
  return (await handler.negotiate({ task_description: 'collateral=12500 debt=6200 threshold=0.825 café [check]', terms: { deliverables: 'Health factor', quality_standards: 'Show formula' } })).toDict();
}

test('browser verifies real SDK raw and built signed quotes without changing signed bytes', async () => {
  assert.equal(typeof api.normalizeQuote, 'function');
  const raw = await quote();
  const expected = buildJobDescription(raw);
  const verified = await api.normalizeQuote(raw, signer.address, 97, Math.floor(Date.now() / 1000));
  assert.equal(verified.description, expected);
  assert.equal(verified.price, 0n);
  assert.equal((await api.normalizeQuote(JSON.parse(expected), signer.address, 97, Math.floor(Date.now() / 1000))).description, expected);
});

test('tampering, wrong seller, wrong chain, expired and unsigned quotes never become spendable', async () => {
  assert.equal(typeof api.normalizeQuote, 'function');
  const raw = await quote();
  const built = JSON.parse(buildJobDescription(raw));
  const now = Math.floor(Date.now() / 1000);
  for (const altered of [{ ...built, price: '1' }, { ...built, provider_sig: '0x' }, { ...built, chain_id: 56 }, { ...built, verifying_contract: CONTRACTS[56].commerceProxy }]) await assert.rejects(() => api.normalizeQuote(altered, signer.address, 97, now));
  await assert.rejects(() => api.normalizeQuote(built, '0x1234567890123456789012345678901234567890', 97, now));
  await assert.rejects(() => api.normalizeQuote(built, signer.address, 97, built.quote_expires_at + 1));
});
