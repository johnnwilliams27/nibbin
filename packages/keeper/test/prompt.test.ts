/**
 * Tests for buildKeeperContext + KEEPER_SYSTEM_PROMPT — Task 3 (P6).
 *
 * Coverage:
 *  3b  No pending items → output unchanged from baseline
 *  3c  Proposals present (no high stakes) → volatile suffix added with count + deep-link
 *  3d  High-stakes item → suffix ends with high-stakes lead line
 *  3e  Awaiting-approval runs present → run line added
 *  3f  Token discipline: realistic full queue < 1500 chars
 *  +   Stable block contains the generic pending-items sentence (no per-turn data)
 *  +   Empty-queue does not emit "items waiting" text
 */

import { describe, expect, it } from 'vitest';
import { buildKeeperContext, KEEPER_SYSTEM_PROMPT } from '../src/prompt';
import type { PendingQueue } from '../src/types';

// ── Fixtures ─────────────────────────────────────────────────────────────────

const EMPTY_QUEUE: PendingQueue = { proposals: [], runs: [], conflicts: [], total: 0, hasHighStakes: false };

function makeProposal(overrides: Partial<{ stakes: 'normal' | 'high'; rationale: string; fieldKey: string }> = {}) {
  return {
    proposalId: 'prop-1',
    fieldKey: overrides.fieldKey ?? 'pricing',
    rationale: overrides.rationale ?? 'from rate sheet',
    stakes: overrides.stakes ?? 'normal',
    createdAt: '2026-06-23T10:00:00Z',
  };
}

function makeRun(overrides: Partial<{ nibbinName: string; title: string | null }> = {}) {
  return {
    runId: 'run-1',
    nibbinName: overrides.nibbinName ?? 'Email Nibbin',
    title: overrides.title !== undefined ? overrides.title : 'Invoice follow-up',
  };
}

// ── 3b. No pending items → output unchanged ───────────────────────────────────

describe('3b — no pending items', () => {
  it('returns names-only output when pendingItems is null', () => {
    const result = buildKeeperContext({ keeperName: 'Bramble', pendingItems: null });
    expect(result).toBe('Your given name is Bramble — the person named you themselves.');
    expect(result).not.toContain('waiting');
    expect(result).not.toContain('pending');
  });

  it('returns names-only output when pendingItems is undefined', () => {
    const result = buildKeeperContext({ keeperName: 'Bramble' });
    expect(result).toBe('Your given name is Bramble — the person named you themselves.');
    expect(result).not.toContain('waiting');
  });

  it('returns names-only output when total is 0', () => {
    const result = buildKeeperContext({ keeperName: 'Bramble', pendingItems: EMPTY_QUEUE });
    expect(result).toBe('Your given name is Bramble — the person named you themselves.');
    expect(result).not.toContain('items waiting');
    expect(result).not.toContain('waiting');
  });

  it('still falls back to settling message when no names and empty queue', () => {
    const result = buildKeeperContext({ pendingItems: EMPTY_QUEUE });
    expect(result).toBe('The person has not finished settling into the grove yet.');
  });
});

// ── 3c. Proposals present, no high stakes ────────────────────────────────────

describe('3c — proposals present, no high stakes', () => {
  it('appends count line and deep-link reference', () => {
    const queue: PendingQueue = {
      proposals: [makeProposal(), makeProposal({ fieldKey: 'retainer', rationale: 'from contract' })],
      runs: [],
      conflicts: [],
      total: 2,
      hasHighStakes: false,
    };
    const result = buildKeeperContext({ pendingItems: queue });

    expect(result).toContain('2 items waiting');
    expect(result).toContain('Pending memory proposals (2)');
    expect(result).toContain('pricing');
    expect(result).toContain('/app/memory');
  });

  it('includes the rationale snippet for the top proposal', () => {
    const queue: PendingQueue = {
      proposals: [makeProposal({ rationale: 'from rate sheet' })],
      runs: [],
      conflicts: [],
      total: 1,
      hasHighStakes: false,
    };
    const result = buildKeeperContext({ pendingItems: queue });

    expect(result).toContain('"from rate sheet"');
  });

  it('uses field key when rationale is empty', () => {
    const queue: PendingQueue = {
      proposals: [makeProposal({ rationale: '', fieldKey: 'contact_email' })],
      runs: [],
      conflicts: [],
      total: 1,
      hasHighStakes: false,
    };
    const result = buildKeeperContext({ pendingItems: queue });

    // Empty rationale → falls back to fieldKey as snippet
    expect(result).toContain('contact_email');
  });

  it('singular "item" when total is 1', () => {
    const queue: PendingQueue = {
      proposals: [makeProposal()],
      runs: [],
      conflicts: [],
      total: 1,
      hasHighStakes: false,
    };
    const result = buildKeeperContext({ pendingItems: queue });
    expect(result).toContain('1 item waiting');
    expect(result).not.toContain('1 items');
  });

  it('does not include high-stakes lead line', () => {
    const queue: PendingQueue = {
      proposals: [makeProposal({ stakes: 'normal' })],
      runs: [],
      conflicts: [],
      total: 1,
      hasHighStakes: false,
    };
    const result = buildKeeperContext({ pendingItems: queue });
    expect(result).not.toContain('high-stakes');
  });
});

// ── 3d. High-stakes item present ─────────────────────────────────────────────

describe('3d — high-stakes item', () => {
  it('appends high-stakes lead line', () => {
    const queue: PendingQueue = {
      proposals: [makeProposal({ stakes: 'high' })],
      runs: [],
      conflicts: [],
      total: 1,
      hasHighStakes: true,
    };
    const result = buildKeeperContext({ pendingItems: queue });

    expect(result).toContain('One or more of these is flagged high-stakes — lead with it.');
  });

  it('high-stakes line appears AFTER the proposal line', () => {
    const queue: PendingQueue = {
      proposals: [makeProposal({ stakes: 'high', rationale: 'urgent rate change' })],
      runs: [],
      conflicts: [],
      total: 1,
      hasHighStakes: true,
    };
    const result = buildKeeperContext({ pendingItems: queue });
    const proposalIdx = result.indexOf('Pending memory proposals');
    const highStakesIdx = result.indexOf('high-stakes');
    expect(proposalIdx).toBeGreaterThanOrEqual(0);
    expect(highStakesIdx).toBeGreaterThan(proposalIdx);
  });
});

// ── 3e. Awaiting-approval runs present ───────────────────────────────────────

describe('3e — awaiting-approval runs', () => {
  it('adds draft run line with nibbin name and title', () => {
    const queue: PendingQueue = {
      proposals: [],
      runs: [makeRun({ nibbinName: 'Email Nibbin', title: 'Invoice follow-up' })],
      conflicts: [],
      total: 1,
      hasHighStakes: false,
    };
    const result = buildKeeperContext({ pendingItems: queue });

    expect(result).toContain('Awaiting-approval drafts (1)');
    expect(result).toContain('Email Nibbin drafted Invoice follow-up');
    expect(result).toContain('approve at Grove Home');
  });

  it('falls back to nibbin-name-only label when title is null', () => {
    const queue: PendingQueue = {
      proposals: [],
      runs: [makeRun({ nibbinName: 'Calendar Nibbin', title: null })],
      conflicts: [],
      total: 1,
      hasHighStakes: false,
    };
    const result = buildKeeperContext({ pendingItems: queue });

    expect(result).toContain('Calendar Nibbin awaiting approval');
  });

  it('mixed proposals + runs: both sections present', () => {
    const queue: PendingQueue = {
      proposals: [makeProposal()],
      runs: [makeRun()],
      conflicts: [],
      total: 2,
      hasHighStakes: false,
    };
    const result = buildKeeperContext({ pendingItems: queue });

    expect(result).toContain('2 items waiting');
    expect(result).toContain('Pending memory proposals (1)');
    expect(result).toContain('Awaiting-approval drafts (1)');
  });
});

// ── 3f. Token discipline ──────────────────────────────────────────────────────

describe('3f — token discipline (< 1500 chars for max realistic queue)', () => {
  it('full queue (10 proposals + 5 runs) renders under 1500 chars', () => {
    const proposals = Array.from({ length: 10 }, (_, i) =>
      makeProposal({
        fieldKey: `field_${i}`,
        rationale: 'a'.repeat(80), // max truncated length
        stakes: i === 0 ? 'high' : 'normal',
      }),
    );
    const runs = Array.from({ length: 5 }, (_, i) =>
      makeRun({ nibbinName: `Nibbin ${i}`, title: `Draft task ${i}` }),
    );
    const queue: PendingQueue = {
      proposals,
      runs,
      conflicts: [],
      total: 15,
      hasHighStakes: true,
    };

    const result = buildKeeperContext({ keeperName: 'Bramble', userName: 'June', pendingItems: queue });
    expect(result.length).toBeLessThan(1500);
  });
});

// ── Stable block discipline ───────────────────────────────────────────────────

describe('KEEPER_SYSTEM_PROMPT stable block', () => {
  it('contains the generic pending-items sentence', () => {
    expect(KEEPER_SYSTEM_PROMPT).toContain('When pending items appear in your context');
  });

  it('does NOT contain per-turn data (counts, specific field names, deep-links)', () => {
    expect(KEEPER_SYSTEM_PROMPT).not.toContain('/app/memory');
    expect(KEEPER_SYSTEM_PROMPT).not.toContain('/app/grove');
    expect(KEEPER_SYSTEM_PROMPT).not.toMatch(/\d+ items? waiting/);
    expect(KEEPER_SYSTEM_PROMPT).not.toContain('Pending memory proposals');
    expect(KEEPER_SYSTEM_PROMPT).not.toContain('Awaiting-approval drafts');
  });

  it('still contains C10 no-hands declaration', () => {
    expect(KEEPER_SYSTEM_PROMPT).toContain('You have no hands');
  });
});

// ── Task 7: conflict line in keeper context ───────────────────────────────────

describe('7 — conflict surfacing in keeper context', () => {
  it('adds a conflict line when conflicts are present', () => {
    const queue: PendingQueue = {
      proposals: [],
      runs: [],
      conflicts: [{ fieldKey: 'pricing', detail: 'Rate sheet vs connector', stakes: 'high' }],
      total: 1,
      hasHighStakes: true,
    };
    const result = buildKeeperContext({ pendingItems: queue });

    expect(result).toContain('conflict');
    expect(result).toContain('Memory');
    expect(result).toContain('pricing');
  });

  it('omits conflict line when conflicts array is empty', () => {
    const queue: PendingQueue = {
      proposals: [makeProposal()],
      runs: [],
      conflicts: [],
      total: 1,
      hasHighStakes: false,
    };
    const result = buildKeeperContext({ pendingItems: queue });
    expect(result).not.toContain('conflict');
  });

  it('conflict count and deep-link reference appear in context', () => {
    const queue: PendingQueue = {
      proposals: [],
      runs: [],
      conflicts: [
        { fieldKey: 'policies', detail: 'Policy mismatch', stakes: 'high' },
        { fieldKey: 'voice', detail: 'Voice conflict', stakes: 'normal' },
      ],
      total: 2,
      hasHighStakes: true,
    };
    const result = buildKeeperContext({ pendingItems: queue });

    expect(result).toContain('2');
    expect(result).toContain('/app/memory');
  });

  it('C10 preserved — keeper context never claims to resolve conflicts', () => {
    const queue: PendingQueue = {
      proposals: [],
      runs: [],
      conflicts: [{ fieldKey: 'pricing', detail: 'Conflict', stakes: 'high' }],
      total: 1,
      hasHighStakes: true,
    };
    const result = buildKeeperContext({ pendingItems: queue });

    // Keeper must only mention/reference, never claim to resolve
    expect(result).not.toMatch(/I (can|will) resolve/i);
    expect(result).not.toMatch(/resolv(e|ing) (the )?conflict/i);
    expect(result).not.toContain('resolve_field_flag');
  });

  it('keeper SYSTEM_PROMPT also never claims to resolve conflicts', () => {
    expect(KEEPER_SYSTEM_PROMPT).not.toMatch(/resolve.*conflict/i);
    expect(KEEPER_SYSTEM_PROMPT).not.toContain('resolve_field_flag');
  });
});

// ── Names are preserved when pending items are also present ──────────────────

describe('context composition', () => {
  it('names appear before pending-items summary', () => {
    const queue: PendingQueue = {
      proposals: [makeProposal()],
      runs: [],
      conflicts: [],
      total: 1,
      hasHighStakes: false,
    };
    const result = buildKeeperContext({ keeperName: 'Bramble', userName: 'June', pendingItems: queue });

    const brambleIdx = result.indexOf('Bramble');
    const juneIdx = result.indexOf('June');
    const pendingIdx = result.indexOf('waiting');

    expect(brambleIdx).toBeGreaterThanOrEqual(0);
    expect(juneIdx).toBeGreaterThan(brambleIdx);
    expect(pendingIdx).toBeGreaterThan(juneIdx);
  });

  it('settling message is not shown when pending items are present but no names', () => {
    const queue: PendingQueue = {
      proposals: [makeProposal()],
      runs: [],
      conflicts: [],
      total: 1,
      hasHighStakes: false,
    };
    const result = buildKeeperContext({ pendingItems: queue });
    expect(result).not.toContain('settling into the grove');
    expect(result).toContain('waiting');
  });
});
