/**
 * Postgres implementation of DripStore over the M5 tables
 * (supabase/migrations/20260612000000_m5_drip_email.sql). Runs with the
 * service role / direct connection — RLS does not apply to the worker; the
 * unique indexes are the correctness layer. Zero string-built SQL.
 */
import type { Pool } from 'pg';
import type { ArcRow, ArcStatus, BeatContent, BeatKey, DripStore, EarnedEvent, SendRecord, SendStatus } from './types';

interface ArcQueryRow {
  account_id: string;
  started_at: Date;
  status: ArcStatus;
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

    async arcs(): Promise<ArcRow[]> {
      // Every arc, any status: earned-event leaves keep flowing after the
      // 14 days close (a graduation on day 20 still lands); the worker only
      // plans beats for status='active'.
      const arcs = await pool.query<ArcQueryRow>(
        `select a.account_id, a.started_at, a.status, a.email_enabled, a.quiet_start, a.quiet_end,
                u.tz, u.email
           from drip_arcs a
           join memberships m on m.account_id = a.account_id
                             and m.role = 'owner' and m.status = 'active'
           join users u on u.id = m.user_id`,
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
        status: r.status,
        tz: r.tz,
        quiet: { start: r.quiet_start, end: r.quiet_end },
        emailEnabled: r.email_enabled,
        email: r.email ?? '',
        sends: byAccount.get(r.account_id) ?? [],
      }));
    },

    /**
     * The atomic gate. Three guards, ALL in the database so a worker holding
     * a stale arc snapshot cannot double-push: unique (account_id, slot),
     * the one-push-per-local-day partial index, and the 20h spacing floor
     * re-checked here against live rows (the scheduler's in-memory check is
     * a courtesy; this is the enforcement).
     */
    async claimSend(accountId, beat, slot, localDay): Promise<boolean> {
      const r = await pool.query(
        `insert into drip_sends (account_id, beat, slot, local_day, status)
         select $1, $2, $3, $4, 'claimed'
          where not exists (
            select 1 from drip_sends
             where account_id = $1
               and status <> 'skipped'
               and claimed_at > now() - interval '20 hours'
          )
         on conflict do nothing`,
        [accountId, beat, slot, localDay],
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

    async recordSkipped(accountId, skips, localDay): Promise<void> {
      for (const { beat, slot } of skips) {
        await pool.query(
          `insert into drip_sends (account_id, beat, slot, local_day, status)
           values ($1, $2, $3, $4, 'skipped')
           on conflict do nothing`,
          [accountId, beat, slot, localDay],
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
