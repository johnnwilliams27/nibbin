import assert from 'node:assert/strict';
import { test } from 'node:test';
import { CommerceClient, RouterClient, PolicyClient } from '@bnbagent/sdk/erc8183';
import { BNB_CHAIN_ADDRESSES } from '@bnbagent/sdk/networks';
import { CONTRACTS, COMMERCE_ABI, ROUTER_ABI, POLICY_ABI } from '../src/lib/commerce-contracts.ts';

test('browser contract addresses and every ABI entry equal pinned official SDK data', () => {
  assert.deepEqual(CONTRACTS, BNB_CHAIN_ADDRESSES);
  const d = BNB_CHAIN_ADDRESSES[97];
  for (const [actual, source] of [[COMMERCE_ABI, new CommerceClient({}, d.commerceProxy).abi], [ROUTER_ABI, new RouterClient({}, d.routerProxy).abi], [POLICY_ABI, new PolicyClient({}, d.policy).abi]]) {
    for (const entry of actual) assert.deepEqual(entry, source.find((x) => x.type === entry.type && x.name === entry.name));
  }
});
