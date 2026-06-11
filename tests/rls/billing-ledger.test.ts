/**
 * Billing ledger idempotency at the DB layer (Stripe webhook retries/replays).
 * A redelivered paid event must never double-credit — proven by the unique
 * (account_id, source_id) indexes for both grant and topup.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { RlsHarness } from './harness';

const dbAvailable = await RlsHarness.probe();

describe.skipIf(!dbAvailable)('billing ledger idempotency (webhook retries)', () => {
  const h = new RlsHarness();
  const service = { kind: 'service_role' } as const;
  const UID = '77777777-7777-4777-8777-777777777777';
  let accountId = '';

  beforeAll(async () => {
    await h.reset();
    await h.sql(`insert into auth.users (id, email) values ($1, 'b@example.test')`, [UID]);
    await h.as({ kind: 'authenticated', uid: UID } as const, async (c) => {
      await c.query(`insert into public.users (id, email, name) values ($1, 'b@example.test', 'B')`, [UID]);
    });
    accountId = await h.as({ kind: 'authenticated', uid: UID } as const, async (c) =>
      (await c.query(`select public.create_account_with_owner('Acct') as id`)).rows[0].id,
    );
  });

  afterAll(async () => {
    await h.close();
  });

  it('a repeated subscription grant for the same invoice is rejected (idempotent)', async () => {
    await h.as(service, (c) =>
      c.query(`insert into public.credit_ledger (account_id, delta, reason, source_id) values ($1, 1000, 'grant', 'in_1')`, [accountId]),
    );
    await expect(
      h.as(service, (c) =>
        c.query(`insert into public.credit_ledger (account_id, delta, reason, source_id) values ($1, 1000, 'grant', 'in_1')`, [accountId]),
      ),
    ).rejects.toThrow(/duplicate key/);
  });

  it('a repeated top-up for the same payment is rejected (idempotent) — the PR #12 P0 fix', async () => {
    await h.as(service, (c) =>
      c.query(`insert into public.credit_ledger (account_id, delta, reason, source_id) values ($1, 1000, 'topup', 'pi_1')`, [accountId]),
    );
    await expect(
      h.as(service, (c) =>
        c.query(`insert into public.credit_ledger (account_id, delta, reason, source_id) values ($1, 1000, 'topup', 'pi_1')`, [accountId]),
      ),
    ).rejects.toThrow(/duplicate key/);
  });

  it('distinct payments still top up independently', async () => {
    await h.as(service, (c) =>
      c.query(`insert into public.credit_ledger (account_id, delta, reason, source_id) values ($1, 2000, 'topup', 'pi_2')`, [accountId]),
    );
    const balance = await h.as(service, async (c) =>
      (await c.query(`select sum(delta)::int as b from public.credit_ledger where account_id = $1`, [accountId])).rows[0].b,
    );
    // in_1 (1000) + pi_1 (1000) + pi_2 (2000)
    expect(balance).toBe(4000);
  });
});
