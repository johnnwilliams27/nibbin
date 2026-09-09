import { DeliverableManifest, NegotiationHandler, verifyQuoteSignature } from '@bnbagent/sdk/erc8183';
import { calculate } from './calculation.mjs';
import { assertJobIdentity, parseJobId } from './guards.mjs';
import { fundingBlockFromReceipt } from './funding-proof.mjs';

const METADATA = { method: 'nibbin-health-factor-v1', reference_agent: true, independently_rated: false };

/** Keep v1 stable: every result is reconstructed from immutable on-chain task text. */
export function manifestForJob(job, config, addresses) {
  const quote = JSON.parse(job.description);
  const response = calculate(quote.task);
  return new DeliverableManifest({
    version: 1, jobId: parseJobId(job.id), chainId: config.chainId,
    contracts: { commerce: addresses.commerceProxy, router: addresses.routerProxy, policy: addresses.policy },
    response: { content: JSON.stringify(response), contentType: 'application/json' },
    metadata: METADATA,
  });
}

export function createSeller({ account, config, addresses, origin, publicClient, client, now = () => Math.floor(Date.now() / 1000) }) {
  const negotiator = new NegotiationHandler({
    servicePrice: '0', currency: addresses.paymentToken, estimatedCompletionSeconds: 30,
    chainId: config.chainId, verifyingContract: addresses.commerceProxy, now,
    quoteSigner: { signQuote: (hash) => account.signMessage({ message: hash }) },
  });
  const resultUrl = (jobId) => `${origin}/result/v1/${config.chainId}/${jobId}`;

  async function negotiate(input) {
    calculate(input?.task_description);
    if (config.chainId === 56) {
      if (await publicClient.getChainId() !== 56) throw new Error('Mainnet seller RPC is not on BSC mainnet. No quote was signed.');
      const pendingNonce = await publicClient.getTransactionCount({ address: account.address, blockTag: 'pending' });
      if (!Number.isSafeInteger(pendingNonce) || pendingNonce < 0 || pendingNonce >= config.maxSubmissions) throw new Error('Mainnet seller transaction limit is reached. No quote was signed.');
      const balance = await publicClient.getBalance({ address: account.address, blockTag: 'pending' });
      if (typeof balance !== 'bigint' || balance < config.maxGasWei) throw new Error('Mainnet seller needs its configured gas reserve before accepting work. No quote was signed.');
    }
    const result = await negotiator.negotiate({
      task_description: input.task_description,
      terms: {
        deliverables: 'Deterministic health factor, threshold comparison and headroom from supplied inputs.',
        quality_standards: 'Fixed-point arithmetic. No live data, financial execution or investment recommendation.',
      },
    });
    if (!result.accepted) throw new Error('Task could not be quoted.');
    return result.toDict();
  }

  async function result(jobId) {
    const id = parseJobId(jobId);
    const job = await client.getJob(BigInt(id));
    assertJobIdentity(job, account.address, config);
    if (![2, 3].includes(Number(job.status))) throw new Error('No submitted result is recorded yet.');
    const manifest = manifestForJob(job, config, addresses);
    if (!manifest.verify(job.deliverable)) throw new Error('Published result digest does not match this versioned calculation.');
    return manifest.toDict();
  }

  async function notifyFunded(jobId, fundingTransactionHash) {
    const id = parseJobId(jobId);
    if (await publicClient.getChainId() !== config.chainId) throw new Error('RPC chain mismatch.');
    const job = await client.getJob(BigInt(id));
    assertJobIdentity(job, account.address, config);
    if ([2, 3].includes(Number(job.status))) {
      await result(id);
      return { success: true, alreadySubmitted: true, status: Number(job.status) === 3 ? 'COMPLETED' : 'SUBMITTED', deliverableUrl: resultUrl(id), deliverable: job.deliverable };
    }
    if (Number(job.status) !== 1) throw new Error('The job must be FUNDED before the seller can work.');
    if (String(job.evaluator).toLowerCase() !== addresses.routerProxy.toLowerCase() || String(job.hook).toLowerCase() !== addresses.routerProxy.toLowerCase()) throw new Error('Only the canonical commerce router is supported.');
    const quote = JSON.parse(job.description);
    calculate(quote.task);
    if (quote.version !== 1 || quote.chain_id !== config.chainId || quote.price !== '0'
      || String(quote.verifying_contract).toLowerCase() !== addresses.commerceProxy.toLowerCase()
      || String(quote.currency).toLowerCase() !== addresses.paymentToken.toLowerCase()
      || !Number.isSafeInteger(quote.negotiated_at) || !Number.isSafeInteger(quote.quote_expires_at)
      || quote.negotiated_at < 0 || quote.quote_expires_at <= quote.negotiated_at || quote.quote_expires_at - quote.negotiated_at > 900) throw new Error('The job does not contain a supported bound zero-price quote.');
    const pendingNonce = await publicClient.getTransactionCount({ address: account.address, blockTag: 'pending' });
    if (!Number.isSafeInteger(pendingNonce) || pendingNonce < 0 || pendingNonce >= config.maxSubmissions) throw new Error('Reference seller lifetime transaction limit reached.');
    const fundedBlock = await fundingBlockFromReceipt(publicClient, fundingTransactionHash, job, quote, addresses.commerceProxy, client.commerce.abi);
    const verdict = await verifyQuoteSignature({ envelope: quote, provider: account.address, publicClient,
      expectedVerifyingContract: addresses.commerceProxy, blockNumber: fundedBlock });
    if (!verdict.valid) throw new Error('The on-chain provider quote is not valid.');
    const block = await publicClient.getBlock();
    const disputeWindow = await client.policy.disputeWindow();
    if (BigInt(job.expiredAt) - disputeWindow <= block.timestamp) throw new Error('The submission deadline has passed.');
    const manifest = manifestForJob(job, config, addresses);
    const deliverable = manifest.manifestHash();
    const submitted = await client.submit(BigInt(id), deliverable, { deliverable_url: resultUrl(id) });
    // No detached background work: respond only after the awaited chain operation.
    await result(id);
    return { success: true, status: 'SUBMITTED', txHash: submitted.transactionHash, deliverableUrl: resultUrl(id), deliverable };
  }

  function card() {
    return {
      protocolVersion: '0.3.0', name: 'Nibbin reference: health factor', version: '1.0.0',
      description: 'A Nibbin-owned deterministic reference demonstration. Computes health factor from supplied numbers. No live monitoring, financial execution or independent rating.',
      url: `${origin}/api/agent`, provider: { organization: 'Nibbin', url: 'https://www.nibbin.com' },
      capabilities: { streaming: false, pushNotifications: false },
      defaultInputModes: ['application/json', 'text/plain'], defaultOutputModes: ['application/json'],
      skills: [{ id: 'health_factor_v1', name: 'Calculate health factor', description: 'Fixed-point arithmetic over user-supplied collateral, debt and threshold.', tags: ['reference', 'health-factor'], examples: ['collateral=12500 debt=6200 threshold=0.825'] },
        { id: 'negotiate', name: 'Quote reference task', description: 'Zero-price signed ERC-8183 quote.', tags: ['erc8183'] },
        { id: 'notify_funded', name: 'Submit funded reference result', description: 'Verify an on-chain job, compute its result and submit the manifest digest.', tags: ['erc8183'] }],
      extensions: { nibbin: { reference_agent: true, independently_rated: false, chain_id: config.chainId,
        provider_address: account.address, commerce_contract: addresses.commerceProxy, payment_token: addresses.paymentToken,
        price: '0', mainnet_buyer_allowlist: config.chainId === 56, lifetime_submission_cap: config.maxSubmissions } },
    };
  }
  return { negotiate, notifyFunded, result, card };
}
