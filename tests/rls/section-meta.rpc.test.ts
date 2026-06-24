/**
 * RLS tests for upsert_section_meta RPC (Task 2 of memory extensible P1).
 *
 * Covers:
 *  (a) a member can upsert a custom section row
 *  (b) the 40-section cap raises when exceeded
 *  (c) a non-member is rejected
 *  (d) invalid custom field_key regex raises
 *  (e) re-upsert (rename) updates label/sort_order and bumps grove_memory.version
 *  (f) a grove_memory_history row is appended with change_source='manual'
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { RlsHarness } from './harness';

const dbAvailable = await RlsHarness.probe();
if (!dbAvailable && !process.env.CI) {
  console.warn('[rls] no database — skipping section-meta RPC suite');
}

const UID_MEMBER = 'a1a1a1a1-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const UID_OTHER  = 'c2c2c2c2-dddd-4ddd-8ddd-dddddddddddd';

describe.skipIf(!dbAvailable)('upsert_section_meta RPC', () => {
  const h = new RlsHarness();
  let acctId = '';

  const asMember = { kind: 'authenticated', uid: UID_MEMBER } as const;
  const asOther  = { kind: 'authenticated', uid: UID_OTHER  } as const;

  beforeAll(async () => {
    await h.reset();

    // Seed users
    await h.sql(
      `insert into auth.users (id, email) values ($1,'member@ex.test'),($2,'other@ex.test')`,
      [UID_MEMBER, UID_OTHER],
    );
    await h.as(asMember, async (c) => {
      await c.query(`insert into public.users (id, email) values ($1,$2)`, [UID_MEMBER, 'member@ex.test']);
    });
    await h.as(asOther, async (c) => {
      await c.query(`insert into public.users (id, email) values ($1,$2)`, [UID_OTHER, 'other@ex.test']);
    });

    // Member creates an account
    acctId = await h.as(asMember, async (c) =>
      (await c.query(`select public.create_account_with_owner('TestAccount') as id`)).rows[0].id,
    );

    // Ensure a grove_memory row exists for version-bump tests
    await h.sql(
      `insert into public.grove_memory (account_id) values ($1) on conflict do nothing`,
      [acctId],
    );
  });

  afterAll(async () => {
    await h.close();
  });

  it('(a) a member can upsert a custom section row', async () => {
    await h.as(asMember, async (c) => {
      await c.query(
        `select public.upsert_section_meta($1,$2,$3,$4,$5,$6)`,
        [acctId, 'c_portfolio', 'Portfolio', 100, true, false],
      );
    });

    const r = await h.sql(
      `select field_key, label, sort_order, is_custom, is_hidden
         from public.field_meta
        where account_id=$1 and field_key='c_portfolio'`,
      [acctId],
    );
    expect(r.rows).toHaveLength(1);
    expect(r.rows[0]).toMatchObject({
      field_key: 'c_portfolio',
      label: 'Portfolio',
      sort_order: 100,
      is_custom: true,
      is_hidden: false,
    });
  });

  it('(c) a non-member is rejected', async () => {
    await expect(
      h.as(asOther, async (c) =>
        c.query(`select public.upsert_section_meta($1,$2,$3,$4,$5,$6)`, [
          acctId, 'c_secret', 'Secret', 200, true, false,
        ]),
      ),
    ).rejects.toThrow(/not a member/i);
  });

  it('(d) invalid custom field_key regex raises', async () => {
    await expect(
      h.as(asMember, async (c) =>
        c.query(`select public.upsert_section_meta($1,$2,$3,$4,$5,$6)`, [
          acctId, 'BAD_KEY', 'Bad Key', 200, true, false,
        ]),
      ),
    ).rejects.toThrow(/invalid custom field key/i);
  });

  it('(d) key with spaces is also rejected', async () => {
    await expect(
      h.as(asMember, async (c) =>
        c.query(`select public.upsert_section_meta($1,$2,$3,$4,$5,$6)`, [
          acctId, 'c_bad key', 'Bad Key', 200, true, false,
        ]),
      ),
    ).rejects.toThrow(/invalid custom field key/i);
  });

  it('(e) re-upsert renames label and bumps grove_memory.version', async () => {
    // Read current version
    const vBefore = (await h.sql(
      `select version from public.grove_memory where account_id=$1`, [acctId],
    )).rows[0]?.version ?? 0;

    await h.as(asMember, async (c) => {
      await c.query(
        `select public.upsert_section_meta($1,$2,$3,$4,$5,$6)`,
        [acctId, 'c_portfolio', 'Portfolio Renamed', 50, true, false],
      );
    });

    const meta = await h.sql(
      `select label, sort_order from public.field_meta
        where account_id=$1 and field_key='c_portfolio'`,
      [acctId],
    );
    expect(meta.rows[0].label).toBe('Portfolio Renamed');
    expect(meta.rows[0].sort_order).toBe(50);

    const vAfter = (await h.sql(
      `select version from public.grove_memory where account_id=$1`, [acctId],
    )).rows[0]?.version ?? 0;
    expect(vAfter).toBe(vBefore + 1);
  });

  it('(f) a grove_memory_history row is appended with change_source=\'manual\'', async () => {
    const histBefore = (await h.sql(
      `select count(*)::int as n from public.grove_memory_history
        where account_id=$1 and field_key='c_portfolio'`,
      [acctId],
    )).rows[0].n;

    await h.as(asMember, async (c) => {
      await c.query(
        `select public.upsert_section_meta($1,$2,$3,$4,$5,$6)`,
        [acctId, 'c_portfolio', 'Portfolio v3', 75, true, false],
      );
    });

    const hist = await h.sql(
      `select change_source, new_value, changed_by
         from public.grove_memory_history
        where account_id=$1 and field_key='c_portfolio'
        order by changed_at desc limit 1`,
      [acctId],
    );
    expect(hist.rows).toHaveLength(1);
    expect(hist.rows[0].change_source).toBe('manual');
    expect(hist.rows[0].new_value).toBe('Portfolio v3');
    expect(hist.rows[0].changed_by).toBe(UID_MEMBER);

    const histAfter = (await h.sql(
      `select count(*)::int as n from public.grove_memory_history
        where account_id=$1 and field_key='c_portfolio'`,
      [acctId],
    )).rows[0].n;
    expect(histAfter).toBe(histBefore + 1);
  });

  it('(b) 40-section cap raises when exceeded', async () => {
    // First, remove any existing custom rows for this account to get a clean count
    // We need to seed 40 custom rows via the RPC (or bypass), then the 41st should fail.
    // Use a separate account to avoid interference with other tests.
    const UID_CAP = 'e5e5e5e5-ffff-4fff-8fff-ffffffffffff';
    await h.sql(
      `insert into auth.users (id, email) values ($1,'cap@ex.test') on conflict do nothing`,
      [UID_CAP],
    );
    const asCapUser = { kind: 'authenticated', uid: UID_CAP } as const;
    await h.as(asCapUser, async (c) => {
      await c.query(
        `insert into public.users (id, email) values ($1,$2) on conflict do nothing`,
        [UID_CAP, 'cap@ex.test'],
      );
    });
    const capAcctId = await h.as(asCapUser, async (c) =>
      (await c.query(`select public.create_account_with_owner('CapAccount') as id`)).rows[0].id,
    );

    // Seed 40 custom field_meta rows directly via superuser (bypassing RLS to avoid
    // calling the RPC 40 times, which would be slow)
    const insertRows = Array.from({ length: 40 }, (_, i) =>
      `('${capAcctId}', 'c_field${String(i).padStart(2, '0')}', null, 1000, true, false)`,
    ).join(',\n');
    await h.sql(
      `insert into public.field_meta (account_id, field_key, label, sort_order, is_custom, is_hidden)
       values ${insertRows}`,
    );

    // The 41st insert via the RPC should fail
    await expect(
      h.as(asCapUser, async (c) =>
        c.query(`select public.upsert_section_meta($1,$2,$3,$4,$5,$6)`, [
          capAcctId, 'c_overflow', 'Overflow', 9999, true, false,
        ]),
      ),
    ).rejects.toThrow(/section limit|too many sections/i);
  });

  it('(b) cap does NOT block updates to existing custom rows', async () => {
    // Re-upserting an existing row when already at 40 should succeed (not create a new row)
    const UID_CAP2 = 'f6f6f6f6-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
    await h.sql(
      `insert into auth.users (id, email) values ($1,'cap2@ex.test') on conflict do nothing`,
      [UID_CAP2],
    );
    const asCapUser2 = { kind: 'authenticated', uid: UID_CAP2 } as const;
    await h.as(asCapUser2, async (c) => {
      await c.query(
        `insert into public.users (id, email) values ($1,$2) on conflict do nothing`,
        [UID_CAP2, 'cap2@ex.test'],
      );
    });
    const capAcctId2 = await h.as(asCapUser2, async (c) =>
      (await c.query(`select public.create_account_with_owner('CapAccount2') as id`)).rows[0].id,
    );

    // Seed 40 custom rows
    const insertRows = Array.from({ length: 40 }, (_, i) =>
      `('${capAcctId2}', 'c_field${String(i).padStart(2, '0')}', null, 1000, true, false)`,
    ).join(',\n');
    await h.sql(
      `insert into public.field_meta (account_id, field_key, label, sort_order, is_custom, is_hidden)
       values ${insertRows}`,
    );

    // Re-upserting c_field00 (already exists) should NOT raise the cap error
    await h.sql(
      `insert into public.grove_memory (account_id) values ($1) on conflict do nothing`,
      [capAcctId2],
    );
    await expect(
      h.as(asCapUser2, async (c) =>
        c.query(`select public.upsert_section_meta($1,$2,$3,$4,$5,$6)`, [
          capAcctId2, 'c_field00', 'Renamed field00', 500, true, false,
        ]),
      ),
    ).resolves.toBeDefined();
  });
});
