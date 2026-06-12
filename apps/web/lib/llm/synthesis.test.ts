/**
 * Synthesis pipelines against a fake Generate: routing tasks/tiers, the
 * Opus diagnosis pin, output bounds, and never-break-the-surface fallbacks.
 * (Live quality is the eval suite's job; this proves the plumbing.)
 */
import { describe, expect, it, vi } from 'vitest';
import type { Finding } from '@nibbin/connectors';
import type { Generate, GenerateResult } from '@nibbin/router';
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

  it('routes diagnosis_synthesis on the Opus pin with the hard output ceiling', async () => {
    const seen: Array<{ model: string; maxTokens: number }> = [];
    const generate: Generate = vi.fn(async (req) => {
      seen.push({ model: req.model, maxTokens: req.maxTokens });
      return fakeResult('Your week has a shape you probably feel but have never seen written down…', 'claude-opus-4-8');
    });
    const out = await diagnosisSynthesis('acct-1', 'user-1', PACKET, generate);
    expect(out?.model).toBe('claude-opus-4-8');
    expect(seen[0].model).toBe('claude-opus-4-8'); // the §6.3 splurge pin
    expect(seen[0].maxTokens).toBe(2500);
  });

  it('an empty packet or empty completion yields null, never a hollow diagnosis', async () => {
    expect(await diagnosisSynthesis('a', 'u', { sections: [] }, vi.fn() as unknown as Generate)).toBeNull();
    const empty: Generate = vi.fn(async () => fakeResult('   '));
    expect(await diagnosisSynthesis('a', 'u', PACKET, empty)).toBeNull();
  });
});
