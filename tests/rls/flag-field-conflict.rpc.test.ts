import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { RlsHarness } from './harness';

const dbAvailable = await RlsHarness.probe();
if (!dbAvailable && !process.env.CI) {
  console.warn('[rls] no database — skipping flag-field-conflict suite');
}

const UID_A = 'fc000001-0000-4000-8000-000000000001';

describe.skipIf(!dbAvailable)('flag_field_conflict + ensure_source_authority RPCs', () => {
  const h = new RlsHarness();
  let acct = '';
  const asU = { kind: 'authenticated', uid: UID_A } as const;
  const service = { kind: 'service_role' } as const;

  beforeAll(async () => {
    await h.reset();
    await h.sql(`insert into auth.users (id,email) values ($1,'ffc@ex.test')`, [UID_A]);
    await h.as(asU, async (c) => {
      await c.query(`insert into public.users (id,email) values ($1,$2)`, [UID_A, 'ffc@ex.test']);
    });
    acct = await h.as(asU, async (c) =>
      (await c.query(`select public.create_account_with_owner('FFC-Test') as id`)).rows[0].id,
    );
  });

  afterAll(async () => {
    await h.close();
  });

  // ── ensure_source_authority ──────────────────────────────────────────────

  it('ensure_source_authority seeds exactly 4 rows with correct weights', async () => {
    await h.as(service, async (c) => {
      await c.query(`select public.ensure_source_authority($1)`, [acct]);
    });

    const rows = await h.as(service, async (c) =>
      (await c.query(
        `select source_kind, weight::integer as weight
         from public.source_authority
         where account_id = $1
         order by source_kind`,
        [acct],
      )).rows,
    );

    expect(rows).toHaveLength(4);
    const byKind = Object.fromEntries(rows.map((r: { source_kind: string; weight: number }) => [r.source_kind, r.weight]));
    expect(byKind['document']).toBe(70);
    expect(byKind['manual']).toBe(65);
    expect(byKind['connector_artifact']).toBe(50);
    expect(byKind['observation']).toBe(40);
  });

  it('ensure_source_authority is idempotent (call twice → still 4 rows, unchanged weights)', async () => {
    await h.as(service, async (c) => {
      await c.query(`select public.ensure_source_authority($1)`, [acct]);
    });

    const rows = await h.as(service, async (c) =>
      (await c.query(
        `select source_kind, weight::integer as weight
         from public.source_authority
         where account_id = $1`,
        [acct],
      )).rows,
    );

    expect(rows).toHaveLength(4);
  });

  // ── flag_field_conflict ──────────────────────────────────────────────────

  it('fresh conflict inserts one needs_review flag and one notification', async () => {
    const srcId1 = await h.as(service, async (c) =>
      (await c.query(
        `insert into public.sources (account_id, kind, title) values ($1, 'document', 'doc-a') returning id`,
        [acct],
      )).rows[0].id,
    );
    const srcId2 = await h.as(service, async (c) =>
      (await c.query(
        `insert into public.sources (account_id, kind, title) values ($1, 'manual', 'manual-b') returning id`,
        [acct],
      )).rows[0].id,
    );

    const flagId = await h.as(service, async (c) =>
      (await c.query(
        `select public.flag_field_conflict($1, $2, $3::uuid[], $4) as id`,
        [acct, 'pricing', `{${srcId1},${srcId2}}`, 'Source A says $100, Source B says $120'],
      )).rows[0].id,
    );
    expect(flagId).toBeTruthy();

    const flags = await h.as(service, async (c) =>
      (await c.query(
        `select status, competing_source_ids, detail from public.field_flags
         where account_id = $1 and field_key = 'pricing'`,
        [acct],
      )).rows,
    );
    expect(flags).toHaveLength(1);
    expect(flags[0].status).toBe('needs_review');
    expect(flags[0].detail).toBe('Source A says $100, Source B says $120');

    const notifs = await h.as(service, async (c) =>
      (await c.query(
        `select title, body, payload, stakes from public.notifications
         where account_id = $1 and kind = 'review_item' and source_id = $2`,
        [acct, flagId],
      )).rows,
    );
    expect(notifs).toHaveLength(1);
    expect(notifs[0].title).toBe('A conflict needs your review');
    expect(notifs[0].body).toBe('Source A says $100, Source B says $120');
    expect(notifs[0].payload).toMatchObject({
      field_flag_id: flagId,
      field_key: 'pricing',
      kind: 'conflict',
    });
    expect(notifs[0].stakes).toBe('normal');
  });

  it('second call for the same open (account, field_key) updates — not duplicates', async () => {
    const srcId3 = await h.as(service, async (c) =>
      (await c.query(
        `insert into public.sources (account_id, kind, title) values ($1, 'connector_artifact', 'stripe-c') returning id`,
        [acct],
      )).rows[0].id,
    );

    // First call — field 'bio' is already open from prior test? No, use a new key.
    const flagId1 = await h.as(service, async (c) =>
      (await c.query(
        `select public.flag_field_conflict($1, $2, $3::uuid[], $4) as id`,
        [acct, 'tagline', `{${srcId3}}`, 'First detail'],
      )).rows[0].id,
    );

    // Second call — same (account, 'tagline')
    const flagId2 = await h.as(service, async (c) =>
      (await c.query(
        `select public.flag_field_conflict($1, $2, $3::uuid[], $4) as id`,
        [acct, 'tagline', `{${srcId3}}`, 'Updated detail'],
      )).rows[0].id,
    );

    expect(flagId2).toBe(flagId1);

    const openFlags = await h.as(service, async (c) =>
      (await c.query(
        `select id, detail from public.field_flags
         where account_id = $1 and field_key = 'tagline' and status = 'needs_review'`,
        [acct],
      )).rows,
    );
    expect(openFlags).toHaveLength(1);
    expect(openFlags[0].detail).toBe('Updated detail');
  });

  it('p_stakes="high" is accepted and recorded on the notification', async () => {
    const srcId4 = await h.as(service, async (c) =>
      (await c.query(
        `insert into public.sources (account_id, kind, title) values ($1, 'document', 'policy-doc') returning id`,
        [acct],
      )).rows[0].id,
    );

    const flagId = await h.as(service, async (c) =>
      (await c.query(
        `select public.flag_field_conflict($1, $2, $3::uuid[], $4, $5) as id`,
        [acct, 'policies', `{${srcId4}}`, 'Policies conflict', 'high'],
      )).rows[0].id,
    );
    expect(flagId).toBeTruthy();

    const notif = await h.as(service, async (c) =>
      (await c.query(
        `select stakes from public.notifications where account_id=$1 and kind='review_item' and source_id=$2`,
        [acct, flagId],
      )).rows[0],
    );
    expect(notif.stakes).toBe('high');
  });

  it('rejects p_stakes with an invalid value', async () => {
    const srcId5 = await h.as(service, async (c) =>
      (await c.query(
        `insert into public.sources (account_id, kind, title) values ($1, 'manual', 'x') returning id`,
        [acct],
      )).rows[0].id,
    );

    await expect(
      h.as(service, (c) =>
        c.query(
          `select public.flag_field_conflict($1, $2, $3::uuid[], $4, $5)`,
          [acct, 'bad_field', `{${srcId5}}`, 'detail', 'urgent'],
        ),
      ),
    ).rejects.toThrow(/stakes/i);
  });

  it('authenticated caller cannot execute flag_field_conflict', async () => {
    await expect(
      h.as(asU, (c) =>
        c.query(
          `select public.flag_field_conflict($1, $2, '{}'::uuid[], $3)`,
          [acct, 'some_field', 'detail'],
        ),
      ),
    ).rejects.toThrow(/permission denied/i);
  });

  it('anon caller cannot execute flag_field_conflict', async () => {
    await expect(
      h.as({ kind: 'anon' }, (c) =>
        c.query(
          `select public.flag_field_conflict($1, $2, '{}'::uuid[], $3)`,
          [acct, 'some_field', 'detail'],
        ),
      ),
    ).rejects.toThrow(/permission denied/i);
  });
});
