/**
 * Composer (Slice 2a) plumbing: the no-key fallback proposes a VALID
 * nudge.overdue-email spec (so synthesis works with no model — CI-safe), the
 * proposal is fail-closed validated, and a workflow with no available primitive
 * (the connector it needs isn't connected) returns an error.
 *
 * Live quality is the eval suite's job; this proves the safety plumbing.
 */
import { describe, expect, it, vi } from 'vitest';
import { validateComposedSpec } from '@nibbin/runtime';
import type { Generate, GenerateResult } from '@nibbin/router';
import type { DiagnosisWorkflow } from '../diagnosis/types';
import { composeSpec } from './compose';

// recordModelCall writes to the service client (a DB) — stub it so the LLM-path
// test doesn't need one. The no-key path never calls it.
vi.mock('../llm/client', () => ({
  recordModelCall: vi.fn(async () => {}),
  anthropicGenerate: () => null,
}));

const EMAIL_WF: DiagnosisWorkflow = {
  key: 'email.overdue',
  label: 'Chasing overdue replies',
  category: 'email',
  hoursPerWeek: 3,
  frequency: 'daily',
  friction: 'Threads go quiet and you forget to circle back.',
  recommendedNibbin: 'echo',
};

function fakeResult(text: string): GenerateResult {
  return {
    text,
    model: 'claude-sonnet-4-6',
    stopReason: 'end_turn',
    usage: { inputTokens: 200, cacheWriteTokens: 0, cacheReadTokens: 0, outputTokens: 60 },
  };
}

describe('composeSpec', () => {
  it('no-key fallback proposes a valid nudge.overdue-email spec', async () => {
    const result = await composeSpec('acct-1', 'user-1', EMAIL_WF, ['gmail']);
    expect('error' in result).toBe(false);
    if ('error' in result) throw new Error(result.error);

    expect(result.spec.templateKey).toBeNull();
    expect(result.spec.steps?.[0]?.capability).toBe('nudge.overdue-email');
    expect(result.spec.toolsAllowlist).toEqual(['email.read', 'email.draft']);
    expect(result.spec.requiredConnectors).toEqual(['gmail']);
    // The assembled spec passes the fail-closed gate.
    expect(validateComposedSpec(result.spec, ['gmail'])).toEqual([]);
    expect(result.summary.length).toBeGreaterThan(0);
  });

  it('returns an error when no primitive is available (connector not connected)', async () => {
    const result = await composeSpec('acct-1', 'user-1', EMAIL_WF, []); // no gmail
    expect('error' in result).toBe(true);
  });

  it('accepts a model pick on the menu and still validates fail-closed', async () => {
    const generate: Generate = vi.fn(async () =>
      fakeResult(
        JSON.stringify({
          displayName: 'Inbox follow-ups',
          capability: 'nudge.overdue-email',
          inputs: { staleDays: 5 },
          personaPolicy: { tone: 'gentle' },
        }),
      ),
    );
    const result = await composeSpec('acct-1', 'user-1', EMAIL_WF, ['gmail'], [], generate);
    expect('error' in result).toBe(false);
    if ('error' in result) throw new Error(result.error);
    expect(result.spec.displayName).toBe('Inbox follow-ups');
    expect(result.spec.steps?.[0]?.inputs?.staleDays).toBe(5);
    expect(validateComposedSpec(result.spec, ['gmail'])).toEqual([]);
  });

  it('falls back deterministically when the model returns junk', async () => {
    const generate: Generate = vi.fn(async () => fakeResult('not json at all'));
    const result = await composeSpec('acct-1', 'user-1', EMAIL_WF, ['gmail'], [], generate);
    expect('error' in result).toBe(false);
    if ('error' in result) throw new Error(result.error);
    // Deterministic default params (staleDays omitted → interpreter default 3).
    expect(result.spec.steps?.[0]?.capability).toBe('nudge.overdue-email');
    expect(validateComposedSpec(result.spec, ['gmail'])).toEqual([]);
  });

  it('ignores an off-menu model pick and uses the deterministic primitive', async () => {
    const generate: Generate = vi.fn(async () =>
      fakeResult(JSON.stringify({ capability: 'send.everything', inputs: {} })),
    );
    const result = await composeSpec('acct-1', 'user-1', EMAIL_WF, ['gmail'], [], generate);
    expect('error' in result).toBe(false);
    if ('error' in result) throw new Error(result.error);
    expect(result.spec.steps?.[0]?.capability).toBe('nudge.overdue-email');
  });
});
