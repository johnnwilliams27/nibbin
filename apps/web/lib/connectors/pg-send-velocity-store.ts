import 'server-only';

import type { SupabaseClient } from '@supabase/supabase-js';
import type { ConnectorDescriptor, SendRecordStore } from '@nibbin/connectors';
import type { SendDecision } from '@nibbin/connectors';

const HOUR_MS = 3_600_000;
const DAY_MS = 86_400_000;

/**
 * Atomic, durable send-velocity store backed by `send_velocity_records` +
 * `send_velocity_check_and_record` RPC (migration 20260620180000).
 *
 * The RPC serializes check-and-insert under a per-account advisory lock so two
 * concurrent sends can never both pass the cap — the TOCTOU that
 * MemorySendRecordStore carries under concurrency is eliminated at the DB layer.
 *
 * Fail-closed convention: any RPC error (network, auth, unexpected NULL)
 * returns `allowed: false` so a broken velocity store never enables excess sends.
 *
 * Implements `SendRecordStore` for drop-in compatibility with `SendVelocityLimiter`,
 * but the non-atomic `recentSends`/`recordSend` pair MUST NOT be used in
 * production. Use `checkAndConsume` instead, which is the atomic path.
 */
export class PgSendRecordStore implements SendRecordStore {
  constructor(private readonly svc: SupabaseClient) {}

  /**
   * Atomic check-and-consume for a single send attempt.
   *
   * New-account cooldown: the effective daily cap is computed in TS from
   * `accountCreatedAtMs` + descriptor (mirrors `SendVelocityLimiter`) so the
   * RPC receives the correct budget without embedding account-creation logic
   * in SQL. The hourly cap is never reduced for new accounts.
   */
  async checkAndConsume(
    accountId: string,
    descriptor: ConnectorDescriptor,
    accountCreatedAtMs: number,
  ): Promise<SendDecision> {
    const caps = descriptor.send?.velocity;
    if (!caps) {
      return { allowed: false, reason: 'daily-cap', retryAfterMs: DAY_MS };
    }

    const now = Date.now();
    const isNewAccount = now - accountCreatedAtMs < caps.newAccountCooldownHours * HOUR_MS;
    const dailyCap = isNewAccount
      ? Math.min(caps.newAccountPerDay, caps.perAccountPerDay)
      : caps.perAccountPerDay;

    type RpcRow = { allowed: boolean; used_hour: number; used_day: number };
    let rpcRow: RpcRow;
    try {
      const { data, error } = await this.svc.rpc('send_velocity_check_and_record', {
        p_account_id:   accountId,
        p_connector_id: descriptor.id,
        p_hourly_cap:   caps.perAccountPerHour,
        p_daily_cap:    dailyCap,
      });
      if (error) return { allowed: false, reason: 'daily-cap', retryAfterMs: DAY_MS };
      const row = (Array.isArray(data) ? data[0] : data) as RpcRow | null | undefined;
      if (!row) return { allowed: false, reason: 'daily-cap', retryAfterMs: DAY_MS };
      rpcRow = row;
    } catch {
      return { allowed: false, reason: 'daily-cap', retryAfterMs: DAY_MS };
    }

    if (rpcRow.allowed) return { allowed: true };

    // Determine which cap was hit for the denial reason and retryAfterMs.
    // The RPC does not return window-expiry timestamps, so we compute a
    // conservative retry ceiling: 1 hour for hourly-cap, 24 hours for
    // daily/new-account-cap. The caller (engine) surfaces this to the user.
    if (rpcRow.used_hour >= caps.perAccountPerHour) {
      return { allowed: false, reason: 'hourly-cap', retryAfterMs: HOUR_MS };
    }
    if (isNewAccount && dailyCap < caps.perAccountPerDay) {
      // Cooldown window may extend beyond the rolling 24h daily window.
      const cooldownRemainingMs = accountCreatedAtMs + caps.newAccountCooldownHours * HOUR_MS - now;
      return {
        allowed: false,
        reason: 'new-account-cap',
        retryAfterMs: Math.max(DAY_MS, cooldownRemainingMs),
      };
    }
    return { allowed: false, reason: 'daily-cap', retryAfterMs: DAY_MS };
  }

  // ── SendRecordStore shim (for SendVelocityLimiter compatibility) ─────────────
  // These are NON-atomic and must only be used in tests via MemorySendRecordStore.
  // Production code must call checkAndConsume above, not these two methods.

  async recentSends(accountId: string, connectorId: string, sinceMs: number): Promise<number[]> {
    const { data, error } = await this.svc
      .from('send_velocity_records')
      .select('sent_at')
      .eq('account_id', accountId)
      .eq('connector_id', connectorId)
      .gt('sent_at', new Date(sinceMs).toISOString());
    if (error) return [];
    return (data ?? []).map((r) => new Date(r.sent_at as string).getTime());
  }

  async recordSend(accountId: string, connectorId: string, atMs: number): Promise<void> {
    await this.svc.from('send_velocity_records').insert({
      account_id:   accountId,
      connector_id: connectorId,
      sent_at:      new Date(atMs).toISOString(),
    });
  }
}
