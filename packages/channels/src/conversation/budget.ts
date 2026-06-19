import type { ChannelKind } from '../types';

export interface TurnGateDeps {
  take(accountId: string, channel: ChannelKind): Promise<{ granted: boolean; turns: number; channelSpent: number; warn: boolean }>;
  anomaly(accountId: string, channel: ChannelKind): Promise<boolean>;
}

export interface TurnGateConfig {
  turnLimit: number;
  smsSpendCapMicroUsd: number;
  defaultSpendCapMicroUsd: number;
}

const BREATHER =
  'Your grove is taking a breather — it has been unusually busy and paused to stay within your limits. Open the app to pick up where it left off.';

const SPEND_WARN =
  "Heads up — your grove is close to today's messaging limit. It'll keep going until the limit, then pick back up tomorrow.";

export type TurnGateResult =
  | { ok: true; warn?: { notice: string } }
  | { ok: false; reason: 'budget' | 'anomaly'; notice: string };

export async function gateTurn(
  accountId: string, channel: ChannelKind, deps: TurnGateDeps, _cfg: TurnGateConfig,
): Promise<TurnGateResult> {
  // anomaly check first — auto-pause before any spend (ties §11 / AS-§18.4)
  if (await deps.anomaly(accountId, channel)) return { ok: false, reason: 'anomaly', notice: BREATHER };
  const r = await deps.take(accountId, channel);
  if (!r.granted) return { ok: false, reason: 'budget', notice: BREATHER };
  return r.warn ? { ok: true, warn: { notice: SPEND_WARN } } : { ok: true };
}
