/**
 * RLS tests for delete_custom_section RPC (Task 3 of memory extensible P1).
 *
 * Covers:
 *  (a) member deletes a custom section: its field_meta row is gone AND
 *      its sections key is removed from grove_memory
 *  (b) attempting to delete a DEFAULT key (not matching ^c_[a-z0-9_]{1,40}$)
 *      raises 'not a custom section'
 *  (c) non-member is rejected
 *  (d) grove_memory.version bumped + grove_memory_history row appended
 *      with change_source='manual'
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { RlsHarness } from './harness';

const dbAvailable = await RlsHarness.probe();
if (!dbAvailable && !process.env.CI) {
  console.warn('[rls] no database — skipping section-meta-delete RPC suite');
}

const UID_MEMBER = 'b2b2b2b2-cccc-4ccc-8ccc-cccccccccccc';
const UID_OTHER  = 'd3d3d3d3-eeee-4eee-8eee-eeeeeeeeeeee';

describe.skipIf(!dbAvailable)('delete_custom_section RPC', () => {
  const h = new RlsHarness();
  let acctId = '';

  const asMember = { kind: 'authenticated', uid: UID_MEMBER } as const;
  const asOther  = { kind: 'authenticated', uid: UID_OTHER  } as const;

  beforeAll(async () => {
    await h.reset();

    // Seed users
    await h.sql(
      `insert into auth.users (id, email) values ($1,'delmember@ex.test'),($2,'delother@ex.test')`,
      [UID_MEMBER, UID_OTHER],
    );
    await h.as(asMember, async (c) => {
      await c.query(`insert into public.users (id, email) values ($1,$2)`, [UID_MEMBER, 'delmember@ex.test']);
    });
    await h.as(asOther, async (c) => {
      await c.query(`insert into public.users (id, email) values ($1,$2)`, [UID_OTHER, 'delother@ex.test']);
    });

    // Member creates an account
    acctId = await h.as(asMember, async (c) =>
      (await c.query(`select public.create_account_with_owner('DelTestAccount') as id`)).rows[0].id,
    );

    // Ensure a grove_memory row exists with a section value so we can verify deletion
    await h.sql(
      `insert into public.grove_memory (account_id, sections)
       values ($1, '{"c_brand": "My brand guidelines", "c_team": "Team info"}'::jsonb)
       on conflict (account_id) do update set sections = excluded.sections`,
      [acctId],
    );

    // Seed a custom field_meta row for c_brand
    await h.sql(
      `insert into public.field_meta (account_id, field_key, label, sort_order, is_custom, is_hidden)
       values ($1, 'c_brand', 'Brand', 100, true, false)
       on conflict (account_id, field_key) do nothing`,
      [acctId],
    );
  });

  afterAll(async () => {
    await h.close();
  });

  it('(c) non-member is rejected', async () => {
    await expect(
      h.as(asOther, async (c) =>
        c.query(`select public.delete_custom_section($1,$2)`, [acctId, 'c_brand']),
      ),
    ).rejects.toThrow(/not a member/i);
  });

  it('(b) deleting a default key raises "not a custom section"', async () => {
    // 'voice' does not match ^c_[a-z0-9_]{1,40}$
    await expect(
      h.as(asMember, async (c) =>
        c.query(`select public.delete_custom_section($1,$2)`, [acctId, 'voice']),
      ),
    ).rejects.toThrow(/not a custom section/i);
  });

  it('(b) bare key without c_ prefix is also rejected', async () => {
    await expect(
      h.as(asMember, async (c) =>
        c.query(`select public.delete_custom_section($1,$2)`, [acctId, 'pricing']),
      ),
    ).rejects.toThrow(/not a custom section/i);
  });

  it('(d) grove_memory.version is bumped and history row appended on delete', async () => {
    // Seed a separate custom field_meta + sections entry for this test
    await h.sql(
      `insert into public.field_meta (account_id, field_key, label, sort_order, is_custom, is_hidden)
       values ($1, 'c_team', 'Team', 200, true, false)
       on conflict (account_id, field_key) do nothing`,
      [acctId],
    );

    const vBefore = (await h.sql(
      `select version from public.grove_memory where account_id=$1`, [acctId],
    )).rows[0]?.version ?? 0;

    const histBefore = (await h.sql(
      `select count(*)::int as n from public.grove_memory_history
        where account_id=$1 and field_key='c_team'`,
      [acctId],
    )).rows[0].n;

    await h.as(asMember, async (c) => {
      await c.query(`select public.delete_custom_section($1,$2)`, [acctId, 'c_team']);
    });

    const vAfter = (await h.sql(
      `select version from public.grove_memory where account_id=$1`, [acctId],
    )).rows[0]?.version ?? 0;
    expect(vAfter).toBe(vBefore + 1);

    const hist = (await h.sql(
      `select change_source, changed_by
         from public.grove_memory_history
        where account_id=$1 and field_key='c_team'
        order by changed_at desc limit 1`,
      [acctId],
    )).rows;
    expect(hist).toHaveLength(1);
    expect(hist[0].change_source).toBe('manual');
    expect(hist[0].changed_by).toBe(UID_MEMBER);

    const histAfter = (await h.sql(
      `select count(*)::int as n from public.grove_memory_history
        where account_id=$1 and field_key='c_team'`,
      [acctId],
    )).rows[0].n;
    expect(histAfter).toBe(histBefore + 1);
  });

  it('(a) member deletes a custom section: field_meta row gone + sections key removed', async () => {
    // Verify c_brand is in field_meta and grove_memory.sections before deletion
    const metaBefore = (await h.sql(
      `select field_key from public.field_meta
        where account_id=$1 and field_key='c_brand'`,
      [acctId],
    )).rows;
    expect(metaBefore).toHaveLength(1);

    const sectionsBefore = (await h.sql(
      `select sections->>'c_brand' as val from public.grove_memory where account_id=$1`,
      [acctId],
    )).rows[0].val;
    expect(sectionsBefore).toBe('My brand guidelines');

    await h.as(asMember, async (c) => {
      await c.query(`select public.delete_custom_section($1,$2)`, [acctId, 'c_brand']);
    });

    // field_meta row must be gone
    const metaAfter = (await h.sql(
      `select field_key from public.field_meta
        where account_id=$1 and field_key='c_brand'`,
      [acctId],
    )).rows;
    expect(metaAfter).toHaveLength(0);

    // sections key must be removed from grove_memory
    const sectionsAfter = (await h.sql(
      `select sections from public.grove_memory where account_id=$1`,
      [acctId],
    )).rows[0].sections;
    expect(sectionsAfter).not.toHaveProperty('c_brand');
  });
});
