/**
 * Drip worker entry — no dev server, just a tick (§4.5). Run on a schedule
 * (cron / scheduled job); overlapping runs are safe because claimSend is
 * atomic at the database.
 *
 *   npm run drip:worker
 *
 * Env: DRIP_DATABASE_URL (service connection), RESEND_API_KEY,
 * EMAIL_UNSUBSCRIBE_SECRET, EMAIL_WARMUP_START (ISO date — REQUIRED before
 * anything sends, §6.8), NEXT_PUBLIC_SITE_URL, EMAIL_POSTAL_ADDRESS.
 */
import { Pool } from 'pg';
import { createBeatMailer, resendProvider } from '@nibbin/email';
import type { SendLog, SuppressionStore } from '@nibbin/email';
import { pgDripStore } from './pg-store';
import { stubArcData } from './stub';
import { tick } from './worker';

function required(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`missing env: ${name}`);
  return v;
}

/** Suppression + send-log adapters over the same pool (M5 tables). */
function pgSuppressions(pool: Pool): SuppressionStore {
  return {
    async isSuppressed(email) {
      const r = await pool.query(`select 1 from email_suppressions where email = $1`, [email]);
      return (r.rowCount ?? 0) > 0;
    },
    async add(email, reason) {
      await pool.query(
        `insert into email_suppressions (email, reason) values ($1, $2)
         on conflict (email) do nothing`,
        [email, reason],
      );
    },
  };
}

function pgSendLog(pool: Pool): SendLog {
  return {
    async countForUtcDay(utcDay) {
      const r = await pool.query<{ n: string }>(
        `select count(*)::text as n from email_sends
          where sent_at >= $1::date and sent_at < ($1::date + interval '1 day')`,
        [utcDay],
      );
      return Number(r.rows[0]?.n ?? 0);
    },
    async record(entry) {
      await pool.query(
        `insert into email_sends (account_id, to_email, beat, provider_id) values ($1, $2, $3, $4)`,
        [entry.accountId, entry.to, entry.beat, entry.providerId],
      );
    },
  };
}

async function main(): Promise<void> {
  const pool = new Pool({ connectionString: required('DRIP_DATABASE_URL') });
  const store = pgDripStore(pool);

  const warmupStart = process.env.EMAIL_WARMUP_START ? new Date(process.env.EMAIL_WARMUP_START) : null;
  const email = createBeatMailer({
    config: {
      from: process.env.EMAIL_FROM ?? 'Nibbin <keeper@mail.nibbin.com>',
      siteUrl: required('NEXT_PUBLIC_SITE_URL'),
      postalAddress: required('EMAIL_POSTAL_ADDRESS'),
      unsubscribeSecret: required('EMAIL_UNSUBSCRIBE_SECRET'),
      warmupStart: warmupStart && !Number.isNaN(warmupStart.getTime()) ? warmupStart : null,
    },
    suppressions: pgSuppressions(pool),
    log: pgSendLog(pool),
    provider: resendProvider(required('RESEND_API_KEY')),
  });

  try {
    const opened = await store.ensureArcs();
    const result = await tick({
      store,
      // M4 in flight: the stub port keeps every beat honest-but-short.
      // Reconcile on rebase: swap in the adapter over runs/scan tables.
      data: stubArcData(),
      email,
      clock: () => new Date(),
      onError: (accountId, err) => {
        console.error(`[drip] arc ${accountId} failed`, err instanceof Error ? err.message : err);
      },
    });
    console.log(
      `[drip] arcs=${result.arcs} (+${opened} opened) pushed=${result.pushed} skipped=${result.skipped} ` +
        `completed=${result.completed} earned=${result.earnedNotifications} errors=${result.errors}`,
    );
    if (result.errors > 0) process.exitCode = 1;
  } finally {
    await pool.end();
  }
}

main().catch((err) => {
  console.error('[drip] tick crashed', err);
  process.exitCode = 1;
});
