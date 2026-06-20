/**
 * Synthesis pipelines against a fake Generate: routing tasks/tiers, the
 * Opus diagnosis pin, output bounds, and never-break-the-surface fallbacks.
 * (Live quality is the eval suite's job; this proves the plumbing.)
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Finding } from '@nibbin/connectors';
import type { Generate, GenerateResult } from '@nibbin/router';

// Mock the entitlement seam so diagnosis tests control free / charge /
// needs_credits without a DB. recordModelCall + the charge both hit the
// service client, which is mocked here too. vi.hoisted so the spies exist when
// the (hoisted) vi.mock factory runs.
const { resolveDiagnosisEntitlement, chargeDiagnosis } = vi.hoisted(() => ({
  resolveDiagnosisEntitlement: vi.fn(),
  chargeDiagnosis: vi.fn(async () => {}),
}));
vi.mock('./diagnosis-entitlement', async (orig) => {
  const actual = await orig<typeof import('./diagnosis-entitlement')>();
  return { ...actual, resolveDiagnosisEntitlement, chargeDiagnosis };
});
vi.mock('../supabase/service', () => ({
  serviceClient: () => ({ from: () => ({ insert: vi.fn(async () => ({ error: null })) }) }),
}));

import { diagnosisSynthesis, scanSummaryLine } from './synthesis';

function fakeResult(text: string, model = 'claude-haiku-4-5-20251001'): GenerateResult {
  return {
    text,
    model,
    stopReason: 'end_turn',
    usage: { inputTokens: 200, cacheWriteTokens: 300, cacheReadTokens: 0, outputTokens: 80 },
  };
}

const FINDINGS: Finding[] = [
  {
    module: 'inbox_sweep',
    connectionId: 'c1',
    insight: 'You answered 14 inquiries by hand last week.',
    cost: { hoursPerWeek: 2 },
    recommendedNibbin: 'sweep',
    adoptAction: { specTemplateKey: 'sweep', requiredConnectors: ['gmail'] },
  } as unknown as Finding,
];

describe('scanSummaryLine', () => {
  it('routes scan_synthesis (T1) and returns the trimmed model line', async () => {
    const seen: Array<{ model: string }> = [];
    const generate: Generate = vi.fn(async (req) => {
      seen.push({ model: req.model });
      return fakeResult('  Most of your week leaks into inquiry replies — fourteen by hand last week alone.  ');
    });
    const line = await scanSummaryLine('acct-1', 'user-1', FINDINGS, generate);
    expect(line).toBe('Most of your week leaks into inquiry replies — fourteen by hand last week alone.');
    // T1 default is the Haiku pin (founder decision 2026-06-12)
    expect(seen[0].model).toContain('haiku');
  });

  it('returns null on empty findings, junk output, or a throwing provider', async () => {
    expect(await scanSummaryLine('a', 'u', [], vi.fn() as unknown as Generate)).toBeNull();
    const junk: Generate = vi.fn(async () => fakeResult('x'.repeat(500)));
    expect(await scanSummaryLine('a', 'u', FINDINGS, junk)).toBeNull();
    const dead: Generate = vi.fn(async () => {
      throw new Error('outage');
    });
    expect(await scanSummaryLine('a', 'u', FINDINGS, dead)).toBeNull();
  });
});

describe('diagnosisSynthesis', () => {
  const PACKET = {
    sections: [
      { title: 'Week shape', content: 'Mornings: email triage. Afternoons: edits.' },
      { title: 'Leaks', content: 'Gallery delivery chasing, invoice nudges.' },
    ],
  };

  beforeEach(() => {
    resolveDiagnosisEntitlement.mockReset();
    chargeDiagnosis.mockReset().mockResolvedValue(undefined);
    // default: the free first diagnosis
    resolveDiagnosisEntitlement.mockResolvedValue({ kind: 'free' });
  });

  it('FIRST diagnosis is free: routes the Opus pin, does NOT charge, tags free', async () => {
    resolveDiagnosisEntitlement.mockResolvedValue({ kind: 'free' });
    const seen: Array<{ model: string; maxTokens: number }> = [];
    const generate: Generate = vi.fn(async (req) => {
      seen.push({ model: req.model, maxTokens: req.maxTokens });
      return fakeResult('Your week has a shape you probably feel but have never seen written down…', 'claude-opus-4-8');
    });
    const out = await diagnosisSynthesis('acct-1', 'user-1', PACKET, generate);
    expect(out).toEqual({ kind: 'ok', text: expect.any(String), model: 'claude-opus-4-8', free: true });
    expect(seen[0].model).toBe('claude-opus-4-8'); // the §6.3 splurge pin
    expect(seen[0].maxTokens).toBe(2500);
    expect(chargeDiagnosis).not.toHaveBeenCalled(); // free → no ledger charge
  });

  it('SECOND diagnosis, no credits: refuses WITHOUT calling the model', async () => {
    resolveDiagnosisEntitlement.mockResolvedValue({ kind: 'needs_credits', message: 'top up please' });
    const generate = vi.fn(async () => fakeResult('should never run', 'claude-opus-4-8'));
    const out = await diagnosisSynthesis('acct-1', 'user-1', PACKET, generate as unknown as Generate);
    expect(out).toEqual({ kind: 'needs_credits', message: 'top up please' });
    expect(generate).not.toHaveBeenCalled(); // no spend
    expect(chargeDiagnosis).not.toHaveBeenCalled();
  });

  it('SECOND diagnosis, with credits: proceeds and charges the ledger', async () => {
    resolveDiagnosisEntitlement.mockResolvedValue({ kind: 'charge' });
    const generate: Generate = vi.fn(async () =>
      fakeResult('A real diagnosis paid for with credits.', 'claude-opus-4-8'),
    );
    const out = await diagnosisSynthesis('acct-1', 'user-1', PACKET, generate, 'run-77');
    expect(out).toMatchObject({ kind: 'ok', free: false });
    expect(generate).toHaveBeenCalledTimes(1);
    expect(chargeDiagnosis).toHaveBeenCalledWith('acct-1', 'run-77');
  });

  it('logs a LOUD cost-cap breach when a recorded call exceeds the hard cap', async () => {
    resolveDiagnosisEntitlement.mockResolvedValue({ kind: 'charge' });
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    // A wildly over-cap Opus usage: ~$1+ at $25/MTok output, far over $0.30.
    const runaway: Generate = vi.fn(async () => ({
      text: 'a runaway completion',
      model: 'claude-opus-4-8',
      stopReason: 'end_turn' as const,
      usage: { inputTokens: 1_000_000, cacheWriteTokens: 0, cacheReadTokens: 0, outputTokens: 1_000_000 },
    }));
    await diagnosisSynthesis('acct-1', 'user-1', PACKET, runaway);
    expect(errSpy).toHaveBeenCalledWith(expect.stringContaining('cost cap BREACHED'));
    errSpy.mockRestore();
  });

  it('an empty packet or empty completion yields unavailable, never a hollow diagnosis', async () => {
    expect(await diagnosisSynthesis('a', 'u', { sections: [] }, vi.fn() as unknown as Generate)).toEqual({
      kind: 'unavailable',
    });
    const empty: Generate = vi.fn(async () => fakeResult('   '));
    expect(await diagnosisSynthesis('a', 'u', PACKET, empty)).toEqual({ kind: 'unavailable' });
  });
});
