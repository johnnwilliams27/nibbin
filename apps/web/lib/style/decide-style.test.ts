/**
 * decideDraft style wiring tests (SPEC §4A Slice 1).
 *
 * Verifies:
 *   • the decision completes on approve without style extraction breaking it;
 *   • the decision completes on edited with editContext (style path is best-effort);
 *   • a thrown error from style extraction NEVER breaks the decision;
 *   • a thrown error from updateStyleProfile NEVER breaks the decision.
 *
 * Uses top-level vi.mock so mocks are hoisted before module resolution.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';

// ---- Service client mock ----
const rpcSpy = vi.fn();
type Row = Record<string, unknown>;
type TableSeed = Row | Row[] | null;
let tableSeed: Record<string, TableSeed> = {};

function makeQueryChain(table: string) {
  const resolve = () => {
    const seed = tableSeed[table] ?? null;
    if (seed === null) return { data: null, error: null, count: 0 };
    if (Array.isArray(seed)) return { data: seed, error: null, count: seed.length };
    return { data: seed, error: null, count: seed ? 1 : 0 };
  };
  const self: Record<string, unknown> = {};
  const chainable = () => self;
  self['eq'] = chainable;
  self['in'] = chainable;
  self['order'] = chainable;
  self['limit'] = chainable;
  self['single'] = () => resolve();
  self['maybeSingle'] = () => resolve();
  self['select'] = (_cols?: string, opts?: { count?: string; head?: boolean }) => {
    if (opts?.count === 'exact') {
      const { count } = resolve();
      function deepCountChain(): Record<string, unknown> {
        const c: Record<string, unknown> = { count, error: null };
        c['eq'] = deepCountChain;
        c['in'] = deepCountChain;
        c['order'] = deepCountChain;
        c['limit'] = deepCountChain;
        return c;
      }
      return deepCountChain();
    }
    return self;
  };
  return self;
}

function makeServiceClient() {
  const from = vi.fn((table: string) => makeQueryChain(table));
  return { from, rpc: rpcSpy } as unknown as SupabaseClient;
}

vi.mock('../supabase/service', () => ({
  serviceClient: () => makeServiceClient(),
}));

// ---- Style mocks ----
const extractStyleSpy = vi.fn();
const updateStyleSpy = vi.fn();

vi.mock('./extract', () => ({
  extractStyleFromEdit: (...args: unknown[]) => extractStyleSpy(...args),
}));
vi.mock('./update', () => ({
  updateStyleProfile: (...args: unknown[]) => updateStyleSpy(...args),
}));

// ---- Other required mocks ----
const maybePromoteMock = vi.fn().mockResolvedValue(null);
vi.mock('../runtime/engine', () => ({
  maybePromote: (...args: unknown[]) => maybePromoteMock(...args),
  devSeedEnabled: () => false,
}));
const maybeDriftNudgeMock = vi.fn().mockResolvedValue(undefined);
vi.mock('../runtime/drift', () => ({
  maybeDriftNudge: (...args: unknown[]) => maybeDriftNudgeMock(...args),
}));
const emitMock = vi.fn().mockResolvedValue(undefined);
vi.mock('../runtime/stores', () => ({
  SupabaseEventSink: class {
    emit(...args: unknown[]) { return emitMock(...args); }
  },
  SupabaseRunStore: class {},
  SupabaseRoutineStore: class {},
  SupabaseGrantStore: class {},
  SupabaseIdempotencyStore: class {},
  SupabaseSendRecordStore: class {},
}));
vi.mock('../memory/extract', () => ({
  writeMemoryFromDecision: vi.fn().mockResolvedValue(undefined),
}));

import { decideDraft } from '../runtime/decide';

function seedTable(table: string, rows: TableSeed) {
  tableSeed[table] = rows;
}

const sessionClient = {
  rpc: vi.fn().mockResolvedValue({ error: null }),
} as unknown as SupabaseClient;

beforeEach(() => {
  tableSeed = {};
  rpcSpy.mockReset().mockResolvedValue({ data: null, error: null });
  extractStyleSpy.mockReset().mockResolvedValue(null);
  updateStyleSpy.mockReset().mockResolvedValue(undefined);
  emitMock.mockReset().mockResolvedValue(undefined);
  maybePromoteMock.mockReset().mockResolvedValue(null);
  maybeDriftNudgeMock.mockReset().mockResolvedValue(undefined);
  (sessionClient.rpc as ReturnType<typeof vi.fn>).mockResolvedValue({ error: null });
  seedTable('runs', { nibbin_id: 'nib-1', account_id: 'acct-1' });
  seedTable('approvals', []);
});

describe('decideDraft — style wiring (§4A)', () => {
  it('returns successfully on approve (style extraction not triggered without editContext)', async () => {
    const result = await decideDraft(
      sessionClient,
      'acct-1',
      'user-1',
      'run-1',
      'approved',
      0,
      // no editContext
    );
    expect(result.decision).toBe('approved');
  });

  it('returns successfully on edited decision with editContext', async () => {
    extractStyleSpy.mockResolvedValue({
      formality: 0.3,
      sentiment: 0.5,
      pace: 0.4,
      signature_sign_offs: [],
      removals: [],
    });
    const result = await decideDraft(
      sessionClient,
      'acct-1',
      'user-1',
      'run-1',
      'edited',
      5,
      { originalDraft: 'Original text here', editedDraft: 'Edited text here with some changes' },
    );
    expect(result.decision).toBe('edited');
  });

  it('decision succeeds even when extractStyleFromEdit rejects', async () => {
    extractStyleSpy.mockRejectedValue(new Error('model failure'));
    await expect(
      decideDraft(
        sessionClient,
        'acct-1',
        'user-1',
        'run-1',
        'edited',
        3,
        { originalDraft: 'Original', editedDraft: 'Edited with changes' },
      ),
    ).resolves.toMatchObject({ decision: 'edited' });
  });

  it('decision succeeds even when updateStyleProfile rejects', async () => {
    extractStyleSpy.mockResolvedValue({
      formality: 0.5,
      sentiment: 0,
      pace: 0.5,
      signature_sign_offs: [],
      removals: [],
    });
    updateStyleSpy.mockRejectedValue(new Error('db failure'));
    await expect(
      decideDraft(
        sessionClient,
        'acct-1',
        'user-1',
        'run-1',
        'edited',
        3,
        { originalDraft: 'Original', editedDraft: 'Edited with changes' },
      ),
    ).resolves.toMatchObject({ decision: 'edited' });
  });
});
