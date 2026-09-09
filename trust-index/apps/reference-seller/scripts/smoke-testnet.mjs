/** Explicit operator-run smoke test. Importing this module never sends a request. */
import { pathToFileURL } from 'node:url';
import { randomUUID } from 'node:crypto';
import { createPublicClient, encodeFunctionData, getAddress, http } from 'viem';
import { bscTestnet } from 'viem/chains';
import { generatePrivateKey } from 'viem/accounts';
import { EVMWalletProvider } from '@bnbagent/sdk/wallets';
import { BNB_CHAIN_ADDRESSES } from '@bnbagent/sdk/networks';
import { CommerceClient, RouterClient, PolicyClient, ERC8183Client, DeliverableManifest, buildJobDescription, verifyQuoteSignature } from '@bnbagent/sdk/erc8183';

const UA = 'Nibbin Trust Index (https://nibbin.com)';

export function assertSponsoredBuyerTx(transaction, expected) {
  if (!expected || Number(transaction.chainId) !== 97 || Number(transaction.nonce) !== expected.nonce
    || String(transaction.to).toLowerCase() !== expected.to.toLowerCase()
    || transaction.data !== expected.data || BigInt(transaction.value ?? 0) !== 0n
    || transaction.gasPrice === undefined || BigInt(transaction.gasPrice) !== 0n
    || BigInt(transaction.maxFeePerGas ?? 0) !== 0n || BigInt(transaction.maxPriorityFeePerGas ?? 0) !== 0n
    || transaction.gas === undefined || BigInt(transaction.gas) <= 0n || BigInt(transaction.gas) > 1000000n) {
    throw new Error('Smoke test refused a non-sponsored, unexpected, or non-testnet transaction.');
  }
}

async function readJson(url, body) {
  const response = await fetch(url, { method: body ? 'POST' : 'GET', redirect: 'error',
    headers: { 'User-Agent': UA, ...(body ? { 'Content-Type': 'application/json' } : {}) },
    ...(body ? { body: JSON.stringify(body) } : {}), signal: AbortSignal.timeout(body ? 55000 : 12000) });
  if (!response.ok) throw new Error(`Seller returned HTTP ${response.status}; no successful operation is claimed.`);
  if (!response.body) throw new Error('Seller returned no body.');
  const reader = response.body.getReader();
  const chunks = [];
  let size = 0;
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    size += value.length;
    if (size > 262144) { await reader.cancel(); throw new Error('Seller response exceeds the smoke-test size limit.'); }
    chunks.push(value);
  }
  return JSON.parse(Buffer.concat(chunks).toString('utf8'));
}

function envelope(data) {
  return { jsonrpc: '2.0', id: randomUUID(), method: 'message/send', params: { message: {
    kind: 'message', role: 'user', messageId: randomUUID(), parts: [{ kind: 'data', data }],
  } } };
}

/** Zero-priced, four sponsored buyer writes; no wallet persistence, top-up, approvals or mainnet. */
export async function runSmoke(rawOrigin) {
  const origin = new URL(rawOrigin);
  if (origin.protocol !== 'https:' || origin.username || origin.password || origin.pathname !== '/'
    || origin.search || origin.hash || !origin.hostname.endsWith('.vercel.app')) throw new Error('Pass the reviewed HTTPS Vercel seller origin, without a path.');
  const deadline = Date.now() + 240000;
  const addresses = BNB_CHAIN_ADDRESSES[97];
  const card = await readJson(`${origin.origin}/.well-known/agent-card.json`);
  const reference = card.extensions?.nibbin;
  if (reference?.chain_id !== 97 || reference.reference_agent !== true || reference.price !== '0'
    || getAddress(reference.commerce_contract) !== getAddress(addresses.commerceProxy)
    || getAddress(reference.payment_token) !== getAddress(addresses.paymentToken)) throw new Error('Card is not the reviewed zero-price BSC-testnet reference.');
  const provider = getAddress(reference.provider_address);
  // Fresh key remains only inside this process. Never serialize or log this value.
  const wallet = new EVMWalletProvider({ privateKey: generatePrivateKey(), password: randomUUID(), persist: false });
  const buyer = wallet.address;
  const rpcUrl = 'https://bsc-testnet-dataseed.bnbchain.org';
  const publicClient = createPublicClient({ chain: bscTestnet, transport: http(rpcUrl, { timeout: 8000, retryCount: 0,
    fetchOptions: { redirect: 'error', headers: { 'User-Agent': UA } } }) });
  if (await publicClient.getChainId() !== 97) throw new Error('RPC is not BSC testnet.');
  if (await publicClient.getBalance({ address: buyer }) !== 0n || await publicClient.getTransactionCount({ address: buyer, blockTag: 'pending' }) !== 0) throw new Error('Fresh smoke wallet is unexpectedly funded or used.');
  let expected = null;
  const sign = wallet.signTransaction.bind(wallet);
  wallet.signTransaction = async (transaction) => {
    if (Date.now() >= deadline) throw new Error('Smoke-test signing deadline reached.');
    assertSponsoredBuyerTx(transaction, expected);
    return sign(transaction);
  };
  const network = { name: 'bsc-testnet', chainId: 97, rpcUrl, usePaymaster: true,
    paymasterUrl: 'https://bsc-megafuel-testnet.nodereal.io', commerceContract: addresses.commerceProxy,
    routerContract: addresses.routerProxy, policyContract: addresses.policy };
  const paymaster = ERC8183Client.buildPaymaster(network, false);
  if (!paymaster) throw new Error('Required testnet paymaster is unavailable.');
  const options = { paymaster, receiptTimeout: 20 };
  const commerce = new CommerceClient(publicClient, addresses.commerceProxy, wallet, options);
  const router = new RouterClient(publicClient, addresses.routerProxy, wallet, options);
  const policy = new PolicyClient(publicClient, addresses.policy, wallet, options);
  const client = new ERC8183Client({ client: publicClient, network, walletProvider: wallet, debug: false, commerce, router, policy });
  console.log(JSON.stringify({ stage: 'begin', chain_id: 97, buyer, provider, budget: '0', funding: 'none', key_storage: 'memory only' }));
  const quoteReply = await readJson(`${origin.origin}/api/agent`, envelope({ skill: 'negotiate', task_description: 'collateral=12500 debt=6200 threshold=0.825' }));
  const quote = quoteReply.result?.parts?.find((part) => part.kind === 'data')?.data;
  if (!quote || quote.chain_id !== 97 || quote.response?.terms?.price !== '0' || getAddress(quote.response.terms.currency) !== getAddress(addresses.paymentToken)) throw new Error('Seller quote is not zero-priced and testnet-bound.');
  const verification = await verifyQuoteSignature({ envelope: quote, provider, publicClient, expectedVerifyingContract: addresses.commerceProxy });
  if (!verification.valid) throw new Error('Provider quote signature validation failed.');
  const description = buildJobDescription(quote);
  const block = await publicClient.getBlock();
  const disputeWindow = await policy.disputeWindow();
  const expiredAt = block.timestamp + disputeWindow + 1200n;
  let nonce = 0;
  async function write(label, target, abi, functionName, args, operation) {
    if (Date.now() >= deadline) throw new Error('Smoke-test execution deadline reached.');
    expected = { to: target, data: encodeFunctionData({ abi, functionName, args }), nonce };
    const tx = await operation();
    expected = null;
    if (!tx.receipt || tx.receipt.status !== 'success' || tx.receipt.effectiveGasPrice !== 0n) throw new Error('Transaction lacks a successful zero-gas-price receipt.');
    nonce++;
    console.log(JSON.stringify({ stage: label, transaction_hash: tx.transactionHash, gas_paid_wei: '0', ...(tx.jobId != null ? { job_id: tx.jobId.toString() } : {}) }));
    return tx;
  }
  const created = await write('create', addresses.commerceProxy, commerce.abi, 'createJob',
    [provider, addresses.routerProxy, expiredAt, description, addresses.routerProxy], () => client.createJob({ provider, expiredAt, description }));
  if (created.jobId === null || created.jobId === undefined) throw new Error('Job created but its identifier was not decoded. Stop; do not create another job.');
  const jobId = BigInt(created.jobId);
  if (jobId > BigInt(Number.MAX_SAFE_INTEGER)) throw new Error('Job ID exceeds seller supported range.');
  await write('register', addresses.routerProxy, router.abi, 'registerJob', [jobId, addresses.policy], () => client.registerJob(jobId));
  await write('set-budget', addresses.commerceProxy, commerce.abi, 'setBudget', [jobId, 0n, '0x'], () => client.setBudget(jobId, 0n));
  const funding = await write('fund', addresses.commerceProxy, commerce.abi, 'fund', [jobId, 0n, '0x'], () => client.fund(jobId, 0n, { approveFloor: 0n }));
  const funded = await client.getJob(jobId);
  if (Number(funded.status) !== 1 || funded.budget !== 0n || getAddress(funded.client) !== buyer || getAddress(funded.provider) !== provider) throw new Error('Funded job did not match the buyer, provider and zero budget.');
  const notify = await readJson(`${origin.origin}/api/agent`, envelope({ skill: 'notify_funded', job_id: Number(jobId), funding_tx_hash: funding.transactionHash }));
  const delivery = notify.result?.parts?.find((part) => part.kind === 'data')?.data;
  if (delivery?.success !== true) throw new Error(`Seller did not confirm submission for job ${jobId}. Read on-chain status before retrying.`);
  const submitted = await client.getJob(jobId);
  if (![2, 3].includes(Number(submitted.status))) throw new Error('Seller claimed success but the job is not submitted.');
  // Fetch only the expected stable same-origin path, never an untrusted returned URL.
  const resultUrl = `${origin.origin}/result/v1/97/${jobId}`;
  if (delivery.deliverableUrl !== resultUrl) throw new Error('Unexpected deliverable URL.');
  const manifestJson = await readJson(resultUrl);
  const manifest = DeliverableManifest.fromDict(manifestJson);
  if (!manifest.verify(submitted.deliverable)) throw new Error('Public deliverable does not match the saved on-chain digest.');
  const output = JSON.parse(manifestJson.response.content);
  if (output.health_factor !== '1.6633') throw new Error('Deterministic reference result differs from expected arithmetic.');
  console.log(JSON.stringify({ stage: 'verified', chain_id: 97, buyer, provider, job_id: jobId.toString(),
    status: Number(submitted.status) === 3 ? 'COMPLETED' : 'SUBMITTED', deliverable_hash: submitted.deliverable,
    deliverable_url: resultUrl, health_factor: output.health_factor, buyer_gas_paid_wei: '0', budget: '0',
    settlement: 'Not attempted. This smoke test verifies delivery, not completion after the dispute window.' }));
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  runSmoke(process.argv[2]).catch((error) => {
    // Error objects can contain transaction payloads. Only bounded plain messages are printed.
    console.error(`Smoke test stopped: ${String(error?.shortMessage ?? error?.message ?? 'unknown error').slice(0, 350)}`);
    process.exitCode = 1;
  });
}
