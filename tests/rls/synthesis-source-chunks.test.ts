/**
 * RLS + RPC attack suite for source_chunks + match_sources (P5 T2).
 * Mirrors the pattern of memory.test.ts and company-brain-foundation.test.ts.
 *
 * Covers:
 *  (a) member-read: account-scoped; cross-account returns 0 rows
 *  (b) anon cannot select
 *  (c) authenticated cannot insert/update/delete
 *  (d) match_sources as authenticated or anon throws permission denied
 *  (e) match_sources as service_role returns rows on FTS match (p_embedding=null path)
 *  (f) match_sources returns empty set when min_score too high
 *  (g) match_sources respects p_min_score threshold
 *  (h) every new table in this migration has RLS enabled
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { RlsHarness } from './harness';

const dbAvailable = await RlsHarness.probe();
if (!dbAvailable && !process.env.CI) {
  console.warn('[rls] no database — skipping synthesis-source-chunks suite');
}

const UID_A = 'a1a1a1a1-c501-4c50-8c50-c501c501c501';
const UID_B = 'b2b2b2b2-c501-4c50-8c50-c501c501c502';

describe.skipIf(!dbAvailable)('source_chunks RLS + match_sources RPC', () => {
  const h = new RlsHarness();
  let accountA = '';
  let accountB = '';
  let sourceIdA = '';
  let chunkIdA = '';

  const asA = { kind: 'authenticated', uid: UID_A } as const;
  const asB = { kind: 'authenticated', uid: UID_B } as const;
  const anon = { kind: 'anon' } as const;
  const service = { kind: 'service_role' } as const;

  beforeAll(async () => {
    await h.reset();

    // Create two users
    await h.sql(
      `insert into auth.users (id, email) values ($1,'sc_a@ex.test'),($2,'sc_b@ex.test')`,
      [UID_A, UID_B],
    );
    for (const [who, uid] of [[asA, UID_A], [asB, UID_B]] as const) {
      await h.as(who, async (c) => {
        await c.query(`insert into public.users (id, email) values ($1,$2)`, [uid, `${uid}@ex.test`]);
      });
    }

    // Create accounts
    accountA = await h.as(asA, async (c) =>
      (await c.query(`select public.create_account_with_owner('A Corp') as id`)).rows[0].id,
    );
    accountB = await h.as(asB, async (c) =>
      (await c.query(`select public.create_account_with_owner('B Corp') as id`)).rows[0].id,
    );

    // Seed: insert a source + two chunks for account A via service_role.
    // No embedding — exercises the FTS-only path (no VOYAGE_API_KEY needed in CI).
    await h.as(service, async (c) => {
      sourceIdA = (
        await c.query(
          `insert into public.sources (account_id, kind, title)
           values ($1, 'document', 'A Rate Sheet') returning id`,
          [accountA],
        )
      ).rows[0].id;

      chunkIdA = (
        await c.query(
          `insert into public.source_chunks (account_id, source_id, chunk_index, text, token_count)
           values ($1, $2, 0, 'Standard hourly rate is $200 per hour for all projects.', 40) returning id`,
          [accountA, sourceIdA],
        )
      ).rows[0].id;

      // Second chunk — different content for threshold tests
      await c.query(
        `insert into public.source_chunks (account_id, source_id, chunk_index, text, token_count)
         values ($1, $2, 1, 'Cancellation policy requires 48 hours advance notice.', 35)`,
        [accountA, sourceIdA],
      );
    });
  });

  afterAll(async () => {
    await h.close();
  });

  // ── (a) member-read isolation ──────────────────────────────────────────────

  it('a member reads only their own account chunks; cross-account returns 0 rows', async () => {
    // A sees their 2 chunks
    const aRows = await h.as(asA, async (c) =>
      (await c.query(`select id from public.source_chunks where account_id = $1`, [accountA])).rows,
    );
    expect(aRows).toHaveLength(2);

    // B cannot see A's chunks
    const bSeesA = await h.as(asB, async (c) =>
      (await c.query(`select id from public.source_chunks where account_id = $1`, [accountA])).rowCount,
    );
    expect(bSeesA).toBe(0);

    // B sees nothing even without a filter (RLS blocks cross-account)
    const bAll = await h.as(asB, async (c) =>
      (await c.query(`select id from public.source_chunks`)).rowCount,
    );
    expect(bAll).toBe(0);
  });

  // ── (b) anon cannot select ─────────────────────────────────────────────────

  it('anon cannot select from source_chunks', async () => {
    await expect(
      h.as(anon, (c) => c.query(`select * from public.source_chunks`)),
    ).rejects.toThrow();
  });

  // ── (c) authenticated cannot insert/update/delete ──────────────────────────

  it('authenticated cannot insert/update/delete source_chunks directly', async () => {
    // INSERT
    await expect(
      h.as(asA, (c) =>
        c.query(
          `insert into public.source_chunks (account_id, source_id, chunk_index, text, token_count)
           values ($1, $2, 99, 'forged chunk', 10)`,
          [accountA, sourceIdA],
        ),
      ),
    ).rejects.toThrow(/permission denied|row-level security/i);

    // UPDATE
    await expect(
      h.as(asA, (c) =>
        c.query(`update public.source_chunks set text = 'tampered' where id = $1`, [chunkIdA]),
      ),
    ).rejects.toThrow(/permission denied|row-level security/i);

    // DELETE
    await expect(
      h.as(asA, (c) =>
        c.query(`delete from public.source_chunks where id = $1`, [chunkIdA]),
      ),
    ).rejects.toThrow(/permission denied|row-level security/i);
  });

  // ── (d) match_sources permission gating ────────────────────────────────────

  it('match_sources as authenticated throws permission denied', async () => {
    await expect(
      h.as(asA, (c) =>
        c.query(`select * from public.match_sources($1, null, 'hourly rate', 6, 0.0)`, [accountA]),
      ),
    ).rejects.toThrow(/permission denied/i);
  });

  it('match_sources as anon throws permission denied', async () => {
    await expect(
      h.as(anon, (c) =>
        c.query(`select * from public.match_sources($1, null, 'hourly rate', 6, 0.0)`, [accountA]),
      ),
    ).rejects.toThrow();
  });

  // ── (e) match_sources FTS path ─────────────────────────────────────────────

  it('match_sources as service_role returns rows when FTS matches (p_embedding=null path)', async () => {
    const rows = await h.as(service, async (c) =>
      (
        await c.query(
          `select chunk_id, source_title, text, score
           from public.match_sources($1, null, 'hourly rate', 6, 0.0)`,
          [accountA],
        )
      ).rows,
    );

    // At least one of our chunks should surface; the FTS + recency + tier scoring
    // should return > 0 rows with no min_score filter
    expect(rows.length).toBeGreaterThan(0);
    // Every returned row belongs to account A's source
    expect(rows.every((r) => r.source_title === 'A Rate Sheet')).toBe(true);
    // Scores are non-negative
    expect(rows.every((r) => Number(r.score) >= 0)).toBe(true);
  });

  // ── (f) match_sources returns empty when min_score is high ─────────────────

  it('match_sources as service_role returns empty set when no match and min_score is high', async () => {
    // A query that matches nothing + extremely high min_score
    const rows = await h.as(service, async (c) =>
      (
        await c.query(
          `select chunk_id from public.match_sources($1, null, 'xyzzy frobnicator quux', 6, 0.99)`,
          [accountA],
        )
      ).rows,
    );
    expect(rows).toHaveLength(0);
  });

  // ── (g) match_sources respects p_min_score threshold ──────────────────────

  it('match_sources respects p_min_score threshold', async () => {
    // With min_score=0.0 we should get rows (recency + tier bonus alone yield > 0)
    const rowsLow = await h.as(service, async (c) =>
      (
        await c.query(
          `select chunk_id, score from public.match_sources($1, null, '', 6, 0.0)`,
          [accountA],
        )
      ).rows,
    );
    expect(rowsLow.length).toBeGreaterThan(0);

    // With min_score = 1.0 (impossible without vector) we should get 0 rows
    const rowsHigh = await h.as(service, async (c) =>
      (
        await c.query(
          `select chunk_id from public.match_sources($1, null, '', 6, 1.0)`,
          [accountA],
        )
      ).rows,
    );
    expect(rowsHigh).toHaveLength(0);
  });

  // ── (h) RLS enabled on all new tables ─────────────────────────────────────

  it('every new table in this migration has RLS enabled', async () => {
    const r = await h.sql(
      `select c.relname
       from pg_class c join pg_namespace n on n.oid = c.relnamespace
       where n.nspname = 'public' and c.relkind = 'r' and not c.relrowsecurity
         and c.relname in ('source_chunks')`,
    );
    expect(r.rows).toEqual([]);
  });
});
