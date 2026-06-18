/**
 * RLS attack suite for insert_system_notification (drift nudge R2 + dignified
 * demotion CE5). The function is security definer, service_role-only: clients
 * have no execute grant (the only system-authored leaf path), and even the
 * service role can only author 'nudge'/'demotion' — the kind guard rejects
 * everything else so a caller can never forge a 'graduation' leaf. Posture
 * matches drip.test.ts: adversarial calls as the PostgREST roles.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { RlsHarness } from './harness';

const dbAvailable = await RlsHarness.probe();

if (!dbAvailable && !process.env.CI) {
  console.warn('[rls] no database at RLS_DATABASE_URL / localhost:54329 — skipping system-notification suite');
}

const UID_A = 'aaaaaaaa-7777-4777-8777-777777777777';

describe.skipIf(!dbAvailable)('insert_system_notification RLS (drift nudge + demotion)', () => {
  const h = new RlsHarness();
  let accountA = '';

  const asA = { kind: 'authenticated', uid: UID_A } as const;
  const anon = { kind: 'anon' } as const;
  const service = { kind: 'service_role' } as const;

  beforeAll(async () => {
    await h.reset();
    await h.sql(`insert into auth.users (id, email) values ($1, 'sa@example.test')`, [UID_A]);
    await h.as(asA, async (c) => {
      await c.query(`insert into public.users (id, email) values ($1, $2)`, [UID_A, `${UID_A}@example.test`]);
    });
    accountA = await h.as(asA, async (c) =>
      (await c.query(`select public.create_account_with_owner('A Grove') as id`)).rows[0].id,
    );
  });

  afterAll(async () => {
    await h.close();
  });

  it('clients (authenticated, anon) have no execute grant', async () => {
    for (const who of [asA, anon] as const) {
      await expect(
        h.as(who, async (c) =>
          c.query(`select public.insert_system_notification($1, 'nudge', 'x', 't', 'b', '{}'::jsonb)`, [accountA]),
        ),
      ).rejects.toThrow();
    }
  });

  it('the service role can author a nudge leaf', async () => {
    await h.as(service, async (c) => {
      await c.query(`select public.insert_system_notification($1, 'nudge', 'drift:n:2026-06-18', 't', 'b', '{}'::jsonb)`, [
        accountA,
      ]);
    });
    const rows = await h.as(service, async (c) =>
      (await c.query(`select kind from public.notifications where account_id = $1 and kind = 'nudge'`, [accountA])).rows,
    );
    expect(rows).toHaveLength(1);
  });

  it("the kind guard rejects 'graduation' even for the service role", async () => {
    await expect(
      h.as(service, async (c) =>
        c.query(`select public.insert_system_notification($1, 'graduation', 'x', 't', 'b', '{}'::jsonb)`, [accountA]),
      ),
    ).rejects.toThrow();
  });
});
