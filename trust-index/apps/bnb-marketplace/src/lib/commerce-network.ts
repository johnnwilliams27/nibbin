import type { Address, Hex } from 'viem';
import { erc20Abi } from 'viem';
import { chainClient, commerceCall } from './commerce.ts';
import type { CommerceAction, CommerceContext } from './commerce.ts';
import { COMMERCE_ABI, CONTRACTS, ROUTER_ABI } from './commerce-contracts.ts';
import { publicEndpoint } from './activation.ts';
import type { Eip1193Provider } from './wallet.ts';
import { parseChainId, requestTransactionHash, walletAccount } from './wallet.ts';

export async function sendCommerceTransaction(provider: Eip1193Provider, account: Address, action: CommerceAction, context: CommerceContext): Promise<Hex> {
  // Check immediately before each signature, including after the user changes wallets.
  const actualAccount = walletAccount(await provider.request({ method: 'eth_accounts' }));
  const actualChain = parseChainId(await provider.request({ method: 'eth_chainId' }));
  if (actualAccount?.toLowerCase() !== account.toLowerCase() || actualChain !== context.chainId) throw new Error('Wallet account or network changed. Reconnect the selected buyer wallet before continuing.');
  const call = commerceCall(action, context);
  // A reverted simulation must never reach a wallet prompt.
  await chainClient(context.chainId).call({ account, to: call.to, data: call.data, value: 0n });
  return requestTransactionHash(provider, { from: account, to: call.to, data: call.data, value: call.value, chainId: `0x${context.chainId.toString(16)}` });
}

export async function readCommerceJob(chainId: 56 | 97, jobId: bigint) {
  const client = chainClient(chainId);
  return client.readContract({ address: CONTRACTS[chainId].commerceProxy, abi: COMMERCE_ABI, functionName: 'getJob', args: [jobId] });
}
export type CommerceJob = Awaited<ReturnType<typeof readCommerceJob>>;

export async function nextJobAction(chainId: 56 | 97, job: CommerceJob, client = chainClient(chainId)): Promise<CommerceAction | null> {
  // Settlement clears the router binding. A terminal job needs no further
  // transaction and must not fail refresh merely because that binding is gone.
  if (job.status === 3 || job.status === 4 || job.status === 5) return null;
  const d = CONTRACTS[chainId];
  const policy = await client.readContract({ address: d.routerProxy, abi: ROUTER_ABI, functionName: 'jobPolicy', args: [job.id] });
  if (job.status === 0 && /^0x0{40}$/i.test(policy)) return 'register';
  if (policy.toLowerCase() !== d.policy.toLowerCase()) throw new Error('Job uses a different policy; do not continue here.');
  if (job.status !== 0) return null;
  const hasBudget = await client.readContract({ address: d.commerceProxy, abi: COMMERCE_ABI, functionName: 'jobHasBudget', args: [job.id] });
  if (!hasBudget) return 'budget';
  const allowance = await client.readContract({ address: d.paymentToken, abi: erc20Abi, functionName: 'allowance', args: [job.client, d.commerceProxy] });
  return allowance < job.budget ? 'approve' : 'fund';
}

export function fundingNotification(jobId: bigint, hash: string) {
  if (jobId <= 0n || jobId > BigInt(Number.MAX_SAFE_INTEGER)) throw new Error('Unsupported job ID');
  if (!/^0x[0-9a-f]{64}$/i.test(hash)) throw new Error('Enter the funding transaction hash from your wallet or block explorer. The seller verifies this receipt before working.');
  return { skill: 'notify_funded', job_id: Number(jobId), funding_tx_hash: hash };
}

/** Key contains public identifiers only; never save tasks, quotes or wallet credentials. */
export function fundingReceiptKey(chainId: 56 | 97, buyer: string, seller: string, jobId: bigint) {
  return `nibbin:funding:${chainId}:${buyer.toLowerCase()}:${seller.toLowerCase()}:${jobId}`;
}

/** Schedule only after the previous read ends; bound every mounted polling session. */
export function pollJobUntil<T>(read: () => Promise<T>, accept: (value: T) => void, shouldContinue: () => boolean, intervalMs = 15000, lifetimeMs = 900000): () => void {
  let active = true;
  const deadline = Date.now() + lifetimeMs;
  let timer: ReturnType<typeof setTimeout>;
  const tick = async () => {
    if (!active || Date.now() >= deadline || !shouldContinue()) return;
    try {
      const value = await read();
      if (active && Date.now() < deadline && shouldContinue()) accept(value);
    } catch { /* Manual refresh exposes errors. */ }
    if (active && Date.now() < deadline && shouldContinue()) timer = setTimeout(tick, intervalMs);
  };
  timer = setTimeout(tick, intervalMs);
  return () => { active = false; clearTimeout(timer); };
}

/** User-initiated seller RPC only. Size bounded, CORS required, no browser credentials. */
export async function sellerRequest(endpoint: string, data: Record<string, unknown>): Promise<unknown> {
  const url = publicEndpoint(endpoint);
  if (!url || !url.startsWith('https://')) throw new Error('Seller negotiation requires a public HTTPS endpoint.');
  const response = await fetch(url, {
    method: 'POST', credentials: 'omit', redirect: 'error', signal: AbortSignal.timeout(55000),
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: crypto.randomUUID(), method: 'message/send', params: { message: { role: 'user', messageId: crypto.randomUUID(), kind: 'message', parts: [{ kind: 'data', data }] } } }),
  });
  if (!response.ok || !response.body) throw new Error(`Seller request failed (HTTP ${response.status}). No wallet transaction was requested by this request.`);
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.length;
    if (size > 65536) { await reader.cancel(); throw new Error('Seller response was too large'); }
    chunks.push(value);
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
  const body = JSON.parse(new TextDecoder().decode(bytes));
  if (body.error) throw new Error('Seller declined the request. Check task terms and seller compatibility.');
  const parts = body.result?.parts ?? body.result?.artifacts?.flatMap((artifact: { parts?: unknown[] }) => artifact.parts ?? []);
  const result = Array.isArray(parts) ? parts.find((part: { kind?: string }) => part.kind === 'data')?.data : null;
  if (!result || typeof result !== 'object') throw new Error('Seller returned no compatible quote or job result.');
  return result;
}
