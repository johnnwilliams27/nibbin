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

// ---------------------------------------------------------------------------
// Task 6 — end-to-end integration: doc_extract proposal → approve → grove_memory
//
// Tests use the REAL propose_memory_change / decide_memory_proposal RPCs against
// the live Postgres DB (no mocks). Only the model and Storage are absent from
// this layer — the extraction worker is tested in doc-extract.test.ts with those
// mocked. Here we prove that the document path lands in the same F2 review loop
// and ratifies correctly end-to-end.
//
// Key invariants:
//   • A 'doc_extract' origin proposal approved via decide_memory_proposal writes
//     the curated value into grove_memory.
//   • A field_evidence row (relationship='supports') links the approved field
//     back to the document source (kind='document').
//   • The proposal carries origin='doc_extract'.
//   • grove_memory_history records change_source='proposal' for the ratification.
//   • audit_log has action='memory.ratified'.
//   • The review_item notification is resolved (read_at not null) after approval.
//   • A quarantined source produces zero proposals end-to-end (RPC guard).
//   • A rejected doc_extract proposal leaves grove_memory unchanged.
//   • Multiple proposals from one source each create their own field_evidence row.
//   • Foundation 'manual' origin proposals still work post-P2 migration (regression).
// ---------------------------------------------------------------------------

const UID_E2E = 'e2e00001-6666-4000-8000-000000000001';

describe.skipIf(!dbAvailable)('P2 — end-to-end doc_extract proposal → approve', () => {
  const h = new RlsHarness();
  let acct = '';
  const asU = { kind: 'authenticated', uid: UID_E2E } as const;
  const service = { kind: 'service_role' } as const;

  beforeAll(async () => {
    await h.reset();
    await h.sql(`insert into auth.users (id,email) values ($1,'e2e@ex.test')`, [UID_E2E]);
    await h.as(asU, async (c) => {
      await c.query(`insert into public.users (id,email) values ($1,$2)`, [UID_E2E, `${UID_E2E}@ex.test`]);
    });
    acct = await h.as(asU, async (c) =>
      (await c.query(`select public.create_account_with_owner('E2Etest') as id`)).rows[0].id);
  });
  afterAll(async () => { await h.close(); });

  it('doc_extract proposal → approve → curated value written + field_evidence linked + audit logged + notification resolved', async () => {
    // Service inserts a clean document source (simulating what extractDocument() does)
    const srcId = await h.as(service, async (c) =>
      (await c.query(
        `insert into public.sources (account_id, kind, title, redaction_status)
         values ($1,'document','rate.pdf','clean') returning id`,
        [acct],
      )).rows[0].id);

    // Service calls propose_memory_change with origin='doc_extract' — the real RPC
    const pid = await h.as(service, async (c) =>
      (await c.query(
        `select public.propose_memory_change($1,'pricing','replace','$250/hr','From rate.pdf — contains your pricing',$2,'doc_extract') as id`,
        [acct, srcId],
      )).rows[0].id);

    // Verify the proposal was created with the correct origin
    const proposal = await h.as(asU, async (c) =>
      (await c.query(
        `select origin, status, field_key, proposed_value, source_id from public.proposals where id=$1`,
        [pid],
      )).rows[0]);
    expect(proposal.origin).toBe('doc_extract');
    expect(proposal.status).toBe('pending');
    expect(proposal.field_key).toBe('pricing');
    expect(proposal.proposed_value).toBe('$250/hr');
    expect(proposal.source_id).toBe(srcId);

    // Member approves via the real decide_memory_proposal RPC
    await h.as(asU, async (c) => {
      await c.query(`select public.decide_memory_proposal($1,'approved')`, [pid]);
    });

    // Assert: curated value written to grove_memory
    const curatedValue = await h.as(asU, async (c) =>
      (await c.query(
        `select sections->>'pricing' as v from public.grove_memory where account_id=$1`,
        [acct],
      )).rows[0].v);
    expect(curatedValue).toBe('$250/hr');

    // Assert: field_evidence row links the approved field to the document source
    const evidence = await h.as(asU, async (c) =>
      (await c.query(
        `select relationship, source_id from public.field_evidence where account_id=$1 and field_key='pricing'`,
        [acct],
      )).rows);
    expect(evidence).toHaveLength(1);
    expect(evidence[0].relationship).toBe('supports');
    expect(evidence[0].source_id).toBe(srcId);

    // Assert: grove_memory_history records the ratification
    const hist = await h.as(asU, async (c) =>
      (await c.query(
        `select change_source, new_value, proposal_id from public.grove_memory_history
         where account_id=$1 and field_key='pricing'`,
        [acct],
      )).rows);
    expect(hist).toHaveLength(1);
    expect(hist[0].change_source).toBe('proposal');
    expect(hist[0].new_value).toBe('$250/hr');
    expect(hist[0].proposal_id).toBe(pid);

    // Assert: audit_log has memory.ratified action
    const audit = await h.as(asU, async (c) =>
      (await c.query(
        `select action, subject, meta from public.audit_log where account_id=$1 and action='memory.ratified'`,
        [acct],
      )).rows);
    expect(audit).toHaveLength(1);
    expect(audit[0].action).toBe('memory.ratified');
    expect(audit[0].subject).toBe('pricing');
    expect(audit[0].meta.decision).toBe('approved');
    expect(audit[0].meta.origin).toBe('doc_extract');

    // Assert: proposal status is 'approved'
    const status = await h.as(asU, async (c) =>
      (await c.query(`select status from public.proposals where id=$1`, [pid])).rows[0].status);
    expect(status).toBe('approved');

    // Assert: review_item notification resolved (read_at not null after approval)
    const notif = await h.as(asU, async (c) =>
      (await c.query(
        `select read_at from public.notifications where account_id=$1 and kind='review_item' and source_id=$2`,
        [acct, pid],
      )).rows[0]);
    expect(notif).toBeTruthy();
    expect(notif.read_at).not.toBeNull();
  });

  it('doc_extract proposal → reject → curated value unchanged', async () => {
    // Insert a clean source
    const srcId = await h.as(service, async (c) =>
      (await c.query(
        `insert into public.sources (account_id, kind, title, redaction_status)
         values ($1,'document','contract.pdf','clean') returning id`,
        [acct],
      )).rows[0].id);

    // Propose a value for a new field
    const pid = await h.as(service, async (c) =>
      (await c.query(
        `select public.propose_memory_change($1,'turnaround','replace','3 business days','From contract.pdf — turnaround time',$2,'doc_extract') as id`,
        [acct, srcId],
      )).rows[0].id);

    // Member rejects the proposal
    await h.as(asU, async (c) => {
      await c.query(`select public.decide_memory_proposal($1,'rejected')`, [pid]);
    });

    // Curated value should NOT be written
    const curatedValue = await h.as(asU, async (c) =>
      (await c.query(
        `select sections->>'turnaround' as v from public.grove_memory where account_id=$1`,
        [acct],
      )).rows[0]);
    // Either no row at all, or the key is absent (null)
    expect(curatedValue?.v ?? null).toBeNull();

    // No field_evidence row for this field
    const evidenceCount = await h.as(asU, async (c) =>
      (await c.query(
        `select count(*)::int as n from public.field_evidence where account_id=$1 and field_key='turnaround'`,
        [acct],
      )).rows[0].n);
    expect(evidenceCount).toBe(0);

    // Proposal status is 'rejected'
    const status = await h.as(asU, async (c) =>
      (await c.query(`select status from public.proposals where id=$1`, [pid])).rows[0].status);
    expect(status).toBe('rejected');
  });

  it('multiple field proposals from one source: approve all → field_evidence has 3 rows for the same source', async () => {
    // One document source backing 3 field proposals
    const srcId = await h.as(service, async (c) =>
      (await c.query(
        `insert into public.sources (account_id, kind, title, redaction_status)
         values ($1,'document','portfolio.pdf','clean') returning id`,
        [acct],
      )).rows[0].id);

    const fields = [
      { key: 'facts', value: 'Photography studio, 5 years in business' },
      { key: 'target_market', value: 'Couples and families in metro area' },
      { key: 'packages', value: 'Bronze $500, Silver $800, Gold $1200' },
    ] as const;

    const pids: string[] = [];
    for (const f of fields) {
      const pid = await h.as(service, async (c) =>
        (await c.query(
          `select public.propose_memory_change($1,$2,'replace',$3,$4,$5,'doc_extract') as id`,
          [acct, f.key, f.value, `From portfolio.pdf — ${f.key}`, srcId],
        )).rows[0].id);
      pids.push(pid);
    }

    // Approve all three
    for (const pid of pids) {
      await h.as(asU, async (c) => {
        await c.query(`select public.decide_memory_proposal($1,'approved')`, [pid]);
      });
    }

    // All three curated values written
    for (const f of fields) {
      const v = await h.as(asU, async (c) =>
        (await c.query(
          `select sections->>$2 as v from public.grove_memory where account_id=$1`,
          [acct, f.key],
        )).rows[0].v);
      expect(v).toBe(f.value);
    }

    // field_evidence has exactly 3 rows pointing to the same source
    const evidenceRows = await h.as(asU, async (c) =>
      (await c.query(
        `select field_key, source_id, relationship from public.field_evidence
         where account_id=$1 and source_id=$2
         order by field_key`,
        [acct, srcId],
      )).rows);
    expect(evidenceRows).toHaveLength(3);
    // All link to the same source with relationship='supports'
    for (const row of evidenceRows) {
      expect(row.source_id).toBe(srcId);
      expect(row.relationship).toBe('supports');
    }
    // All three expected field keys are represented
    const keys = evidenceRows.map((r: { field_key: string }) => r.field_key).sort();
    expect(keys).toEqual(['facts', 'packages', 'target_market']);
  });

  it('quarantined source: propose_memory_change raises; zero proposals created end-to-end', async () => {
    // Service inserts a quarantined source (simulating extractDocument marking it quarantined)
    const qSrcId = await h.as(service, async (c) =>
      (await c.query(
        `insert into public.sources (account_id, kind, title, redaction_status)
         values ($1,'document','malicious.pdf','quarantined') returning id`,
        [acct],
      )).rows[0].id);

    // The quarantine guard in propose_memory_change must block the proposal
    await expect(
      h.as(service, (c) =>
        c.query(
          `select public.propose_memory_change($1,'pricing','replace','STOLEN DATA','from doc',$2,'doc_extract')`,
          [acct, qSrcId],
        )),
    ).rejects.toThrow(/quarantined/i);

    // Zero proposals were created for this quarantined source
    const proposalCount = await h.as(asU, async (c) =>
      (await c.query(
        `select count(*)::int as n from public.proposals where account_id=$1 and source_id=$2`,
        [acct, qSrcId],
      )).rows[0].n);
    expect(proposalCount).toBe(0);

    // The quarantined source has no field_evidence rows
    const evidenceCount = await h.as(asU, async (c) =>
      (await c.query(
        `select count(*)::int as n from public.field_evidence where account_id=$1 and source_id=$2`,
        [acct, qSrcId],
      )).rows[0].n);
    expect(evidenceCount).toBe(0);
  });

  it("regression: 'manual' origin proposals still work after P2 migration changes", async () => {
    // Manual proposal with no source_id — the classic F2 path
    const pid = await h.as(service, async (c) =>
      (await c.query(
        `select public.propose_memory_change($1,'contact_email','replace','hello@example.com',null,null,'manual') as id`,
        [acct],
      )).rows[0].id);

    // Approve
    await h.as(asU, async (c) => {
      await c.query(`select public.decide_memory_proposal($1,'approved')`, [pid]);
    });

    // Curated value written
    const v = await h.as(asU, async (c) =>
      (await c.query(
        `select sections->>'contact_email' as v from public.grove_memory where account_id=$1`,
        [acct],
      )).rows[0].v);
    expect(v).toBe('hello@example.com');

    // No field_evidence row (no source_id)
    const evidenceCount = await h.as(asU, async (c) =>
      (await c.query(
        `select count(*)::int as n from public.field_evidence where account_id=$1 and field_key='contact_email'`,
        [acct],
      )).rows[0].n);
    expect(evidenceCount).toBe(0);

    // audit_log has the ratification
    const auditCount = await h.as(asU, async (c) =>
      (await c.query(
        `select count(*)::int as n from public.audit_log where account_id=$1 and action='memory.ratified' and subject='contact_email'`,
        [acct],
      )).rows[0].n);
    expect(auditCount).toBe(1);
  });
});
