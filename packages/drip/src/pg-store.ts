/**
 * Postgres implementation of DripStore over the M5 tables
 * (supabase/migrations/20260611120000_m5_drip_email.sql). Runs with the
 * service role / direct connection — RLS does not apply to the worker; the
 * unique indexes are the correctness layer. Zero string-built SQL.
 */
import type { Pool } from 'pg';
import type { ArcRow, BeatContent, BeatKey, DripStore, EarnedEvent, SendRecord, SendStatus } from './types';

interface ArcQueryRow {
  account_id: string;
  started_at: Date;
  email_enabled: boolean;
  quiet_start: number;
  quiet_end: number;
  tz: string | null;
  email: string | null;
}

interface SendQueryRow {
  account_id: string;
  beat: BeatKey;
  status: SendStatus;
  local_day: string;
  claimed_at: Date | null;
}

export function pgDripStore(pool: Pool): DripStore & { ensureArcs(): Promise<number> } {
  return {
    /** Open an arc for every account whose hatch (§4.1) has completed. */
    async ensureArcs(): Promise<number> {
      const r = await pool.query(
        `insert into drip_arcs (account_id)
           select account_id from grove_state where onboarding_step = 'done'
         on conflict (account_id) do nothing`,
      );
      return r.rowCount ?? 0;
    },

    async activeArcs(): Promise<ArcRow[]> {
      const arcs = await pool.query<ArcQueryRow>(
        `select a.account_id, a.started_at, a.email_enabled, a.quiet_start, a.quiet_end,
                u.tz, u.email
           from drip_arcs a
           join memberships m on m.account_id = a.account_id
                             and m.role = 'owner' and m.status = 'active'
           join users u on u.id = m.user_id
          where a.status = 'active'`,
      );
      if (arcs.rows.length === 0) return [];

      const ids = arcs.rows.map((r) => r.account_id);
      const sends = await pool.query<SendQueryRow>(
        `select account_id, beat, status, to_char(local_day, 'YYYY-MM-DD') as local_day, claimed_at
           from drip_sends where account_id = any($1::uuid[])`,
        [ids],
      );
      const byAccount = new Map<string, SendRecord[]>();
      for (const s of sends.rows) {
        const list = byAccount.get(s.account_id) ?? [];
        list.push({ beat: s.beat, status: s.status, localDay: s.local_day, claimedAt: s.claimed_at });
        byAccount.set(s.account_id, list);
      }

      return arcs.rows.map((r) => ({
        accountId: r.account_id,
        startedAt: r.started_at,
        tz: r.tz,
        quiet: { start: r.quiet_start, end: r.quiet_end },
        emailEnabled: r.email_enabled,
        email: r.email ?? '',
        sends: byAccount.get(r.account_id) ?? [],
      }));
    },

    /** The atomic gate: both unique indexes arbitrate, not a read. */
    async claimSend(accountId, beat, localDay): Promise<boolean> {
      const r = await pool.query(
        `insert into drip_sends (account_id, beat, local_day, status)
         values ($1, $2, $3, 'claimed')
         on conflict do nothing`,
        [accountId, beat, localDay],
      );
      return (r.rowCount ?? 0) === 1;
    },

    async markSent(accountId, beat): Promise<void> {
      await pool.query(
        `update drip_sends set status = 'sent', sent_at = now()
          where account_id = $1 and beat = $2 and status = 'claimed'`,
        [accountId, beat],
      );
    },

    async markFailed(accountId, beat): Promise<void> {
      await pool.query(
        `update drip_sends set status = 'failed'
          where account_id = $1 and beat = $2 and status = 'claimed'`,
        [accountId, beat],
      );
    },

    async recordSkipped(accountId, beats, localDay): Promise<void> {
      for (const beat of beats) {
        await pool.query(
          `insert into drip_sends (account_id, beat, local_day, status)
           values ($1, $2, $3, 'skipped')
           on conflict do nothing`,
          [accountId, beat, localDay],
        );
      }
    },

    async completeArc(accountId): Promise<void> {
      await pool.query(`update drip_arcs set status = 'completed' where account_id = $1`, [accountId]);
    },

    async insertEarnedNotification(accountId, event: EarnedEvent): Promise<void> {
      const title = event.kind === 'graduation' ? `${event.nibbin} graduated` : `${event.nibbin} evolved`;
      await pool.query(
        `insert into notifications (account_id, kind, source_id, title, body)
         values ($1, $2, $3, $4, $5)
         on conflict (account_id, kind, source_id) do nothing`,
        [accountId, event.kind, event.id, title, event.detail],
      );
    },

    async insertBeatNotification(accountId, content: BeatContent): Promise<void> {
      await pool.query(
        `insert into notifications (account_id, kind, source_id, title, body, payload)
         values ($1, 'beat', $2, $3, $4, $5)
         on conflict (account_id, kind, source_id) do nothing`,
        [
          accountId,
          content.key,
          content.title,
          content.body,
          JSON.stringify({
            cards: content.cards,
            celebration: content.celebration,
            ctaPath: content.ctaPath,
            ctaLabel: content.ctaLabel,
          }),
        ],
      );
    },
  };
}
