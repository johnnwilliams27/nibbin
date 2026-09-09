import { keccak256, toBytes } from 'viem';
import type { Hex } from 'viem';
import { CONTRACTS } from './commerce-contracts.ts';
import { canonicalQuote } from './commerce-quote.ts';
import { publicEndpoint } from './activation.ts';

function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Invalid deliverable manifest');
  return value as Record<string, unknown>;
}
/** Matches DeliverableManifest.fromDict().manifestHash() in pinned SDK0.5.5. */
export function verifyDelivery(input: unknown, job: { id: bigint; chainId: 56 | 97; deliverable: Hex }) {
  const data = record(input);
  const response = record(data.response);
  const contracts = record(data.contracts);
  if (data.version !== 1 || data.chain_id !== job.chainId || typeof data.job_id !== 'number' || !Number.isSafeInteger(data.job_id) || BigInt(data.job_id) !== job.id) throw new Error('Deliverable does not identify this job and chain');
  const d = CONTRACTS[job.chainId];
  for (const [key, expected] of Object.entries({ commerce: d.commerceProxy, router: d.routerProxy, policy: d.policy })) {
    if (typeof contracts[key] !== 'string' || contracts[key].toLowerCase() !== expected.toLowerCase()) throw new Error('Deliverable names an unexpected contract');
  }
  if (typeof response.content !== 'string') throw new Error('Deliverable has no text content');
  const normalized = { version: data.version, job_id: data.job_id, chain_id: data.chain_id, contracts: data.contracts, response: { content: response.content, ...('content_type' in response ? { content_type: response.content_type } : {}) }, metadata: data.metadata ?? {} };
  const hash = keccak256(toBytes(canonicalQuote(normalized)));
  if (/^0x0{64}$/i.test(job.deliverable) || hash.toLowerCase() !== job.deliverable.toLowerCase()) throw new Error('Downloaded deliverable does not match the on-chain digest. Do not settle based on this file.');
  return { hash, content: response.content, jobId: job.id.toString() };
}

export async function fetchDelivery(url: string, job: { id: bigint; chainId: 56 | 97; deliverable: Hex }) {
  const safeUrl = publicEndpoint(url);
  if (!safeUrl?.startsWith('https://')) throw new Error('Deliverable verification requires a public HTTPS URL');
  const response = await fetch(safeUrl, { credentials: 'omit', redirect: 'error', signal: AbortSignal.timeout(20000) });
  if (!response.ok || !response.body) throw new Error(`Deliverable download failed (HTTP ${response.status})`);
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.length;
    if (size > 262144) { await reader.cancel(); throw new Error('Deliverable exceeds the 256 KB verification limit'); }
    chunks.push(value);
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
  return { ...verifyDelivery(JSON.parse(new TextDecoder().decode(bytes)), job), url: safeUrl };
}
