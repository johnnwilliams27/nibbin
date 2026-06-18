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
vi.mock('../../../lib/composer/compose', () => ({
  composeSpec: (...args: unknown[]) => composeSpec(...(args as [])),
}));
// These are imported by the module but unused on the adoptSynthesized path.
vi.mock('../../../lib/supabase/service', () => ({ serviceClient: vi.fn() }));
vi.mock('../../../lib/runtime/engine', () => ({ activeConnections: vi.fn() }));

const REVIEWED_SPEC: AgentSpec = {
  templateKey: null,
  version: 1,
  displayName: 'Overdue follow-ups',
  toolsAllowlist: ['email.read', 'email.draft'],
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
