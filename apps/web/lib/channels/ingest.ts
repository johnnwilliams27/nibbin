import { applyBattery } from '@nibbin/redaction';
import { quarantine } from '@nibbin/connectors';
import type { InboundChannelMessage, InboundResult } from '@nibbin/channels';

export const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export function asUuid(v?: string) { return v && UUID_RE.test(v) ? v : undefined; }

export interface IngestDeps {
  resolveAccount(channel: string, externalId: string): Promise<string | null>;
  verifyBinding(nonce: string, externalId: string, label?: string): Promise<string | null>;
  persistInbound(row: {
    accountId: string; channel: string; externalId: string;
    redactedText: string; redactionRules: string[]; inReplyTo?: string; action?: 'approve' | 'deny';
  }): Promise<void>;
  handoff(verified: {
    accountId: string; inbound: InboundChannelMessage; quarantined: { wrapped: string; source: string };
  }): Promise<void>;
}

export async function ingestInbound(inbound: InboundChannelMessage, deps: IngestDeps): Promise<InboundResult> {
  // 1. linking
  if (inbound.startNonce) {
    const chId = await deps.verifyBinding(inbound.startNonce, inbound.externalId);
    return { status: chId ? 'linked' : 'ignored_expired' };
  }
  // 2. identity (N-P3) — drop unverified pre-LLM, persist nothing
  const accountId = await deps.resolveAccount(inbound.channel, inbound.externalId);
  if (!accountId) return { status: 'ignored_unverified' };

  // 3. redact + quarantine, then persist + hand off
  const battery = applyBattery(inbound.text);
  const quarantined = quarantine(battery.text, `${inbound.channel}:${accountId}`);
  await deps.persistInbound({
    accountId, channel: inbound.channel, externalId: inbound.externalId,
    redactedText: battery.text, redactionRules: battery.rulesHit,
    inReplyTo: asUuid(inbound.inReplyTo), action: inbound.action,
  });
  await deps.handoff({ accountId, inbound, quarantined: { wrapped: quarantined.wrapped, source: quarantined.source } });
  return { status: 'accepted' };
}
