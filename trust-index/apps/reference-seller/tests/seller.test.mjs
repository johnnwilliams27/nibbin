import assert from 'node:assert/strict';
import { test } from 'node:test';
import { privateKeyToAccount } from 'viem/accounts';
import { encodeAbiParameters, encodeEventTopics } from 'viem';
import { CommerceClient, buildJobDescription, verifyQuoteSignature } from '@bnbagent/sdk/erc8183';
import { BNB_CHAIN_ADDRESSES } from '@bnbagent/sdk/networks';
const sellerModule = await import('../lib/seller.mjs').catch(() => ({}));
// Public, deliberately known test-only key. Never deployed or funded.
const account = privateKeyToAccount(`0x${'0'.repeat(63)}1`);
const addresses = BNB_CHAIN_ADDRESSES[97];
const config = { chainId: 97, allowedBuyers: [], maxSubmissions: 100, maxGasWei: 1000n };
const task = 'collateral=12500 debt=6200 threshold=0.825';
const time = 1788937200;
const publicClient = { getChainId: async () => 97, getBlock: async () => ({ timestamp: BigInt(time) }), getTransactionCount: async () => 0 };

test('seller signs zero-price SDK quotes bound to the configured provider, chain and commerce contract', async () => {
  assert.equal(typeof sellerModule.createSeller, 'function');
  const seller = sellerModule.createSeller({ account, config, addresses, origin: 'https://seller.example', publicClient, now: () => time });
  const quote = await seller.negotiate({ task_description: task });
  assert.equal(quote.response.terms.price, '0');
  assert.equal(quote.chain_id, 97);
  assert.equal(quote.response.quote_expires_at, time + 900);
  assert.equal((await verifyQuoteSignature({ envelope: quote, provider: account.address, publicClient, expectedVerifyingContract: addresses.commerceProxy })).valid, true);
  await assert.rejects(seller.negotiate({ task_description: 'transfer all funds' }));
});

test('mainnet refuses usable quotes when unfunded, exhausted or on the wrong RPC chain', async () => {
  const mainnet = { chainId: 56, allowedBuyers: [account.address.toLowerCase()], maxSubmissions: 3, maxGasWei: 100000000000000n };
  const healthy = { getChainId: async () => 56, getTransactionCount: async () => 0, getBalance: async () => mainnet.maxGasWei };
  for (const client of [{ ...healthy, getBalance: async () => 0n }, { ...healthy, getBalance: async () => mainnet.maxGasWei - 1n },
    { ...healthy, getTransactionCount: async () => 3 }, { ...healthy, getTransactionCount: async () => -1 },
    { ...healthy, getChainId: async () => 97 }]) {
    let signed = false;
    const guardedAccount = { address: account.address, signMessage: async (message) => { signed = true; return account.signMessage(message); } };
    const seller = sellerModule.createSeller({ account: guardedAccount, config: mainnet, addresses: BNB_CHAIN_ADDRESSES[56], origin: 'https://mainnet.example', publicClient: client, now: () => time });
    await assert.rejects(seller.negotiate({ task_description: task }), /Mainnet seller/);
    assert.equal(signed, false);
  }
  const ready = sellerModule.createSeller({ account, config: mainnet, addresses: BNB_CHAIN_ADDRESSES[56], origin: 'https://mainnet.example', publicClient: healthy, now: () => time });
  assert.equal((await ready.negotiate({ task_description: task })).chain_id, 56);
});

test('manifest is reproducible from the on-chain description and does not depend on process storage', async () => {
  assert.equal(typeof sellerModule.createSeller, 'function');
  const seller = sellerModule.createSeller({ account, config, addresses, origin: 'https://seller.example', publicClient, now: () => time });
  const quote = await seller.negotiate({ task_description: task });
  const job = { id: 7n, provider: account.address, client: account.address, budget: 0n, description: buildJobDescription(quote) };
  const first = sellerModule.manifestForJob(job, config, addresses);
  const restarted = sellerModule.manifestForJob(JSON.parse(JSON.stringify(job, (_, v) => typeof v === 'bigint' ? v.toString() : v)), config, addresses);
  assert.equal(first.manifestHash(), restarted.manifestHash());
  assert.equal(JSON.parse(first.toDict().response.content).health_factor, '1.6633');
});

test('notify rejects a foreign provider before a signature or submission and retrieves only digest-matching results', async () => {
  assert.equal(typeof sellerModule.createSeller, 'function');
  let submissions = 0;
  let job = { id: 7n, provider: '0x2222222222222222222222222222222222222222', client: account.address, budget: 0n, status: 1, description: '{}' };
  const client = { getJob: async () => job, submit: async () => { submissions++; } };
  const seller = sellerModule.createSeller({ account, config, addresses, origin: 'https://seller.example', publicClient, client, now: () => time });
  await assert.rejects(seller.notifyFunded(7), /another provider/);
  assert.equal(submissions, 0);
  const quote = await seller.negotiate({ task_description: task });
  job = { ...job, provider: account.address, description: buildJobDescription(quote), status: 2, deliverable: `0x${'0'.repeat(64)}` };
  await assert.rejects(seller.result(7), /digest/);
  job.deliverable = sellerModule.manifestForJob(job, config, addresses).manifestHash();
  assert.equal((await seller.result(7)).job_id, 7);
  assert.equal((await seller.notifyFunded(7)).alreadySubmitted, true);
  assert.equal(submissions, 0);
});

test('funded job submits exactly its deterministic manifest and tampered quote cannot cause a write', async () => {
  let submittedPayload;
  let job;
  const fundingHash = `0x${'c'.repeat(64)}`;
  const fundingBlockHash = `0x${'d'.repeat(64)}`;
  const commerce = new CommerceClient({}, addresses.commerceProxy);
  const proofClient = { ...publicClient, getBlock: async () => ({ timestamp: BigInt(time), hash: fundingBlockHash }),
    getTransactionReceipt: async () => ({ transactionHash: fundingHash, blockNumber: 100n, blockHash: fundingBlockHash,
      status: 'success', to: addresses.commerceProxy, from: account.address, logs: [{ address: addresses.commerceProxy,
        topics: encodeEventTopics({ abi: commerce.abi, eventName: 'JobFunded', args: { jobId: 8n, client: account.address, provider: account.address } }),
        data: encodeAbiParameters([{ type: 'uint256' }], [0n]),
      }] }),
  };
  const client = {
    commerce,
    getJob: async () => job,
    getJobFundedBlock: async () => { throw new Error('Historical log scanning must not run.'); },
    policy: { disputeWindow: async () => 900n },
    submit: async (id, digest, options) => {
      submittedPayload = { id, digest, options };
      job = { ...job, status: 2, deliverable: digest };
      return { transactionHash: `0x${'a'.repeat(64)}` };
    },
  };
  const seller = sellerModule.createSeller({ account, config, addresses, origin: 'https://seller.example', publicClient: proofClient, client, now: () => time });
  const quote = await seller.negotiate({ task_description: task });
  job = { id: 8n, provider: account.address, client: account.address, evaluator: addresses.routerProxy, hook: addresses.routerProxy,
    budget: 0n, description: buildJobDescription(quote), status: 1, expiredAt: BigInt(time + 1800) };
  const original = job.description;
  const altered = JSON.parse(original);
  altered.task = 'collateral=100 debt=80 threshold=0.8';
  job.description = JSON.stringify(altered);
  await assert.rejects(seller.notifyFunded(8, fundingHash), /quote is not valid/);
  assert.equal(submittedPayload, undefined);
  job.description = original;
  await assert.rejects(seller.notifyFunded(8), /funding_tx_hash/);
  const result = await seller.notifyFunded(8, fundingHash);
  assert.equal(result.success, true);
  assert.equal(submittedPayload.id, 8n);
  assert.equal(submittedPayload.options.deliverable_url, 'https://seller.example/result/v1/97/8');
  assert.equal(submittedPayload.digest, sellerModule.manifestForJob(job, config, addresses).manifestHash());
});
