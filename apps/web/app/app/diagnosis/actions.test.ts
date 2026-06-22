/**
 * adoptSynthesized (Composer Slice 2a — FIX 3): the reviewed, already-validated
 * spec is carried through to adoption VERBATIM. We must NOT recompose at adopt
 * time — a 2nd composeSpec call (temperature 0.3) could drift from what the
 * user approved (e.g. a different staleDays) and would double the model spend.
 *
 * This asserts the no-drift contract structurally: adoptSynthesized forwards the
 * caller-supplied spec straight to adoptComposedSpec (which re-validates it
 * fail-closed before any write — the trust boundary) and never touches composeSpec.
 */
import { describe, expect, it, vi, beforeEach } from 'vitest';
import type { AgentSpec } from '@nibbin/runtime';

const adoptComposedSpec = vi.fn(async () => ({
  nibbinId: 'nib-1',
  name: 'Overdue follow-ups',
  templateKey: null,
  stage: 'student' as const,
  firstRun: null,
  missingConnectors: [] as string[],
  species: 'Wisp',
  palette: '#5B8DB0',
  accessory: 'none',
  marking: 'stripe',
  isFirstAdoption: true,
}));
const composeSpec = vi.fn();

vi.mock('../../../lib/auth/app-session', () => ({
  appSession: vi.fn(async () => ({ user: { id: 'user-1' }, accountId: 'acct-1' })),
}));
vi.mock('../../../lib/runtime/adopt', () => ({
  adoptComposedSpec: (...args: unknown[]) => adoptComposedSpec(...(args as [])),
  adoptTemplate: vi.fn(),
}));
// Spy composeSpec, but use the REAL applyComposerEdit/editablePlanFromSpec/
// COMPOSER_CADENCES (Part B re-derivation is pure + deterministic — we want to
// exercise the real fail-closed validation, not a stub).
vi.mock('../../../lib/composer/compose', async () => {
  const actual = await vi.importActual<typeof import('../../../lib/composer/compose')>(
    '../../../lib/composer/compose',
  );
  return { ...actual, composeSpec: (...args: unknown[]) => composeSpec(...(args as [])) };
});
vi.mock('../../../lib/supabase/service', () => ({ serviceClient: vi.fn(() => ({})) }));
// The edit path reads the account's live connections; return all three so the
// morning-ops multi-step spec re-validates.
vi.mock('../../../lib/runtime/engine', () => ({
  activeConnections: vi.fn(async () => [
    { provider: 'gmail' },
    { provider: 'stripe' },
    { provider: 'google-calendar' },
  ]),
}));

const REVIEWED_SPEC: AgentSpec = {
  templateKey: null,
  version: 1,
  displayName: 'Overdue follow-ups',
  toolsAllowlist: ['email.read', 'email.send'],
  requiredConnectors: ['gmail'],
  triggers: [
    { kind: 'schedule', schedule: 'daily.morning', cooldownSecs: 3600 },
    { kind: 'user' },
  ],
  curriculum: {
    measures: 'overdue-reply drafts approved without edits',
    promotion: { windowRuns: 25, minApprovedUneditedPct: 0.95, coverageMinPatterns: 4 },
    routineMinApprovals: 5,
  },
  creditProfile: { weightClass: 'standard', ceilings: { maxSteps: 120, maxTokens: 12_000, maxWallClockMs: 60_000 } },
  steps: [{ capability: 'nudge.overdue-email', inputs: { staleDays: 7 } }],
  personaPolicy: { tone: 'warm, plainspoken' },
};

/** A reviewed 2-primitive "morning ops" spec (digest.morning THEN
 *  nudge.overdue-invoice) for the edit (reorder/remove) tests. */
const MORNING_OPS_SPEC: AgentSpec = {
  templateKey: null,
  version: 1,
  displayName: 'Morning ops',
  toolsAllowlist: ['calendar.read', 'payments.read', 'email.read', 'email.send'],
  requiredConnectors: ['google-calendar', 'stripe', 'gmail'],
  triggers: [
    { kind: 'schedule', schedule: 'daily.morning', cooldownSecs: 3600 },
    { kind: 'user' },
  ],
  curriculum: {
    measures: 'drafts approved without edits',
    promotion: { windowRuns: 25, minApprovedUneditedPct: 0.95, coverageMinPatterns: 4 },
    routineMinApprovals: 5,
  },
  creditProfile: { weightClass: 'standard', ceilings: { maxSteps: 120, maxTokens: 12_000, maxWallClockMs: 60_000 } },
  steps: [
    { capability: 'digest.morning', inputs: {} },
    { capability: 'nudge.overdue-invoice', inputs: { minDaysLate: 0 } },
  ],
  personaPolicy: { tone: 'warm, plainspoken' },
};

describe('adoptSynthesized — adopts the reviewed spec without recomposing', () => {
  beforeEach(() => {
    adoptComposedSpec.mockClear();
    composeSpec.mockClear();
  });

  it('forwards the reviewed spec verbatim to adoptComposedSpec (no 2nd composeSpec)', async () => {
    const { adoptSynthesized } = await import('./actions');
    const outcome = await adoptSynthesized(REVIEWED_SPEC);

    expect(composeSpec).not.toHaveBeenCalled(); // no recomposition / no drift / no double spend
    expect(adoptComposedSpec).toHaveBeenCalledTimes(1);
    // The exact spec the user reviewed (staleDays 7) is what gets adopted.
    const [accountId, userId, spec] = adoptComposedSpec.mock.calls[0] as unknown as [string, string, AgentSpec];
    expect(accountId).toBe('acct-1');
    expect(userId).toBe('user-1');
    expect(spec).toBe(REVIEWED_SPEC);
    expect(spec.steps?.[0]?.inputs?.staleDays).toBe(7);
    expect(outcome.ok).toBe(true);
  });
});

/* ── Part B — editing: re-derive + re-validate fail-closed on adopt ────────── */

describe('adoptSynthesized — applies + re-validates a user edit', () => {
  beforeEach(() => {
    adoptComposedSpec.mockClear();
    composeSpec.mockClear();
  });

  it('adopts an edited spec with a tweaked scalar param (staleDays 7 → 14)', async () => {
    const { adoptSynthesized } = await import('./actions');
    const outcome = await adoptSynthesized(
      REVIEWED_SPEC,
      undefined,
      { steps: [{ capability: 'nudge.overdue-email', inputs: { staleDays: 14 } }], cadence: 'daily.morning' },
      'Chasing overdue replies',
    );
    expect(outcome.ok).toBe(true);
    expect(adoptComposedSpec).toHaveBeenCalledTimes(1);
    const [, , adopted] = adoptComposedSpec.mock.calls[0] as unknown as [string, string, AgentSpec];
    // The re-derived spec carries the tweaked param + the trusted envelope rebuilt server-side.
    expect(adopted.steps?.[0]?.inputs?.staleDays).toBe(14);
    expect(adopted.toolsAllowlist).toEqual(['email.read', 'email.send']);
    expect(adopted.requiredConnectors).toEqual(['gmail']);
  });

  it('adopts a REMOVED step (morning ops → drop the brief, keep the invoice nudge)', async () => {
    const { adoptSynthesized } = await import('./actions');
    const outcome = await adoptSynthesized(
      MORNING_OPS_SPEC,
      undefined,
      { steps: [{ capability: 'nudge.overdue-invoice', inputs: { minDaysLate: 0 } }], cadence: 'daily.morning' },
      'Running the morning',
    );
    expect(outcome.ok).toBe(true);
    const [, , adopted] = adoptComposedSpec.mock.calls[0] as unknown as [string, string, AgentSpec];
    expect(adopted.steps?.map((s) => s.capability)).toEqual(['nudge.overdue-invoice']);
    // Envelope re-derived to the SINGLE remaining step. The invoice nudge is
    // cross-resource now (Stripe read + Gmail send), so it needs BOTH connectors.
    expect([...adopted.requiredConnectors].sort()).toEqual(['gmail', 'stripe']);
    expect(adopted.toolsAllowlist).toEqual(['payments.read', 'email.send']);
  });

  it('adopts a REORDERED multi-step edit (nudge first, then brief)', async () => {
    const { adoptSynthesized } = await import('./actions');
    const outcome = await adoptSynthesized(
      MORNING_OPS_SPEC,
      undefined,
      {
        steps: [
          { capability: 'nudge.overdue-invoice', inputs: { minDaysLate: 0 } },
          { capability: 'digest.morning', inputs: {} },
        ],
        cadence: 'weekly.monday',
      },
      'Morning ops',
    );
    expect(outcome.ok).toBe(true);
    const [, , adopted] = adoptComposedSpec.mock.calls[0] as unknown as [string, string, AgentSpec];
    expect(adopted.steps?.map((s) => s.capability)).toEqual(['nudge.overdue-invoice', 'digest.morning']);
    // The chosen cadence rode through to the schedule trigger.
    expect(adopted.triggers.find((t) => t.kind === 'schedule')?.schedule).toBe('weekly.monday');
  });

  it('REFUSES an edit that injects a step the proposal never contained (never adopts)', async () => {
    const { adoptSynthesized } = await import('./actions');
    const outcome = await adoptSynthesized(
      REVIEWED_SPEC, // only contained nudge.overdue-email
      undefined,
      { steps: [{ capability: 'nudge.overdue-invoice', inputs: { minDaysLate: 0 } }], cadence: 'daily.morning' },
      'Chasing overdue replies',
    );
    expect(outcome.ok).toBe(false);
    if (outcome.ok) throw new Error('expected refusal');
    expect(outcome.redirectTo).toContain('error=edit');
    expect(adoptComposedSpec).not.toHaveBeenCalled(); // refused BEFORE any write
  });

  it('REFUSES an edit with an out-of-bounds param (never adopts)', async () => {
    const { adoptSynthesized } = await import('./actions');
    const outcome = await adoptSynthesized(
      REVIEWED_SPEC,
      undefined,
      { steps: [{ capability: 'nudge.overdue-email', inputs: { staleDays: 999 } }], cadence: 'daily.morning' },
      'Chasing overdue replies',
    );
    expect(outcome.ok).toBe(false);
    expect(adoptComposedSpec).not.toHaveBeenCalled();
  });
});

describe('previewComposerEdit — re-validates without adopting', () => {
  it('returns the re-derived spec + summary for a valid edit', async () => {
    const { previewComposerEdit } = await import('./actions');
    const res = await previewComposerEdit(
      REVIEWED_SPEC,
      { steps: [{ capability: 'nudge.overdue-email', inputs: { staleDays: 10 } }], cadence: 'daily.evening' },
      'Chasing overdue replies',
    );
    expect(res.ok).toBe(true);
    if (!res.ok) throw new Error(res.error);
    expect(res.spec.steps?.[0]?.inputs?.staleDays).toBe(10);
    expect(res.spec.triggers.find((t) => t.kind === 'schedule')?.schedule).toBe('daily.evening');
    expect(res.summary.length).toBeGreaterThan(0);
  });

  it('returns an error for an invalid edit (out-of-bounds), without adopting', async () => {
    const { previewComposerEdit } = await import('./actions');
    const res = await previewComposerEdit(
      REVIEWED_SPEC,
      { steps: [{ capability: 'nudge.overdue-email', inputs: { staleDays: -5 } }] },
      'Chasing overdue replies',
    );
    expect(res.ok).toBe(false);
  });
});
