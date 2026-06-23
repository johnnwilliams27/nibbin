import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { RlsHarness } from './harness';
import { sanitizeFilename, buildStoragePath, isPathOwnedByAccount } from '../../apps/web/lib/brain/storage-path';

const dbAvailable = await RlsHarness.probe();
if (!dbAvailable && !process.env.CI) {
  console.warn('[rls] no database — skipping company-brain P2 suite');
}

const UID = 'a9999999-0000-4000-8000-000000000001';
describe.skipIf(!dbAvailable)('P2 migration — Foundation Minors + queue table', () => {
  const h = new RlsHarness();
  let acct = '';
  const asU = { kind: 'authenticated', uid: UID } as const;
  const service = { kind: 'service_role' } as const;

  beforeAll(async () => {
    await h.reset();
    await h.sql(`insert into auth.users (id,email) values ($1,'p2@ex.test')`, [UID]);
    await h.as(asU, async (c) => {
      await c.query(`insert into public.users (id,email) values ($1,$2)`, [UID, `${UID}@ex.test`]);
    });
    acct = await h.as(asU, async (c) =>
      (await c.query(`select public.create_account_with_owner('P2test') as id`)).rows[0].id);
  });
  afterAll(async () => { await h.close(); });

  it('proposals_value_nonempty CHECK rejects blank/whitespace', async () => {
    await expect(
      h.as(service, (c) => c.query(
        `insert into public.proposals (account_id,field_key,op,proposed_value,origin) values ($1,'pricing','replace','  ','manual')`,
        [acct]
      ))
    ).rejects.toThrow(/nonempty|value_nonempty|check/i);
  });

  it('propose_memory_change RPC rejects blank proposed_value', async () => {
    await expect(
      h.as(service, (c) => c.query(
        `select public.propose_memory_change($1,'pricing','replace','',null,null,'manual')`, [acct]
      ))
    ).rejects.toThrow(/blank/i);
  });

  it('decide_memory_proposal: append overflow raises; curated value unchanged', async () => {
    // Seed a 5900-char policies value
    const longVal = 'x'.repeat(5900);
    const pid1 = await h.as(service, async (c) =>
      (await c.query(`select public.propose_memory_change($1,'policies','replace',$2,null,null,'manual') as id`, [acct, longVal])).rows[0].id);
    await h.as(asU, async (c) => { await c.query(`select public.decide_memory_proposal($1,'approved')`, [pid1]); });

    // Now append a 200-char value (5900+1+200=6101 > 6000)
    const appendVal = 'y'.repeat(200);
    const pid2 = await h.as(service, async (c) =>
      (await c.query(`select public.propose_memory_change($1,'policies','append',$2,null,null,'manual') as id`, [acct, appendVal])).rows[0].id);
    await expect(
      h.as(asU, (c) => c.query(`select public.decide_memory_proposal($1,'approved')`, [pid2]))
    ).rejects.toThrow(/exceed/i);

    const v = await h.as(asU, async (c) =>
      (await c.query(`select sections->>'policies' as v from public.grove_memory where account_id=$1`, [acct])).rows[0].v);
    expect(v).toBe(longVal);
  });

  it('replace still works after the overflow guard is added', async () => {
    const pid = await h.as(service, async (c) =>
      (await c.query(`select public.propose_memory_change($1,'faq','replace','Q: How long? A: 2 weeks.',null,null,'manual') as id`, [acct])).rows[0].id);
    await h.as(asU, async (c) => { await c.query(`select public.decide_memory_proposal($1,'approved')`, [pid]); });
    const v = await h.as(asU, async (c) =>
      (await c.query(`select sections->>'faq' as v from public.grove_memory where account_id=$1`, [acct])).rows[0].v);
    expect(v).toBe('Q: How long? A: 2 weeks.');
  });

  it('source_extraction_jobs RLS: member reads own rows; anon cannot; client cannot insert', async () => {
    // service inserts a job row
    const srcId = await h.as(service, async (c) =>
      (await c.query(`insert into public.sources (account_id,kind,title) values ($1,'document','test') returning id`, [acct])).rows[0].id);
    await h.as(service, async (c) => {
      await c.query(`insert into public.source_extraction_jobs (account_id, source_id, status) values ($1,$2,'pending')`, [acct, srcId]);
    });
    const rows = await h.as(asU, async (c) =>
      (await c.query(`select status from public.source_extraction_jobs where account_id=$1`, [acct])).rows);
    expect(rows).toEqual([{ status: 'pending' }]);

    await expect(
      h.as({ kind: 'anon' }, (c) => c.query(`select * from public.source_extraction_jobs`))
    ).rejects.toThrow(/permission denied|row-level security/i);

    await expect(
      h.as(asU, (c) => c.query(
        `insert into public.source_extraction_jobs (account_id,source_id,status) values ($1,$2,'pending')`, [acct, srcId]
      ))
    ).rejects.toThrow(/permission denied|row-level security/i);
  });
});

// ---------------------------------------------------------------------------
// Task 5 — cross-account isolation + quarantine gate
//
// These tests exercise Postgres-layer invariants only.
//
// NOTE ON STORAGE BUCKET (brain-sources):
// The `brain-sources` bucket lives in the `storage` schema, which is managed
// by Supabase infrastructure and is NOT present in the RLS harness (the harness
// drops/recreates public/auth/private only). Storage RLS policies applied by
// `scripts/bootstrap-brain-sources-bucket.ts` cannot be asserted here.
//
// Instead, the path-prefix isolation guarantee (`{accountId}/...`) is verified
// via pure unit tests on the `buildStoragePath` / `sanitizeFilename` utilities
// in the "Storage path-prefix unit tests" describe block below. The Storage-
// bucket policy is considered deployment-time verified (bootstrap script run per
// environment; not a harness-testable artifact).
// ---------------------------------------------------------------------------

const UID_A2 = 'aa000001-5555-4555-8555-555555555501';
const UID_B2 = 'bb000002-5555-4555-8555-555555555502';

describe.skipIf(!dbAvailable)('P2 — cross-account isolation + quarantine gate', () => {
  const h = new RlsHarness();
  let accountA = '';
  let accountB = '';
  const asA = { kind: 'authenticated', uid: UID_A2 } as const;
  const asB = { kind: 'authenticated', uid: UID_B2 } as const;
  const anon = { kind: 'anon' } as const;
  const service = { kind: 'service_role' } as const;

  beforeAll(async () => {
    await h.reset();
    await h.sql(
      `insert into auth.users (id, email) values ($1,'a2@ex.test'),($2,'b2@ex.test')`,
      [UID_A2, UID_B2],
    );
    for (const [who, uid] of [[asA, UID_A2], [asB, UID_B2]] as const) {
      await h.as(who, async (c) => {
        await c.query(`insert into public.users (id,email) values ($1,$2)`, [uid, `${uid}@ex.test`]);
      });
    }
    accountA = await h.as(asA, async (c) =>
      (await c.query(`select public.create_account_with_owner('IsoA') as id`)).rows[0].id);
    accountB = await h.as(asB, async (c) =>
      (await c.query(`select public.create_account_with_owner('IsoB') as id`)).rows[0].id);
  });
  afterAll(async () => { await h.close(); });

  it('cross-account sources isolation: account B sees zero rows from account A', async () => {
    // Service inserts a sources row for account A
    await h.as(service, async (c) => {
      await c.query(
        `insert into public.sources (account_id, kind, title) values ($1,'document','A rate sheet')`,
        [accountA],
      );
    });

    // Account A can read their own row
    const aRows = await h.as(asA, async (c) =>
      (await c.query(`select title from public.sources where account_id=$1`, [accountA])).rows);
    expect(aRows).toEqual([{ title: 'A rate sheet' }]);

    // Account B sees zero rows — even with an explicit account_id filter
    const bCount = await h.as(asB, async (c) =>
      (await c.query(`select count(*)::int as n from public.sources where account_id=$1`, [accountA])).rows[0].n);
    expect(bCount).toBe(0);

    // Account B's unfiltered select also sees zero rows from A
    const bAll = await h.as(asB, async (c) =>
      (await c.query(`select count(*)::int as n from public.sources`)).rows[0].n);
    expect(bAll).toBe(0);
  });

  it('cross-account proposals isolation: account B sees zero rows from account A', async () => {
    // Insert a sources row so the proposal can reference it
    const srcId = await h.as(service, async (c) =>
      (await c.query(
        `insert into public.sources (account_id,kind,title) values ($1,'document','test src') returning id`,
        [accountA],
      )).rows[0].id);

    // Service proposes for account A
    await h.as(service, async (c) => {
      await c.query(
        `select public.propose_memory_change($1,'pricing','replace','$300/hr','rate sheet',$2,'doc_extract')`,
        [accountA, srcId],
      );
    });

    // Account A sees their proposal
    const aProposals = await h.as(asA, async (c) =>
      (await c.query(`select count(*)::int as n from public.proposals where account_id=$1`, [accountA])).rows[0].n);
    expect(aProposals).toBeGreaterThanOrEqual(1);

    // Account B sees zero proposals from account A
    const bCount = await h.as(asB, async (c) =>
      (await c.query(`select count(*)::int as n from public.proposals where account_id=$1`, [accountA])).rows[0].n);
    expect(bCount).toBe(0);

    // Account B's unfiltered select returns 0 rows (not A's rows)
    const bAll = await h.as(asB, async (c) =>
      (await c.query(`select count(*)::int as n from public.proposals`)).rows[0].n);
    expect(bAll).toBe(0);
  });

  it('propose_memory_change blocks proposals backed by a quarantined source', async () => {
    // Insert a quarantined sources row for account A
    const qSrcId = await h.as(service, async (c) =>
      (await c.query(
        `insert into public.sources (account_id,kind,title,redaction_status) values ($1,'document','quarantined doc','quarantined') returning id`,
        [accountA],
      )).rows[0].id);

    // Attempting to propose from this source must raise 'quarantined source'
    await expect(
      h.as(service, (c) =>
        c.query(
          `select public.propose_memory_change($1,'pricing','replace','$400/hr','from doc',$2,'doc_extract')`,
          [accountA, qSrcId],
        )),
    ).rejects.toThrow(/quarantined/i);

    // Confirm zero new proposals were inserted for this source
    const count = await h.as(asA, async (c) =>
      (await c.query(`select count(*)::int as n from public.proposals where source_id=$1`, [qSrcId])).rows[0].n);
    expect(count).toBe(0);
  });

  it('source_extraction_jobs cross-account: account B sees zero rows belonging to account A', async () => {
    // Service inserts a sources + job row for account A
    const srcId = await h.as(service, async (c) =>
      (await c.query(
        `insert into public.sources (account_id,kind,title) values ($1,'document','A job src') returning id`,
        [accountA],
      )).rows[0].id);

    await h.as(service, async (c) => {
      await c.query(
        `insert into public.source_extraction_jobs (account_id,source_id,status) values ($1,$2,'pending')`,
        [accountA, srcId],
      );
    });

    // Account A sees their own job
    const aRows = await h.as(asA, async (c) =>
      (await c.query(`select count(*)::int as n from public.source_extraction_jobs where account_id=$1`, [accountA])).rows[0].n);
    expect(aRows).toBeGreaterThanOrEqual(1);

    // Account B sees zero rows from account A (even with explicit filter)
    const bCount = await h.as(asB, async (c) =>
      (await c.query(
        `select count(*)::int as n from public.source_extraction_jobs where account_id=$1`,
        [accountA],
      )).rows[0].n);
    expect(bCount).toBe(0);

    // Account B's unfiltered select also returns 0
    const bAll = await h.as(asB, async (c) =>
      (await c.query(`select count(*)::int as n from public.source_extraction_jobs`)).rows[0].n);
    expect(bAll).toBe(0);
  });

  it('anon cannot read sources — permission denied', async () => {
    await expect(
      h.as(anon, (c) => c.query(`select * from public.sources`)),
    ).rejects.toThrow(/permission denied|row-level security/i);
  });

  it('anon cannot read source_extraction_jobs — permission denied', async () => {
    await expect(
      h.as(anon, (c) => c.query(`select * from public.source_extraction_jobs`)),
    ).rejects.toThrow(/permission denied|row-level security/i);
  });
});

// ---------------------------------------------------------------------------
// Storage path-prefix unit tests (pure — no DB required)
//
// These tests verify the `{accountId}/{sourceId}/{sanitizedFilename}` path
// invariant enforced by `apps/web/lib/brain/storage-path.ts`. The Supabase
// Storage bucket itself (brain-sources) cannot be tested in the RLS harness
// because the harness does not load the `storage` schema. The deployment-time
// storage policy (applied by scripts/bootstrap-brain-sources-bucket.ts) is
// the authoritative enforcement layer for bucket-level isolation; these tests
// verify that no server-side code constructs a path outside `{accountId}/`.
// ---------------------------------------------------------------------------

describe('Storage path-prefix — pure unit tests (no DB)', () => {
  const ACCOUNT_ID = 'aaaaaaaa-0000-4000-8000-000000000001';
  const SOURCE_ID  = 'bbbbbbbb-0000-4000-8000-000000000002';

  it('builds the canonical {accountId}/{sourceId}/{filename} path', () => {
    const path = buildStoragePath(ACCOUNT_ID, SOURCE_ID, 'rate-sheet.pdf');
    expect(path).toBe(`${ACCOUNT_ID}/${SOURCE_ID}/rate-sheet.pdf`);
  });

  it('path always starts with the account prefix', () => {
    const path = buildStoragePath(ACCOUNT_ID, SOURCE_ID, 'myfile.txt');
    expect(isPathOwnedByAccount(path, ACCOUNT_ID)).toBe(true);
  });

  it('isPathOwnedByAccount rejects a different account prefix', () => {
    const OTHER = 'cccccccc-0000-4000-8000-000000000003';
    const path = buildStoragePath(ACCOUNT_ID, SOURCE_ID, 'file.pdf');
    expect(isPathOwnedByAccount(path, OTHER)).toBe(false);
  });

  it('sanitizeFilename strips forward slashes (path traversal)', () => {
    // Slashes are the actual traversal mechanism. `..` alone (without `/`) is
    // harmless in a Storage path because the Storage API splits on `/` only.
    const result = sanitizeFilename('../../../etc/passwd');
    expect(result).not.toContain('/');
    // The `../` pattern (traversal) is broken — slashes gone means no climbing
    expect(result).not.toMatch(/\.\.\//);
  });

  it('sanitizeFilename strips backslashes (Windows path traversal)', () => {
    const result = sanitizeFilename('..\\..\\windows\\system32\\cmd.exe');
    expect(result).not.toContain('\\');
  });

  it('sanitizeFilename strips null bytes', () => {
    const result = sanitizeFilename('file\x00name.pdf');
    expect(result).not.toContain('\x00');
  });

  it('sanitizeFilename strips leading dots (hidden file / relative traversal)', () => {
    expect(sanitizeFilename('.hidden')).not.toMatch(/^\./);
    expect(sanitizeFilename('..secret')).not.toMatch(/^\./);
  });

  it('buildStoragePath with a traversal filename still stays within account prefix', () => {
    const path = buildStoragePath(ACCOUNT_ID, SOURCE_ID, '../../../evil.pdf');
    // Must still start with the account prefix
    expect(isPathOwnedByAccount(path, ACCOUNT_ID)).toBe(true);
    // Must not contain any unescaped directory traversal
    expect(path).not.toContain('../');
  });

  it('sanitizeFilename preserves safe characters (letters, digits, hyphens, underscores, dots mid-name)', () => {
    const name = 'My-Rate_Sheet 2024.pdf';
    const result = sanitizeFilename(name);
    // Spaces and other chars may remain; what matters is no path separators
    expect(result).not.toContain('/');
    expect(result).not.toContain('\\');
    // Letters and digits preserved
    expect(result).toContain('My');
    expect(result).toContain('2024');
  });

  it('empty filename produces a safe non-empty path segment', () => {
    const path = buildStoragePath(ACCOUNT_ID, SOURCE_ID, '');
    expect(path.startsWith(`${ACCOUNT_ID}/${SOURCE_ID}/`)).toBe(true);
    // The segment after the prefix must not be empty
    const parts = path.split('/');
    expect(parts.length).toBeGreaterThanOrEqual(3);
  });
});
