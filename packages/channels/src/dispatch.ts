import type { ChannelKind, ChannelPort, OutboundChannelMessage, Urgency } from './types.js';

const URGENCY_RANK: Record<Urgency, number> = { normal: 0, high: 1, urgent: 2 };

export interface ChannelStore {
  verifiedChannels(accountId: string): Promise<{ channel: ChannelKind; externalId: string }[]>;
  prefs(accountId: string): Promise<{ channel: ChannelKind; enabled: boolean; priority: number; urgencyThreshold: Urgency | 'all' }[]>;
  quietHours(accountId: string): Promise<{ start: number; end: number } | null>;
  logDelivery(row: {
    accountId: string; channel: ChannelKind | 'push'; direction: 'outbound'; kind: OutboundChannelMessage['kind'];
    status: 'delivered' | 'failed' | 'fallback'; urgency: Urgency; providerMessageId?: string; costMicroUsd: number; requestId?: string;
  }): Promise<void>;
}

export interface DispatchContext {
  ports: Map<ChannelKind, ChannelPort>;
  floor: ChannelPort;
  store: ChannelStore;
  now(): Date;
  /** Resolve the account's local hour (0..23) for the given instant. */
  localHour(date: Date, accountId?: string): number;
}

export interface DispatchResult {
  deliveredVia: ChannelKind | 'floor';
  attempts: { channel: ChannelKind; ok: boolean }[];
}

function inQuietHours(hour: number, q: { start: number; end: number }): boolean {
  return q.start <= q.end ? hour >= q.start && hour < q.end : hour >= q.start || hour < q.end;
}

export async function deliverWithFallback(msg: OutboundChannelMessage, ctx: DispatchContext): Promise<DispatchResult> {
  const [verified, prefs, quiet] = await Promise.all([
    ctx.store.verifiedChannels(msg.accountId),
    ctx.store.prefs(msg.accountId),
    ctx.store.quietHours(msg.accountId),
  ]);
  const prefBy = new Map(prefs.map((p) => [p.channel, p]));
  const quietNow = quiet ? inQuietHours(ctx.localHour(ctx.now(), msg.accountId), quiet) : false;

  // eligible = verified ∧ enabled ∧ urgency≥threshold ∧ (not quiet OR urgent) ∧ adapter configured,
  // ordered by priority asc. A verified channel with no configured adapter port is not deliverable
  // and is excluded here so the fallback chain can proceed to the next eligible channel instead of
  // silently skipping it mid-loop.
  const eligible = verified
    .map((v) => ({ v, p: prefBy.get(v.channel) }))
    .filter(({ p }) => p && p.enabled)
    .filter(({ p }) => p!.urgencyThreshold === 'all' || URGENCY_RANK[msg.urgency] >= URGENCY_RANK[p!.urgencyThreshold as Urgency])
    .filter(() => !quietNow || msg.urgency === 'urgent')
    .filter(({ v }) => ctx.ports.has(v.channel)) // a verified channel with no configured adapter is not deliverable; let the fallback chain handle it
    .sort((a, b) => a.p!.priority - b.p!.priority);

  const attempts: { channel: ChannelKind; ok: boolean }[] = [];
  for (const { v } of eligible) {
    const port = ctx.ports.get(v.channel);
    if (!port) continue;
    const res = await port.deliver({ ...msg, channel: v.channel, externalId: v.externalId });
    attempts.push({ channel: v.channel, ok: res.delivered });
    await ctx.store.logDelivery({
      accountId: msg.accountId, channel: v.channel, direction: 'outbound', kind: msg.kind,
      status: res.delivered ? 'delivered' : 'failed', urgency: msg.urgency,
      providerMessageId: res.providerMessageId, costMicroUsd: res.costMicroUsd ?? 0, requestId: msg.requestId,
    });
    if (res.delivered) return { deliveredVia: v.channel, attempts };
  }

  // terminal floor — always succeeds (§10)
  await ctx.floor.deliver(msg);
  await ctx.store.logDelivery({
    accountId: msg.accountId, channel: 'push', direction: 'outbound', kind: msg.kind,
    status: 'fallback', urgency: msg.urgency, costMicroUsd: 0, requestId: msg.requestId,
  });
  return { deliveredVia: 'floor', attempts };
}
