import { createPublicClient, http, encodeFunctionData, decodeEventLog, erc20Abi, isAddress } from 'viem';
import type { Address, Hex, TransactionReceipt } from 'viem';
import { bsc, bscTestnet } from 'viem/chains';
import { CONTRACTS, COMMERCE_ABI, ROUTER_ABI, POLICY_ABI } from './commerce-contracts.ts';

export type CommerceAction = 'create' | 'register' | 'budget' | 'approve' | 'fund' | 'settle' | 'dispute' | 'refund';
export type CommerceContext = { chainId: 56 | 97; provider: Address; description: string; price: bigint; expiredAt: bigint; jobId: bigint | null };
export const MAX_BUDGET = 20n * 10n ** 18n;
export const ACTION_LABEL: Record<CommerceAction, string> = { create: 'Create job', register: 'Register job policy', budget: 'Set exact budget', approve: 'Approve exact token amount', fund: 'Fund escrow', settle: 'Settle job', dispute: 'Dispute delivery', refund: 'Claim expired-job refund' };

export function chainClient(chainId: 56 | 97) {
  return createPublicClient({ chain: chainId === 97 ? bscTestnet : bsc, transport: http(chainId === 97 ? 'https://bsc-testnet-dataseed.bnbchain.org' : 'https://bsc-dataseed.bnbchain.org', { timeout: 15000, retryCount: 1 }) });
}

/** Pure transaction construction. No sends, no unlimited approval, no dynamic contracts. */
export function commerceCall(action: CommerceAction, context: CommerceContext): { to: Address; data: Hex; value: '0x0' } {
  const { chainId, provider, description, price, expiredAt, jobId } = context;
  if (chainId !== 56 && chainId !== 97) throw new Error('Only BNB mainnet and testnet are supported');
  if (!isAddress(provider) || /^0x0{40}$/i.test(provider)) throw new Error('A verified seller address is required');
  if (price < 0n || price > MAX_BUDGET) throw new Error('Budget exceeds the 20 U per-job limit');
  if (action !== 'create' && (jobId === null || jobId <= 0n)) throw new Error('A confirmed job is required');
  const d = CONTRACTS[chainId];
  const base = { value: '0x0' as const };
  switch (action) {
    case 'create': return { ...base, to: d.commerceProxy, data: encodeFunctionData({ abi: COMMERCE_ABI, functionName: 'createJob', args: [provider, d.routerProxy, expiredAt, description, d.routerProxy] }) };
    case 'register': return { ...base, to: d.routerProxy, data: encodeFunctionData({ abi: ROUTER_ABI, functionName: 'registerJob', args: [jobId!, d.policy] }) };
    case 'budget': return { ...base, to: d.commerceProxy, data: encodeFunctionData({ abi: COMMERCE_ABI, functionName: 'setBudget', args: [jobId!, price, '0x'] }) };
    case 'approve': return { ...base, to: d.paymentToken, data: encodeFunctionData({ abi: erc20Abi, functionName: 'approve', args: [d.commerceProxy, price] }) };
    case 'fund': return { ...base, to: d.commerceProxy, data: encodeFunctionData({ abi: COMMERCE_ABI, functionName: 'fund', args: [jobId!, price, '0x'] }) };
    case 'settle': return { ...base, to: d.routerProxy, data: encodeFunctionData({ abi: ROUTER_ABI, functionName: 'settle', args: [jobId!, '0x'] }) };
    case 'dispute': return { ...base, to: d.policy, data: encodeFunctionData({ abi: POLICY_ABI, functionName: 'dispute', args: [jobId!] }) };
    case 'refund': return { ...base, to: d.commerceProxy, data: encodeFunctionData({ abi: COMMERCE_ABI, functionName: 'claimRefund', args: [jobId!] }) };
  }
}

export function createdJobId(receipt: Pick<TransactionReceipt, 'logs'>, chainId: 56 | 97): bigint | null {
  for (const log of receipt.logs) {
    if (log.address.toLowerCase() !== CONTRACTS[chainId].commerceProxy.toLowerCase()) continue;
    try {
      const event = decodeEventLog({ abi: COMMERCE_ABI, eventName: 'JobCreated', data: log.data, topics: log.topics });
      if (event.eventName === 'JobCreated') return event.args.jobId;
    } catch { /* Other logs do not establish our job. */ }
  }
  return null;
}

export function explorerTransaction(chainId: 56 | 97, hash: Hex): string {
  return `https://${chainId === 97 ? 'testnet.' : ''}bscscan.com/tx/${hash}`;
}
