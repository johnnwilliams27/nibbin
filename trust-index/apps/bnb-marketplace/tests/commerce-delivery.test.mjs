import assert from 'node:assert/strict';
import { test } from 'node:test';
import { DeliverableManifest } from '@bnbagent/sdk/erc8183';
import { CONTRACTS } from '../src/lib/commerce-contracts.ts';
import * as api from '../src/lib/commerce-delivery.ts';
const d = CONTRACTS[97];
const manifest = new DeliverableManifest({ version: 1, jobId: 42, chainId: 97, contracts: { commerce: d.commerceProxy, router: d.routerProxy, policy: d.policy }, response: { content: '{"health_factor":"1.6633","note":"café"}', contentType: 'application/json' }, metadata: {} });

test('downloaded manifest reproduces SDK on-chain hash and binds chain, job and deployment', () => {
  assert.equal(typeof api.verifyDelivery, 'function');
  const verified = api.verifyDelivery(manifest.toDict(), { id: 42n, chainId: 97, deliverable: manifest.manifestHash() });
  assert.equal(verified.hash, manifest.manifestHash());
  assert.equal(verified.content, '{"health_factor":"1.6633","note":"café"}');
});

test('modified delivery and wrong job/chain cannot appear verified', () => {
  assert.equal(typeof api.verifyDelivery, 'function');
  for (const patch of [{job_id: 43}, {chain_id: 56}, {response: {content:'changed'}}]) assert.throws(() => api.verifyDelivery({ ...manifest.toDict(), ...patch }, {id:42n,chainId:97,deliverable:manifest.manifestHash()}));
  assert.throws(() => api.verifyDelivery(manifest.toDict(), { id:42n, chainId:97, deliverable:`0x${'00'.repeat(32)}` }));
});
