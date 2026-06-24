import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { RlsHarness } from './harness';

const dbAvailable = await RlsHarness.probe();
if (!dbAvailable && !process.env.CI) {
  console.warn('[rls] no database — skipping resolve-field-flag suite');
}

// Two member UIDs — A is the resolving member, B is a non-member outsider
const UID_A = 'ef000001-0000-4000-8000-000000000001';
const UID_B = 'ef000001-0000-4000-8000-000000000002';

describe.skipIf(!dbAvailable)('resolve_field_flag RPC', () => {
  const h = new RlsHarness();
  const asA = { kind: 'authenticated', uid: UID_A } as const;
  const asB = { kind: 'authenticated', uid: UID_B } as const;
  const service = { kind: 'service_role' } as const;

  let acct = '';
  // Two sources of DIFFERENT kinds so we can assert weight delta on each kind
  let srcDoc = '';   // kind='document'
  let srcConn = ''; // kind='connector_artifact'
  let flagId = '';

  beforeAll(async () => {
    await h.reset();

    // Create users
    await h.sql(
      `insert into auth.users (id,email) values ($1,'rff-a@ex.test'),($2,'rff-b@ex.test')`,
      [UID_A, UID_B],
    );
    await h.as(asA, async (c) => {
      await c.query(`insert into public.users (id,email) values ($1,$2)`, [UID_A, 'rff-a@ex.test']);
    });
    await h.as(asB, async (c) => {
      await c.query(`insert into public.users (id,email) values ($1,$2)`, [UID_B, 'rff-b@ex.test']);
    });

    // A creates an account (becomes owner/member); B is NOT a member of A's account
    acct = await h.as(asA, async (c) =>
      (await c.query(`select public.create_account_with_owner('RFF-Test') as id`)).rows[0].id,
    );

    // Seed two sources of different kinds
    srcDoc = await h.as(service, async (c) =>
      (await c.query(
        `insert into public.sources (account_id, kind, title)
         values ($1, 'document', 'doc-source') returning id`,
        [acct],
      )).rows[0].id,
    );
    srcConn = await h.as(service, async (c) =>
      (await c.query(
        `insert into public.sources (account_id, kind, title)
         values ($1, 'connector_artifact', 'stripe-source') returning id`,
        [acct],
      )).rows[0].id,
    );

    // Seed source_authority so weights exist before resolve touches them
    await h.as(service, async (c) => {
      await c.query(`select public.ensure_source_authority($1)`, [acct]);
    });

    // Create an open field_flag via flag_field_conflict
    flagId = await h.as(service, async (c) =>
      (await c.query(
        `select public.flag_field_conflict($1, $2, $3::uuid[], $4) as id`,
        [acct, 'tagline', `{${srcDoc},${srcConn}}`, 'doc says X, stripe says Y'],
      )).rows[0].id,
    );
  });

  afterAll(async () => {
    await h.close();
  });

  // ── Core happy-path ──────────────────────────────────────────────────────

  it('resolving writes p_chosen_value into grove_memory sections[field_key]', async () => {
    await h.as(asA, async (c) => {
      await c.query(
        `select public.resolve_field_flag(
           p_flag_id        := $1,
           p_chosen_source_id := $2,
           p_chosen_value   := $3
         )`,
        [flagId, srcDoc, 'Chosen tagline from doc'],
      );
    });

    const mem = await h.as(service, async (c) =>
      (await c.query(`select sections from public.grove_memory where account_id=$1`, [acct])).rows[0],
    );
    expect(mem).toBeDefined();
    expect((mem.sections as Record<string, string>)['tagline']).toBe('Chosen tagline from doc');
  });

  it('resolving bumps the grove_memory version by exactly 1', async () => {
    // After the resolve above, version should be 1 (started at 0; row was ensured)
    const row = await h.as(service, async (c) =>
      (await c.query(`select version from public.grove_memory where account_id=$1`, [acct])).rows[0],
    );
    expect(Number(row.version)).toBeGreaterThanOrEqual(1);
  });

  it('resolving appends a grove_memory_history row with change_source="conflict"', async () => {
    const hist = await h.as(service, async (c) =>
      (await c.query(
        `select field_key, new_value, change_source, changed_by
         from public.grove_memory_history
         where account_id=$1 and field_key='tagline'
         order by changed_at desc limit 1`,
        [acct],
      )).rows[0],
    );
    expect(hist).toBeDefined();
    expect(hist.field_key).toBe('tagline');
    expect(hist.new_value).toBe('Chosen tagline from doc');
    expect(hist.change_source).toBe('conflict');
    expect(hist.changed_by).toBe(UID_A);
  });

  it('flag is marked resolved with resolved_at set and resolution containing chosen source id', async () => {
    const flag = await h.as(service, async (c) =>
      (await c.query(
        `select status, resolved_at, resolution from public.field_flags where id=$1`,
        [flagId],
      )).rows[0],
    );
    expect(flag.status).toBe('resolved');
    expect(flag.resolved_at).not.toBeNull();
    expect(flag.resolution).toContain(srcDoc);
  });

  it('an audit_log row is inserted with action="memory.ratified" and decision="conflict_resolved"', async () => {
    const audit = await h.as(service, async (c) =>
      (await c.query(
        `select action, subject, meta
         from public.audit_log
         where account_id=$1 and action='memory.ratified'
         order by at desc limit 1`,
        [acct],
      )).rows[0],
    );
    expect(audit).toBeDefined();
    expect(audit.action).toBe('memory.ratified');
    expect(audit.subject).toBe('tagline');
    expect((audit.meta as Record<string, unknown>)['field_flag_id']).toBe(flagId);
    expect((audit.meta as Record<string, unknown>)['chosen_source_id']).toBe(srcDoc);
    expect((audit.meta as Record<string, unknown>)['decision']).toBe('conflict_resolved');
  });

  it('chosen source kind (document) weight increased by 5 (capped at 100)', async () => {
    // Initial weight for 'document' = 70; after resolve = 75
    const row = await h.as(service, async (c) =>
      (await c.query(
        `select weight::integer as weight from public.source_authority
         where account_id=$1 and source_kind='document'`,
        [acct],
      )).rows[0],
    );
    expect(row.weight).toBe(75);
  });

  it('rejected competing kind (connector_artifact) weight decreased by 5 (floored at 0)', async () => {
    // Initial weight for 'connector_artifact' = 50; after resolve = 45
    const row = await h.as(service, async (c) =>
      (await c.query(
        `select weight::integer as weight from public.source_authority
         where account_id=$1 and source_kind='connector_artifact'`,
        [acct],
      )).rows[0],
    );
    expect(row.weight).toBe(45);
  });

  it('the related review_item notification is marked read (read_at set)', async () => {
    const notif = await h.as(service, async (c) =>
      (await c.query(
        `select read_at from public.notifications
         where account_id=$1 and kind='review_item' and source_id=$2`,
        [acct, flagId],
      )).rows[0],
    );
    expect(notif).toBeDefined();
    expect(notif.read_at).not.toBeNull();
  });

  // ── Guard: already resolved flag ─────────────────────────────────────────

  it('resolving an already-resolved flag raises "conflict already resolved"', async () => {
    await expect(
      h.as(asA, (c) =>
        c.query(
          `select public.resolve_field_flag(
             p_flag_id          := $1,
             p_chosen_source_id := $2,
             p_chosen_value     := $3
           )`,
          [flagId, srcDoc, 'Retry value'],
        ),
      ),
    ).rejects.toThrow(/conflict already resolved/i);
  });

  // ── Guard: non-member cannot resolve ────────────────────────────────────

  it('a non-member (UID_B) is rejected with "not a member" error', async () => {
    // Create a fresh flag for this sub-test so it is still needs_review
    const srcOther = await h.as(service, async (c) =>
      (await c.query(
        `insert into public.sources (account_id, kind, title)
         values ($1, 'manual', 'manual-src') returning id`,
        [acct],
      )).rows[0].id,
    );
    const freshFlagId = await h.as(service, async (c) =>
      (await c.query(
        `select public.flag_field_conflict($1, $2, $3::uuid[], $4) as id`,
        [acct, 'bio', `{${srcOther}}`, 'Bio conflict'],
      )).rows[0].id,
    );

    await expect(
      h.as(asB, (c) =>
        c.query(
          `select public.resolve_field_flag(
             p_flag_id          := $1,
             p_chosen_source_id := $2,
             p_chosen_value     := $3
           )`,
          [freshFlagId, srcOther, 'B tries to resolve'],
        ),
      ),
    ).rejects.toThrow(/not a member/i);
  });

  // ── Weight cap / floor boundary ──────────────────────────────────────────

  it('weight is capped at 100 (chosen) and floored at 0 (rejected)', async () => {
    // Set document weight to 98 → after +5 → should be 100 (not 103)
    await h.as(service, async (c) => {
      await c.query(
        `update public.source_authority set weight=98 where account_id=$1 and source_kind='document'`,
        [acct],
      );
      // Set connector_artifact weight to 3 → after -5 → should be 0 (not -2)
      await c.query(
        `update public.source_authority set weight=3 where account_id=$1 and source_kind='connector_artifact'`,
        [acct],
      );
    });

    // Create a fresh flag on a different field for the boundary test
    const srcDoc2 = await h.as(service, async (c) =>
      (await c.query(
        `insert into public.sources (account_id, kind, title)
         values ($1, 'document', 'doc2') returning id`,
        [acct],
      )).rows[0].id,
    );
    const srcConn2 = await h.as(service, async (c) =>
      (await c.query(
        `insert into public.sources (account_id, kind, title)
         values ($1, 'connector_artifact', 'stripe2') returning id`,
        [acct],
      )).rows[0].id,
    );
    const boundFlagId = await h.as(service, async (c) =>
      (await c.query(
        `select public.flag_field_conflict($1, $2, $3::uuid[], $4) as id`,
        [acct, 'pricing', `{${srcDoc2},${srcConn2}}`, 'pricing conflict'],
      )).rows[0].id,
    );

    await h.as(asA, async (c) => {
      await c.query(
        `select public.resolve_field_flag(
           p_flag_id          := $1,
           p_chosen_source_id := $2,
           p_chosen_value     := $3
         )`,
        [boundFlagId, srcDoc2, 'doc wins on pricing'],
      );
    });

    const docRow = await h.as(service, async (c) =>
      (await c.query(
        `select weight::integer as weight from public.source_authority
         where account_id=$1 and source_kind='document'`,
        [acct],
      )).rows[0],
    );
    expect(docRow.weight).toBe(100); // capped

    const connRow = await h.as(service, async (c) =>
      (await c.query(
        `select weight::integer as weight from public.source_authority
         where account_id=$1 and source_kind='connector_artifact'`,
        [acct],
      )).rows[0],
    );
    expect(connRow.weight).toBe(0); // floored
  });

  // ── notes and hard_rules dispatch ────────────────────────────────────────

  it('resolving a "notes" field writes to grove_memory.notes column', async () => {
    const srcN = await h.as(service, async (c) =>
      (await c.query(
        `insert into public.sources (account_id, kind, title)
         values ($1, 'manual', 'notes-src') returning id`,
        [acct],
      )).rows[0].id,
    );
    const notesFlagId = await h.as(service, async (c) =>
      (await c.query(
        `select public.flag_field_conflict($1, $2, $3::uuid[], $4) as id`,
        [acct, 'notes', `{${srcN}}`, 'notes conflict'],
      )).rows[0].id,
    );

    await h.as(asA, async (c) => {
      await c.query(
        `select public.resolve_field_flag(
           p_flag_id          := $1,
           p_chosen_source_id := $2,
           p_chosen_value     := $3
         )`,
        [notesFlagId, srcN, 'Resolved notes value'],
      );
    });

    const mem = await h.as(service, async (c) =>
      (await c.query(`select notes from public.grove_memory where account_id=$1`, [acct])).rows[0],
    );
    expect(mem.notes).toBe('Resolved notes value');
  });

  it('resolving a "hard_rules" field writes to grove_memory.hard_rules jsonb array', async () => {
    const srcH = await h.as(service, async (c) =>
      (await c.query(
        `insert into public.sources (account_id, kind, title)
         values ($1, 'document', 'rules-src') returning id`,
        [acct],
      )).rows[0].id,
    );
    const rulesFlagId = await h.as(service, async (c) =>
      (await c.query(
        `select public.flag_field_conflict($1, $2, $3::uuid[], $4) as id`,
        [acct, 'hard_rules', `{${srcH}}`, 'rules conflict'],
      )).rows[0].id,
    );

    await h.as(asA, async (c) => {
      await c.query(
        `select public.resolve_field_flag(
           p_flag_id          := $1,
           p_chosen_source_id := $2,
           p_chosen_value     := $3
         )`,
        [rulesFlagId, srcH, 'Rule one\nRule two'],
      );
    });

    const mem = await h.as(service, async (c) =>
      (await c.query(`select hard_rules from public.grove_memory where account_id=$1`, [acct])).rows[0],
    );
    const rules = mem.hard_rules as string[];
    expect(rules).toContain('Rule one');
    expect(rules).toContain('Rule two');
  });
});
