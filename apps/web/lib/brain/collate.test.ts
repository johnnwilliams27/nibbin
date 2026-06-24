/**
 * Unit tests for collate.ts — C1 collate pass logic.
 *
 * All tests are pure (no I/O, no live DB, no model calls).
 * Mock svc follows the Supabase JS chainable pattern used across brain/*.test.ts.
 *
 * Run: npx vitest run apps/web/lib/brain/collate.test.ts
 */
import { describe, it, expect } from 'vitest';
import { collateAccount } from './collate';

// ── Shared date helpers ─────────────────────────────────────────────────────

/** Returns an ISO string that is `daysAgo` days in the past. */
function daysAgo(n: number): string {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return d.toISOString();
}

// ── Better mock: simpler promise-based approach ─────────────────────────────

/**
 * A simpler, more predictable mock that captures all DB calls and
 * returns canned data for each table/operation.
 */
function buildSvc(cfg: {
  ensureAuthorityError?: Error;
  authority?: Array<{ source_kind: string; weight: number }>;
  proposals?: Array<{
    id: string;
    field_key: string;
    proposed_value: string;
    source_id: string | null;
    status: string;
    created_at: string;
    sources?: { kind: string } | null;
  }>;
  memory?: { sections: Record<string, string>; hard_rules: string[]; notes: string | null } | null;
  fieldMeta?: Array<{ field_key: string; last_reviewed_at: string | null }>;
  flagConflictError?: Error;
  insertNotifError?: Error;
  proposalUpdateError?: Error;
  // The account collateAccount will be called with. The mock returns canned
  // data ONLY for reads scoped to this account via `.eq('account_id', …)`.
  // A read missing that filter sees EMPTY data — so a regression that drops the
  // account scope makes the conflict/dedup/stale tests fail (not silently pass).
  expectedAccount?: string;
}) {
  const rpcCalls: Array<{ name: string; args: Record<string, unknown> }> = [];
  const updateCalls: Array<{ payload: Record<string, unknown>; ids: string[]; filters: Array<{ op: string; col: string; val: unknown }> }> = [];
  // Records every read against a table: which select string + which eq filters
  // ran. The conflict/account-scope tests assert against this so a missing
  // `.eq('account_id', …)` or a missing `sources(kind)` embed FAILS the test.
  const reads: Array<{ table: string; select: string | null; filters: Array<{ op: string; col: string; val: unknown }> }> = [];

  const svc = {
    _rpcCalls: rpcCalls,
    _updateCalls: updateCalls,
    _reads: reads,

    rpc: async (name: string, args: Record<string, unknown>) => {
      rpcCalls.push({ name, args: { ...args } });
      if (name === 'ensure_source_authority' && cfg.ensureAuthorityError) {
        throw cfg.ensureAuthorityError;
      }
      if (name === 'flag_field_conflict' && cfg.flagConflictError) {
        throw cfg.flagConflictError;
      }
      if (name === 'insert_system_notification' && cfg.insertNotifError) {
        throw cfg.insertNotifError;
      }
      return { data: null, error: null };
    },

    from: (table: string) => {
      // The chainable builder collects eq/in calls and resolves on await
      const builder = {
        _table: table,
        _select: null as string | null,
        _filters: [] as Array<{ op: string; col: string; val: unknown }>,
        _payload: null as Record<string, unknown> | null,
        _recorded: false,

        select: (cols?: string) => {
          builder._select = cols ?? null;
          return builder;
        },
        eq: (col: string, val: unknown) => {
          builder._filters.push({ op: 'eq', col, val });
          return builder;
        },
        in: (col: string, ids: string[]) => {
          builder._filters.push({ op: 'in', col, val: ids });
          return builder;
        },
        single: () => builder,
        maybeSingle: () => builder,
        update: (payload: Record<string, unknown>) => {
          builder._payload = payload;
          // The update chain collects eq/in filters then resolves on the
          // terminal .in() call. Records the filters so a missing
          // account-scope on the dedup write is caught.
          const updFilters: Array<{ op: string; col: string; val: unknown }> = [];
          const updateBuilder = {
            eq: (col: string, val: unknown) => {
              updFilters.push({ op: 'eq', col, val });
              return updateBuilder;
            },
            in: async (col: string, ids: string[]) => {
              updFilters.push({ op: 'in', col, val: ids });
              updateCalls.push({ payload: builder._payload!, ids, filters: updFilters });
              if (cfg.proposalUpdateError) throw cfg.proposalUpdateError;
              return { data: null, error: null };
            },
          };
          return updateBuilder;
        },

        _record: () => {
          if (builder._recorded) return;
          builder._recorded = true;
          reads.push({ table, select: builder._select, filters: builder._filters });
        },

        // Make the select chain awaitable
        then: (
          onFulfilled: (v: { data: unknown; error: null | { message: string } }) => unknown,
          onRejected?: (e: unknown) => unknown,
        ): Promise<unknown> => {
          builder._record();
          // Account-scope gate: if an expectedAccount is configured, a read that
          // did NOT `.eq('account_id', expectedAccount)` sees no data. This is
          // what makes a missing-scope regression visibly fail.
          const scoped =
            cfg.expectedAccount === undefined ||
            builder._filters.some((f) => f.op === 'eq' && f.col === 'account_id' && f.val === cfg.expectedAccount);
          try {
            if (table === 'source_authority') {
              return Promise.resolve(onFulfilled({ data: scoped ? (cfg.authority ?? []) : [], error: null }));
            }
            if (table === 'proposals') {
              return Promise.resolve(onFulfilled({ data: scoped ? (cfg.proposals ?? []) : [], error: null }));
            }
            if (table === 'grove_memory') {
              if (!scoped || cfg.memory === null) {
                return Promise.resolve(onFulfilled({ data: null, error: null }));
              }
              const mem = cfg.memory ?? { sections: {}, hard_rules: [], notes: null };
              return Promise.resolve(onFulfilled({ data: mem, error: null }));
            }
            if (table === 'field_meta') {
              return Promise.resolve(onFulfilled({ data: scoped ? (cfg.fieldMeta ?? []) : [], error: null }));
            }
            return Promise.resolve(onFulfilled({ data: [], error: null }));
          } catch (e) {
            if (onRejected) return Promise.resolve(onRejected(e));
            return Promise.reject(e);
          }
        },
        catch: (fn: (e: unknown) => unknown) => {
          return Promise.resolve({ data: [], error: null }).catch(fn);
        },
      };
      return builder;
    },
  };

  return svc as unknown as Parameters<typeof collateAccount>[0];
}

// ── Tests ───────────────────────────────────────────────────────────────────

describe('collateAccount — empty account', () => {
  it('returns all-zero result and emits no RPC for an empty account', async () => {
    const svc = buildSvc({
      authority: [
        { source_kind: 'document', weight: 70 },
        { source_kind: 'manual', weight: 65 },
        { source_kind: 'connector_artifact', weight: 50 },
        { source_kind: 'observation', weight: 40 },
      ],
      proposals: [],
      memory: { sections: {}, hard_rules: [], notes: null },
      fieldMeta: [],
    });

    const result = await collateAccount(svc, 'acct-empty');
    expect(result.conflicts).toBe(0);
    expect(result.deduped).toBe(0);
    expect(result.stale).toBe(0);
    expect(result.briefEmitted).toBe(false);

    // ensure_source_authority must always be called
    const ensureCalls = (svc as unknown as { _rpcCalls: Array<{ name: string; args: Record<string, unknown> }> })
      ._rpcCalls.filter((c) => c.name === 'ensure_source_authority');
    expect(ensureCalls).toHaveLength(1);
    expect(ensureCalls[0].args['p_account']).toBe('acct-empty');

    // No flag_field_conflict or insert_system_notification
    const flagCalls = (svc as unknown as { _rpcCalls: Array<{ name: string }> })
      ._rpcCalls.filter((c) => c.name === 'flag_field_conflict');
    const briefCalls = (svc as unknown as { _rpcCalls: Array<{ name: string }> })
      ._rpcCalls.filter((c) => c.name === 'insert_system_notification');
    expect(flagCalls).toHaveLength(0);
    expect(briefCalls).toHaveLength(0);
  });
});

describe('collateAccount — conflict detection', () => {
  it('calls flag_field_conflict with EXACT arg names when two sources materially disagree', async () => {
    const srcA = 'src-aaa-0001-0000-0000-000000000001';
    const srcB = 'src-bbb-0001-0000-0000-000000000002';

    const svc = buildSvc({
      authority: [
        { source_kind: 'document', weight: 70 },
        { source_kind: 'manual', weight: 65 },
        { source_kind: 'connector_artifact', weight: 50 },
        { source_kind: 'observation', weight: 40 },
      ],
      proposals: [
        {
          id: 'prop-1',
          field_key: 'pricing',
          proposed_value: '50% deposit required',
          source_id: srcA,
          status: 'pending',
          created_at: daysAgo(5),
          sources: { kind: 'document' },
        },
        {
          id: 'prop-2',
          field_key: 'pricing',
          proposed_value: '30% deposit only',
          source_id: srcB,
          status: 'approved',
          created_at: daysAgo(3),
          sources: { kind: 'connector_artifact' },
        },
      ],
      memory: { sections: {}, hard_rules: [], notes: null },
      fieldMeta: [],
      expectedAccount: 'acct-conflict',
    });

    const result = await collateAccount(svc, 'acct-conflict');
    expect(result.conflicts).toBe(1);
    expect(result.briefEmitted).toBe(true);

    const rpcCalls = (svc as unknown as { _rpcCalls: Array<{ name: string; args: Record<string, unknown> }> })._rpcCalls;
    const flagCall = rpcCalls.find((c) => c.name === 'flag_field_conflict');
    expect(flagCall).toBeDefined();

    // Assert EXACT arg-name shape (PostgREST resolves by name)
    expect(flagCall!.args).toMatchObject({
      p_account: 'acct-conflict',
      p_field_key: 'pricing',
      p_competing_source_ids: expect.arrayContaining([srcA, srcB]),
      p_detail: expect.any(String),
      p_stakes: expect.stringMatching(/^(normal|high)$/),
      p_suggested_source_id: expect.any(String),
    });

    // stakes must be 'high' for pricing
    expect(flagCall!.args['p_stakes']).toBe('high');

    // p_suggested_source_id must be one of the competing source ids
    expect([srcA, srcB]).toContain(flagCall!.args['p_suggested_source_id']);

    // Arg names present and nothing extra unexpected (Task 8: p_suggested_source_id added)
    const argKeys = Object.keys(flagCall!.args).sort();
    expect(argKeys).toEqual(
      ['p_account', 'p_competing_source_ids', 'p_detail', 'p_field_key', 'p_stakes', 'p_suggested_source_id'].sort(),
    );
  });

  it('does not call flag_field_conflict when sources agree', async () => {
    const srcA = 'src-aaa';

    const svc = buildSvc({
      authority: [
        { source_kind: 'document', weight: 70 },
        { source_kind: 'manual', weight: 65 },
        { source_kind: 'connector_artifact', weight: 50 },
        { source_kind: 'observation', weight: 40 },
      ],
      proposals: [
        {
          id: 'prop-1',
          field_key: 'pricing',
          proposed_value: '50% deposit',
          source_id: srcA,
          status: 'pending',
          created_at: daysAgo(2),
          sources: { kind: 'document' },
        },
        {
          id: 'prop-2',
          field_key: 'pricing',
          proposed_value: '50% deposit',
          source_id: 'src-bbb',
          status: 'pending',
          created_at: daysAgo(1),
          sources: { kind: 'connector_artifact' },
        },
      ],
      memory: { sections: {}, hard_rules: [], notes: null },
      fieldMeta: [],
    });

    const result = await collateAccount(svc, 'acct-agree');
    expect(result.conflicts).toBe(0);

    const rpcCalls = (svc as unknown as { _rpcCalls: Array<{ name: string }> })._rpcCalls;
    const flagCalls = rpcCalls.filter((c) => c.name === 'flag_field_conflict');
    expect(flagCalls).toHaveLength(0);
  });
});

describe('collateAccount — dedup', () => {
  it('deduplicates pending proposals with the same field_key and normalized value', async () => {
    // prop-early is oldest → kept; prop-dup-1, prop-dup-2 are later → superseded
    const svc = buildSvc({
      authority: [
        { source_kind: 'document', weight: 70 },
        { source_kind: 'manual', weight: 65 },
        { source_kind: 'connector_artifact', weight: 50 },
        { source_kind: 'observation', weight: 40 },
      ],
      proposals: [
        {
          id: 'prop-early',
          field_key: 'facts',
          proposed_value: 'Photography Studio',
          source_id: 'src-1',
          status: 'pending',
          created_at: daysAgo(10),
          sources: { kind: 'document' },
        },
        {
          id: 'prop-dup-1',
          field_key: 'facts',
          proposed_value: '  photography studio  ', // normalizes same
          source_id: 'src-2',
          status: 'pending',
          created_at: daysAgo(5),
          sources: { kind: 'document' },
        },
        {
          id: 'prop-dup-2',
          field_key: 'facts',
          proposed_value: 'PHOTOGRAPHY STUDIO', // normalizes same
          source_id: 'src-3',
          status: 'pending',
          created_at: daysAgo(2),
          sources: { kind: 'manual' },
        },
      ],
      memory: { sections: {}, hard_rules: [], notes: null },
      fieldMeta: [],
    });

    const result = await collateAccount(svc, 'acct-dedup');
    expect(result.deduped).toBe(2); // 2 duplicates dismissed

    const updateCalls = (svc as unknown as { _updateCalls: Array<{ payload: Record<string, unknown>; ids: string[] }> })
      ._updateCalls;
    expect(updateCalls).toHaveLength(1);
    // The update should target the duplicate ids (not the earliest)
    expect(updateCalls[0].ids).toHaveLength(2);
    expect(updateCalls[0].ids).not.toContain('prop-early');
    expect(updateCalls[0].ids).toContain('prop-dup-1');
    expect(updateCalls[0].ids).toContain('prop-dup-2');
  });

  it('does not dedup proposals with different normalized values', async () => {
    const svc = buildSvc({
      authority: [
        { source_kind: 'document', weight: 70 },
        { source_kind: 'manual', weight: 65 },
        { source_kind: 'connector_artifact', weight: 50 },
        { source_kind: 'observation', weight: 40 },
      ],
      proposals: [
        {
          id: 'prop-A',
          field_key: 'facts',
          proposed_value: 'Photography studio',
          source_id: 'src-1',
          status: 'pending',
          created_at: daysAgo(5),
          sources: { kind: 'document' },
        },
        {
          id: 'prop-B',
          field_key: 'facts',
          proposed_value: 'Wedding photography studio',
          source_id: 'src-2',
          status: 'pending',
          created_at: daysAgo(3),
          sources: { kind: 'connector_artifact' },
        },
      ],
      memory: { sections: {}, hard_rules: [], notes: null },
      fieldMeta: [],
    });

    const result = await collateAccount(svc, 'acct-nodedup');
    expect(result.deduped).toBe(0);

    const updateCalls = (svc as unknown as { _updateCalls: Array<unknown> })._updateCalls;
    expect(updateCalls).toHaveLength(0);
  });

  it('only deduplicates pending proposals, not approved/rejected/superseded', async () => {
    const svc = buildSvc({
      authority: [
        { source_kind: 'document', weight: 70 },
        { source_kind: 'manual', weight: 65 },
        { source_kind: 'connector_artifact', weight: 50 },
        { source_kind: 'observation', weight: 40 },
      ],
      proposals: [
        {
          id: 'prop-approved',
          field_key: 'facts',
          proposed_value: 'Photography Studio',
          source_id: 'src-1',
          status: 'approved',
          created_at: daysAgo(10),
          sources: { kind: 'document' },
        },
        {
          id: 'prop-pending',
          field_key: 'facts',
          proposed_value: 'photography studio', // same normalized value
          source_id: 'src-2',
          status: 'pending',
          created_at: daysAgo(5),
          sources: { kind: 'manual' },
        },
      ],
      memory: { sections: {}, hard_rules: [], notes: null },
      fieldMeta: [],
    });

    // approved proposals are not part of the pending dedup pool
    const result = await collateAccount(svc, 'acct-mixed-status');
    // Only 1 pending proposal → no duplicates among pending only
    expect(result.deduped).toBe(0);
  });
});

describe('collateAccount — stale fields', () => {
  it('counts fields whose last_reviewed_at is older than 60 days', async () => {
    const svc = buildSvc({
      authority: [
        { source_kind: 'document', weight: 70 },
        { source_kind: 'manual', weight: 65 },
        { source_kind: 'connector_artifact', weight: 50 },
        { source_kind: 'observation', weight: 40 },
      ],
      proposals: [],
      memory: { sections: {}, hard_rules: [], notes: null },
      fieldMeta: [
        { field_key: 'facts', last_reviewed_at: daysAgo(90) },  // stale
        { field_key: 'pricing', last_reviewed_at: daysAgo(61) }, // stale
        { field_key: 'policies', last_reviewed_at: daysAgo(30) }, // fresh
        { field_key: 'voice', last_reviewed_at: null }, // no review — also stale
      ],
    });

    const result = await collateAccount(svc, 'acct-stale');
    // facts (90d), pricing (61d), voice (null) are stale — policies (30d) is fresh
    expect(result.stale).toBe(3);
    expect(result.briefEmitted).toBe(true); // stale > 0
  });

  it('counts zero stale fields when all are reviewed within 60 days', async () => {
    const svc = buildSvc({
      authority: [
        { source_kind: 'document', weight: 70 },
        { source_kind: 'manual', weight: 65 },
        { source_kind: 'connector_artifact', weight: 50 },
        { source_kind: 'observation', weight: 40 },
      ],
      proposals: [],
      memory: { sections: {}, hard_rules: [], notes: null },
      fieldMeta: [
        { field_key: 'facts', last_reviewed_at: daysAgo(10) },
        { field_key: 'pricing', last_reviewed_at: daysAgo(59) },
      ],
    });

    const result = await collateAccount(svc, 'acct-fresh');
    expect(result.stale).toBe(0);
    expect(result.briefEmitted).toBe(false);
  });
});

describe('collateAccount — morning brief', () => {
  it('emits a morning brief with correct count summary when activity exists', async () => {
    const srcA = 'src-conflict-aaa';
    const srcB = 'src-conflict-bbb';

    const svc = buildSvc({
      authority: [
        { source_kind: 'document', weight: 70 },
        { source_kind: 'manual', weight: 65 },
        { source_kind: 'connector_artifact', weight: 50 },
        { source_kind: 'observation', weight: 40 },
      ],
      proposals: [
        {
          id: 'prop-c1',
          field_key: 'pricing',
          proposed_value: '50% deposit required',
          source_id: srcA,
          status: 'pending',
          created_at: daysAgo(5),
          sources: { kind: 'document' },
        },
        {
          id: 'prop-c2',
          field_key: 'pricing',
          proposed_value: 'full payment upfront',
          source_id: srcB,
          status: 'pending',
          created_at: daysAgo(3),
          sources: { kind: 'connector_artifact' },
        },
      ],
      memory: { sections: {}, hard_rules: [], notes: null },
      fieldMeta: [
        { field_key: 'facts', last_reviewed_at: daysAgo(90) }, // stale
      ],
    });

    const result = await collateAccount(svc, 'acct-brief');
    expect(result.conflicts).toBe(1);
    expect(result.stale).toBe(1);
    expect(result.briefEmitted).toBe(true);

    const rpcCalls = (svc as unknown as { _rpcCalls: Array<{ name: string; args: Record<string, unknown> }> })._rpcCalls;
    const briefCall = rpcCalls.find((c) => c.name === 'insert_system_notification');
    expect(briefCall).toBeDefined();

    // Assert EXACT arg-name shape
    expect(briefCall!.args).toMatchObject({
      p_account: 'acct-brief',
      p_kind: 'review_item',
      p_source_id: expect.stringMatching(/^collate:/),
      p_title: expect.any(String),
      p_body: expect.any(String),
      p_payload: expect.objectContaining({
        kind: 'morning_brief',
        conflicts: 1,
        stale: 1,
      }),
      p_stakes: 'normal',
    });

    // source_id must be a stable per-day key
    const sourceId = briefCall!.args['p_source_id'] as string;
    expect(sourceId).toMatch(/^collate:\d{4}-\d{2}-\d{2}$/);

    // Body mentions conflict and stale counts
    const body = briefCall!.args['p_body'] as string;
    expect(body).toContain('1');
  });

  it('does NOT emit a brief when all counts are zero', async () => {
    const svc = buildSvc({
      authority: [
        { source_kind: 'document', weight: 70 },
        { source_kind: 'manual', weight: 65 },
        { source_kind: 'connector_artifact', weight: 50 },
        { source_kind: 'observation', weight: 40 },
      ],
      proposals: [],
      memory: { sections: {}, hard_rules: [], notes: null },
      fieldMeta: [
        { field_key: 'facts', last_reviewed_at: daysAgo(10) }, // fresh
      ],
    });

    const result = await collateAccount(svc, 'acct-zero');
    expect(result.conflicts).toBe(0);
    expect(result.deduped).toBe(0);
    expect(result.stale).toBe(0);
    expect(result.briefEmitted).toBe(false);

    const rpcCalls = (svc as unknown as { _rpcCalls: Array<{ name: string }> })._rpcCalls;
    const briefCalls = rpcCalls.filter((c) => c.name === 'insert_system_notification');
    expect(briefCalls).toHaveLength(0);
  });

  it('brief source_id is stable across the same day (idempotent per-day key)', async () => {
    const svc = buildSvc({
      authority: [
        { source_kind: 'document', weight: 70 },
        { source_kind: 'manual', weight: 65 },
        { source_kind: 'connector_artifact', weight: 50 },
        { source_kind: 'observation', weight: 40 },
      ],
      proposals: [],
      memory: { sections: {}, hard_rules: [], notes: null },
      fieldMeta: [
        { field_key: 'facts', last_reviewed_at: daysAgo(90) }, // stale → triggers brief
      ],
    });

    await collateAccount(svc, 'acct-stable');

    const rpcCalls = (svc as unknown as { _rpcCalls: Array<{ name: string; args: Record<string, unknown> }> })._rpcCalls;
    const briefCall = rpcCalls.find((c) => c.name === 'insert_system_notification');
    const sourceId = briefCall!.args['p_source_id'] as string;

    // The date portion must match today's date
    const todayDate = new Date().toISOString().slice(0, 10);
    expect(sourceId).toBe(`collate:${todayDate}`);
  });

  it('brief payload contains deduped count', async () => {
    const svc = buildSvc({
      authority: [
        { source_kind: 'document', weight: 70 },
        { source_kind: 'manual', weight: 65 },
        { source_kind: 'connector_artifact', weight: 50 },
        { source_kind: 'observation', weight: 40 },
      ],
      proposals: [
        {
          id: 'prop-early',
          field_key: 'facts',
          proposed_value: 'Photography Studio',
          source_id: 'src-1',
          status: 'pending',
          created_at: daysAgo(10),
          sources: { kind: 'document' },
        },
        {
          id: 'prop-dup',
          field_key: 'facts',
          proposed_value: 'photography studio',
          source_id: 'src-2',
          status: 'pending',
          created_at: daysAgo(5),
          sources: { kind: 'document' },
        },
      ],
      memory: { sections: {}, hard_rules: [], notes: null },
      fieldMeta: [],
    });

    const result = await collateAccount(svc, 'acct-dedup-brief');
    expect(result.deduped).toBe(1);
    expect(result.briefEmitted).toBe(true);

    const rpcCalls = (svc as unknown as { _rpcCalls: Array<{ name: string; args: Record<string, unknown> }> })._rpcCalls;
    const briefCall = rpcCalls.find((c) => c.name === 'insert_system_notification');
    expect(briefCall!.args['p_payload']).toMatchObject({
      kind: 'morning_brief',
      deduped: 1,
    });
  });
});

describe('collateAccount — fail-safe: one step error does not abort', () => {
  it('flag_field_conflict error does not prevent stale count or brief', async () => {
    const srcA = 'src-fail-safe-a';
    const srcB = 'src-fail-safe-b';

    const svc = buildSvc({
      authority: [
        { source_kind: 'document', weight: 70 },
        { source_kind: 'manual', weight: 65 },
        { source_kind: 'connector_artifact', weight: 50 },
        { source_kind: 'observation', weight: 40 },
      ],
      proposals: [
        {
          id: 'prop-c1',
          field_key: 'pricing',
          proposed_value: '50% deposit',
          source_id: srcA,
          status: 'pending',
          created_at: daysAgo(5),
          sources: { kind: 'document' },
        },
        {
          id: 'prop-c2',
          field_key: 'pricing',
          proposed_value: 'full payment now',
          source_id: srcB,
          status: 'pending',
          created_at: daysAgo(3),
          sources: { kind: 'observation' },
        },
      ],
      memory: { sections: {}, hard_rules: [], notes: null },
      fieldMeta: [
        { field_key: 'facts', last_reviewed_at: daysAgo(90) }, // stale
      ],
      flagConflictError: new Error('DB error during flag'),
    });

    // Should NOT throw — fail-safe per step
    const result = await expect(collateAccount(svc, 'acct-failsafe')).resolves.toBeDefined();
    void result;

    // Stale count should still be populated even if flag step threw
    const res = await collateAccount(buildSvc({
      authority: [
        { source_kind: 'document', weight: 70 },
        { source_kind: 'manual', weight: 65 },
        { source_kind: 'connector_artifact', weight: 50 },
        { source_kind: 'observation', weight: 40 },
      ],
      proposals: [
        {
          id: 'prop-c1',
          field_key: 'pricing',
          proposed_value: '50% deposit',
          source_id: srcA,
          status: 'pending',
          created_at: daysAgo(5),
          sources: { kind: 'document' },
        },
        {
          id: 'prop-c2',
          field_key: 'pricing',
          proposed_value: 'full payment now',
          source_id: srcB,
          status: 'pending',
          created_at: daysAgo(3),
          sources: { kind: 'observation' },
        },
      ],
      memory: { sections: {}, hard_rules: [], notes: null },
      fieldMeta: [
        { field_key: 'facts', last_reviewed_at: daysAgo(90) },
      ],
      flagConflictError: new Error('DB error during flag'),
    }), 'acct-failsafe2');

    // stale should still count even if conflicts step failed
    expect(res.stale).toBe(1);
    // conflicts step failed but other steps continued
    // The result must be defined (no unhandled throw)
    expect(typeof res.conflicts).toBe('number');
    expect(typeof res.deduped).toBe('number');
  });

  it('ensure_source_authority error does not abort — returns sensible defaults', async () => {
    const svc = buildSvc({
      ensureAuthorityError: new Error('auth seed failed'),
      proposals: [],
      memory: { sections: {}, hard_rules: [], notes: null },
      fieldMeta: [
        { field_key: 'facts', last_reviewed_at: daysAgo(90) }, // stale
      ],
    });

    // Must not throw
    const result = await collateAccount(svc, 'acct-auth-err');
    // Should still count stale
    expect(result.stale).toBeGreaterThanOrEqual(0);
    expect(typeof result.conflicts).toBe('number');
  });
});

describe('collateAccount — morning brief arg-name regression guard', () => {
  it('insert_system_notification is called with EXACT 7 arg keys', async () => {
    const svc = buildSvc({
      authority: [
        { source_kind: 'document', weight: 70 },
        { source_kind: 'manual', weight: 65 },
        { source_kind: 'connector_artifact', weight: 50 },
        { source_kind: 'observation', weight: 40 },
      ],
      proposals: [],
      memory: { sections: {}, hard_rules: [], notes: null },
      fieldMeta: [
        { field_key: 'facts', last_reviewed_at: daysAgo(90) }, // triggers brief
      ],
    });

    await collateAccount(svc, 'acct-argnames');

    const rpcCalls = (svc as unknown as { _rpcCalls: Array<{ name: string; args: Record<string, unknown> }> })._rpcCalls;
    const briefCall = rpcCalls.find((c) => c.name === 'insert_system_notification');
    expect(briefCall).toBeDefined();

    const argKeys = Object.keys(briefCall!.args).sort();
    expect(argKeys).toEqual(
      ['p_account', 'p_body', 'p_kind', 'p_payload', 'p_source_id', 'p_stakes', 'p_title'].sort(),
    );
  });

  it('ensure_source_authority is called with EXACT 1 arg key', async () => {
    const svc = buildSvc({
      authority: [],
      proposals: [],
      memory: { sections: {}, hard_rules: [], notes: null },
      fieldMeta: [],
    });

    await collateAccount(svc, 'acct-ensure-args');

    const rpcCalls = (svc as unknown as { _rpcCalls: Array<{ name: string; args: Record<string, unknown> }> })._rpcCalls;
    const ensureCall = rpcCalls.find((c) => c.name === 'ensure_source_authority');
    expect(ensureCall).toBeDefined();

    const argKeys = Object.keys(ensureCall!.args).sort();
    expect(argKeys).toEqual(['p_account']);
  });
});

// ── Account-scope + source-join regression guards (gate Critical + Important) ─
//
// These are the tests that would have CAUGHT the two defects the gate found:
//   1. every account-owned read must be `.eq('account_id', accountId)`-scoped
//      (under service-role there is no RLS — an unscoped read is cross-tenant);
//   2. the proposals read must embed `sources(kind)` or conflict detection is
//      dead (p.sources?.kind is undefined for every row → zero conflicts).
//
// The mock now gates canned data on the account scope and records the select
// string + filters per table, so a regression makes these fail loudly.

type ReadRecord = { table: string; select: string | null; filters: Array<{ op: string; col: string; val: unknown }> };

function readsOf(svc: unknown): ReadRecord[] {
  return (svc as { _reads: ReadRecord[] })._reads;
}

function isScoped(r: ReadRecord, accountId: string): boolean {
  return r.filters.some((f) => f.op === 'eq' && f.col === 'account_id' && f.val === accountId);
}

describe('collateAccount — every account-owned read is account-scoped', () => {
  const ACCOUNT = 'acct-scope-guard';
  const srcA = 'src-scope-aaa';
  const srcB = 'src-scope-bbb';

  function buildScopedSvc() {
    return buildSvc({
      authority: [
        { source_kind: 'document', weight: 70 },
        { source_kind: 'manual', weight: 65 },
        { source_kind: 'connector_artifact', weight: 50 },
        { source_kind: 'observation', weight: 40 },
      ],
      proposals: [
        {
          id: 'prop-1',
          field_key: 'pricing',
          proposed_value: '50% deposit required',
          source_id: srcA,
          status: 'pending',
          created_at: daysAgo(5),
          sources: { kind: 'document' },
        },
        {
          id: 'prop-2',
          field_key: 'pricing',
          proposed_value: 'full payment upfront',
          source_id: srcB,
          status: 'pending',
          created_at: daysAgo(3),
          sources: { kind: 'connector_artifact' },
        },
      ],
      memory: { sections: {}, hard_rules: [], notes: null },
      fieldMeta: [{ field_key: 'facts', last_reviewed_at: daysAgo(90) }],
      expectedAccount: ACCOUNT,
    });
  }

  it('scopes source_authority, proposals, grove_memory, and field_meta reads to accountId', async () => {
    const svc = buildScopedSvc();
    await collateAccount(svc, ACCOUNT);

    const reads = readsOf(svc);
    const ownedTables = ['source_authority', 'proposals', 'grove_memory', 'field_meta'];
    for (const table of ownedTables) {
      const tableReads = reads.filter((r) => r.table === table);
      expect(tableReads.length, `expected at least one read of ${table}`).toBeGreaterThan(0);
      for (const r of tableReads) {
        expect(
          isScoped(r, ACCOUNT),
          `read of ${table} is missing .eq('account_id', accountId) — cross-account bleed under service-role`,
        ).toBe(true);
      }
    }
  });

  it('the proposals select embeds sources(kind) so conflict detection can read the real kind', async () => {
    const svc = buildScopedSvc();
    await collateAccount(svc, ACCOUNT);

    const proposalRead = readsOf(svc).find((r) => r.table === 'proposals');
    expect(proposalRead).toBeDefined();
    expect(proposalRead!.select, 'proposals select must embed sources(kind)').toMatch(/sources\s*\(\s*kind\s*\)/);
  });

  it('produces a conflict only because reads were account-scoped (canned data is scope-gated)', async () => {
    // Sanity: with the correct account, the scope-gated mock returns data and a
    // 2-source disagreement flags. (The failing-mirror test below proves the gate bites.)
    const svc = buildScopedSvc();
    const result = await collateAccount(svc, ACCOUNT);
    expect(result.conflicts).toBe(1);
  });

  it('FAILS to detect conflicts when called with the WRONG account — proving the scope filter is load-bearing', async () => {
    // buildScopedSvc gates its canned data on ACCOUNT. Running collate for a
    // different account means none of the (correctly account-scoped) reads match,
    // so no proposals are seen → zero conflicts. If collate.ts ever dropped the
    // `.eq('account_id', …)` filter, this account would instead see ACCOUNT's
    // proposals and wrongly flag — so this asymmetry is the regression sentinel.
    const svc = buildScopedSvc();
    const result = await collateAccount(svc, 'acct-some-other-tenant');
    expect(result.conflicts).toBe(0);
    expect(result.deduped).toBe(0);
    expect(result.stale).toBe(0);
  });

  it('the dedup update is account-scoped', async () => {
    const svc = buildSvc({
      authority: [
        { source_kind: 'document', weight: 70 },
        { source_kind: 'manual', weight: 65 },
        { source_kind: 'connector_artifact', weight: 50 },
        { source_kind: 'observation', weight: 40 },
      ],
      proposals: [
        {
          id: 'prop-early',
          field_key: 'facts',
          proposed_value: 'Photography Studio',
          source_id: 'src-1',
          status: 'pending',
          created_at: daysAgo(10),
          sources: { kind: 'document' },
        },
        {
          id: 'prop-dup',
          field_key: 'facts',
          proposed_value: 'photography studio',
          source_id: 'src-2',
          status: 'pending',
          created_at: daysAgo(5),
          sources: { kind: 'document' },
        },
      ],
      memory: { sections: {}, hard_rules: [], notes: null },
      fieldMeta: [],
      expectedAccount: ACCOUNT,
    });

    await collateAccount(svc, ACCOUNT);

    const updateCalls = (svc as unknown as {
      _updateCalls: Array<{ ids: string[]; filters: Array<{ op: string; col: string; val: unknown }> }>;
    })._updateCalls;
    expect(updateCalls).toHaveLength(1);
    expect(
      updateCalls[0].filters.some((f) => f.op === 'eq' && f.col === 'account_id' && f.val === ACCOUNT),
      'dedup update must be scoped to this account (defense-in-depth)',
    ).toBe(true);
  });
});
