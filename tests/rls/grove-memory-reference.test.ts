/**
 * RLS suite for the additive `reference_text` column on `grove_memory`
 * (migration 20260623120000_grove_memory_reference_text.sql — Task 1).
 *
 * Asserts:
 *  (a) grove_memory.reference_text exists, is text, and is nullable
 *  (b) a CHECK constraint rejects char_length > 8000
 *  (c) an authenticated member can read it under the existing RLS policy
 *  (d) anon cannot read grove_memory at all
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { RlsHarness } from './harness';

const dbAvailable = await RlsHarness.probe();
if (!dbAvailable && !process.env.CI) {
  console.warn('[rls] no database at RLS_DATABASE_URL / localhost:54329 — skipping grove-memory-reference suite');
}

const UID_A = 'aa000000-1111-4111-8111-111111111111';
const UID_B = 'bb000000-2222-4222-8222-222222222222';

describe.skipIf(!dbAvailable)('grove_memory.reference_text column (Task 1)', () => {
  const h = new RlsHarness();
  let accountA = '';
  let accountB = '';

  const asA = { kind: 'authenticated', uid: UID_A } as const;
  const asB = { kind: 'authenticated', uid: UID_B } as const;
  const anon = { kind: 'anon' } as const;
  const service = { kind: 'service_role' } as const;

  beforeAll(async () => {
    await h.reset();
    await h.sql(
      `insert into auth.users (id, email) values ($1, 'refa@example.test'), ($2, 'refb@example.test')`,
      [UID_A, UID_B],
    );
    for (const [who, uid] of [[asA, UID_A], [asB, UID_B]] as const) {
      await h.as(who, async (c) => {
        await c.query(`insert into public.users (id, email) values ($1, $2)`, [uid, `${uid}@example.test`]);
      });
    }
    accountA = await h.as(asA, async (c) =>
      (await c.query(`select public.create_account_with_owner('RefA Grove') as id`)).rows[0].id,
    );
    accountB = await h.as(asB, async (c) =>
      (await c.query(`select public.create_account_with_owner('RefB Grove') as id`)).rows[0].id,
    );
  });

  afterAll(async () => {
    await h.close();
  });

  // ── (a) column exists, is text, is nullable ──────────────────────────────────
  it('(a) reference_text column exists on grove_memory, is text type, and is nullable', async () => {
    const result = await h.sql(`
      select column_name, data_type, is_nullable
      from information_schema.columns
      where table_schema = 'public'
        and table_name   = 'grove_memory'
        and column_name  = 'reference_text'
    `);
    expect(result.rows).toHaveLength(1);
    const col = result.rows[0];
    expect(col.column_name).toBe('reference_text');
    expect(col.data_type).toBe('text');
    expect(col.is_nullable).toBe('YES');
  });

  // ── (b) CHECK constraint rejects char_length > 8000 ─────────────────────────
  it('(b) inserting reference_text with 8001 chars violates the CHECK constraint', async () => {
    const longText = 'x'.repeat(8001);
    // The save_grove_memory RPC does not touch reference_text yet (Task 2 adds save_reference),
    // so we write directly via the service role to exercise the table-level CHECK.
    await expect(
      h.as(service, async (c) =>
        c.query(
          `insert into public.grove_memory (account_id, sections, hard_rules, reference_text)
           values ($1, '{}'::jsonb, '[]'::jsonb, $2)`,
          [accountA, longText],
        ),
      ),
    ).rejects.toThrow(/check/i);
  });

  it('(b) inserting reference_text with exactly 8000 chars is accepted', async () => {
    const maxText = 'y'.repeat(8000);
    // accountA row does not yet exist; insert it.
    await h.as(service, async (c) =>
      c.query(
        `insert into public.grove_memory (account_id, sections, hard_rules, reference_text)
         values ($1, '{}'::jsonb, '[]'::jsonb, $2)`,
        [accountA, maxText],
      ),
    );
    const row = await h.sql(
      `select char_length(reference_text) as len from public.grove_memory where account_id = $1`,
      [accountA],
    );
    expect(row.rows[0].len).toBe(8000);
  });

  it('(b) null is accepted (column is nullable)', async () => {
    // accountB has no row yet; insert with null reference_text
    await h.as(service, async (c) =>
      c.query(
        `insert into public.grove_memory (account_id, sections, hard_rules, reference_text)
         values ($1, '{}'::jsonb, '[]'::jsonb, null)`,
        [accountB],
      ),
    );
    const row = await h.sql(
      `select reference_text from public.grove_memory where account_id = $1`,
      [accountB],
    );
    expect(row.rows[0].reference_text).toBeNull();
  });

  // ── (c) authenticated member can read reference_text ────────────────────────
  it('(c) an authenticated member reads reference_text for their own account', async () => {
    const rows = await h.as(asA, async (c) =>
      (await c.query(`select reference_text from public.grove_memory where account_id = $1`, [accountA])).rows,
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].reference_text).toBe('y'.repeat(8000));
  });

  it('(c) member A cannot read member B\'s reference_text via account_id filter', async () => {
    const rows = await h.as(asA, async (c) =>
      (await c.query(`select reference_text from public.grove_memory where account_id = $1`, [accountB])).rows,
    );
    // RLS policy: grove_memory_member_read filters by is_account_member(account_id);
    // A is not a member of B's account, so zero rows are returned.
    expect(rows).toHaveLength(0);
  });

  // ── (d) anon cannot read grove_memory ────────────────────────────────────────
  it('(d) anon cannot select from grove_memory (revoked)', async () => {
    await expect(
      h.as(anon, async (c) => c.query(`select reference_text from public.grove_memory`)),
    ).rejects.toThrow();
  });
});
