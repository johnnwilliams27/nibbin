import { getAddress, isAddress, keccak256, recoverMessageAddress, toBytes } from 'viem';
import type { Address, Hex } from 'viem';
import { CONTRACTS } from './commerce-contracts.ts';

export type VerifiedQuote = { description: string; price: bigint; expiresAt: number; task: string; provider: Address; chainId: 56 | 97 };
function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Quote must be a JSON object');
  return value as Record<string, unknown>;
}
function text(value: unknown): string {
  if (typeof value !== 'string') throw new Error('Quote is missing required text');
  return value;
}
function sanitize(value: unknown): string {
  return text(value).replaceAll('[', '(').replaceAll(']', ')').replace(/[\u0000-\u0008\u000b-\u001f]/g, '');
}
/** SDK0.5.5 canonical JSON: sorted keys, ASCII escaping, no truncation. */
export function canonicalQuote(value: unknown): string {
  const sort = (v: unknown): unknown => {
    if (Array.isArray(v)) return v.map(sort);
    if (v && typeof v === 'object') return Object.fromEntries(Object.entries(v).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0).map(([k, x]) => [k, sort(x)]));
    if (typeof v === 'number' && !Number.isFinite(v)) throw new Error('Non-finite quote value');
    return v;
  };
  return JSON.stringify(sort(value)).replace(/[\u007f-\uffff]/g, (ch) => `\\u${ch.charCodeAt(0).toString(16).padStart(4, '0')}`);
}

export async function normalizeQuote(input: unknown, provider: Address, chainId: 56 | 97, nowSeconds: number): Promise<VerifiedQuote> {
  const envelope = record(input);
  if (chainId !== 56 && chainId !== 97) throw new Error('Unsupported chain');
  if (!isAddress(provider) || /^0x0{40}$/i.test(provider)) throw new Error('A seller address is required');
  const d = CONTRACTS[chainId];
  let content: Record<string, unknown>;
  if (envelope.response) {
    const response = record(envelope.response);
    const request = record(envelope.request);
    const terms = record(response.terms);
    if (response.accepted !== true) throw new Error('The seller did not accept this job');
    const claimTerms: Record<string, unknown> = { deliverables: sanitize(terms.deliverables), quality_standards: sanitize(terms.quality_standards) };
    if (Array.isArray(terms.success_criteria) && terms.success_criteria.length) claimTerms.success_criteria = terms.success_criteria.map(sanitize);
    content = { version: 1, negotiated_at: envelope.negotiated_at || response.negotiated_at, task: sanitize(request.task_description), terms: claimTerms, price: terms.price, currency: terms.currency, quote_expires_at: envelope.quote_expires_at || response.quote_expires_at, chain_id: envelope.chain_id, verifying_contract: getAddress(text(envelope.verifying_contract)) };
  } else {
    content = Object.fromEntries(Object.entries(envelope).filter(([key]) => key !== 'negotiation_hash' && key !== 'provider_sig'));
  }
  if (content.version !== 1 || content.chain_id !== chainId) throw new Error('Quote is not bound to the selected chain');
  if (text(content.verifying_contract).toLowerCase() !== d.commerceProxy.toLowerCase()) throw new Error('Quote targets a different commerce contract');
  if (text(content.currency).toLowerCase() !== d.paymentToken.toLowerCase()) throw new Error('Quote requests an unsupported payment token');
  const expiry = content.quote_expires_at;
  const negotiatedAt = content.negotiated_at;
  if (typeof expiry !== 'number' || !Number.isSafeInteger(expiry) || expiry <= nowSeconds) throw new Error('Quote expired or has no expiry. Request a fresh quote.');
  if (typeof negotiatedAt !== 'number' || !Number.isSafeInteger(negotiatedAt) || negotiatedAt > nowSeconds + 60 || expiry - negotiatedAt > 900 || expiry <= negotiatedAt) throw new Error('Quote has an invalid validity window');
  const priceText = text(content.price);
  if (!/^(0|[1-9][0-9]*)$/.test(priceText)) throw new Error('Quote price must be an integer in raw token units');
  const price = BigInt(priceText);
  if (price > 20n * 10n ** 18n) throw new Error('Quote exceeds the 20 U per-job limit');
  const task = text(content.task);
  if (!task.trim()) throw new Error('Quote has no task');
  const hash = text(envelope.negotiation_hash);
  const signature = text(envelope.provider_sig);
  if (!/^0x[0-9a-f]{64}$/i.test(hash) || !/^0x[0-9a-f]{130}$/i.test(signature)) throw new Error('Quote has no supported seller signature');
  if (keccak256(toBytes(canonicalQuote(content))).toLowerCase() !== hash.toLowerCase()) throw new Error('Quote content does not match its signed hash');
  const signer = await recoverMessageAddress({ message: hash, signature: signature as Hex });
  if (signer.toLowerCase() !== provider.toLowerCase()) throw new Error('Quote signature does not match the selected seller');
  const description = canonicalQuote({ ...content, negotiation_hash: hash, provider_sig: signature });
  if (description.length > 4096) throw new Error('Quote exceeds the on-chain description size limit');
  return { description, price, expiresAt: expiry, task, provider: getAddress(provider), chainId };
}
