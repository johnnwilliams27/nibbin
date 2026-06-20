/**
 * synthesizeWorkflowFromText — fail-closed contract unit tests (§4.6 freeform path).
 *
 * The function's ONLY job is classifying a free-text chore into a structured
 * DiagnosisWorkflow. Its contract is fail-closed: any no-key / degraded-budget /
 * parse-failure / thrown-error returns null (callers fall back to the nearest
 * starter template); a valid LLM JSON response returns a normalized workflow.
 *
 * The three module singletons are mocked (same seams + style as
 * ../style/extract.test.ts): anthropicGenerate + recordModelCall from
 * '../llm/client', and groveRouter.route from '../grove/router'. No DB, no
 * network. Cases:
 *   1. No key            → null; recordModelCall NOT called.
 *   2. Degraded budget   → null; returns before the model call.
 *   3. Parse failure     → null (model text has no JSON object).
 *   4. Happy path        → normalized workflow; recordModelCall outcome:'ok'.
 *   5. Invalid enums     → category/frequency fall back to other/weekly.
 *   6. Empty label/friction → label falls back to text slice; friction → null.
 *   7. Thrown error      → null + recordModelCall outcome:'error'; the special
 *                          'frontier_budget_exhausted' message skips recording.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// ---------------------------------------------------------------------------
// Mocks — hoisted before module resolution. anthropicGenerate() returns the
// llm callable (or null for the no-key case); groveRouter.route resolves a
// routing decision; recordModelCall is a spy (no DB).
// ---------------------------------------------------------------------------

const mockLlm = vi.fn();
const mockAnthropicGenerate = vi.fn<[], typeof mockLlm | null>(() => mockLlm);
const mockRecordModelCall = vi.fn().mockResolvedValue(undefined);
const mockRoute = vi.fn().mockResolvedValue({
  model: 'claude-haiku-test',
  tier: 't2' as const,
  degraded: false,
  requestedTier: 't2' as const,
  notice: null,
});

vi.mock('../llm/client', () => ({
  anthropicGenerate: () => mockAnthropicGenerate(),
  recordModelCall: (...args: unknown[]) => mockRecordModelCall(...args),
}));

vi.mock('../grove/router', () => ({
  groveRouter: {
    route: (...args: unknown[]) => mockRoute(...args),
  },
}));

import { synthesizeWorkflowFromText } from './freeform';

/** A GenerateResult-shaped object: freeform reads .text, .model, .usage. */
function fakeResult(text: string) {
  return {
    text,
    model: 'claude-haiku-test',
    stopReason: 'end_turn',
    usage: { inputTokens: 50, cacheWriteTokens: 0, cacheReadTokens: 0, outputTokens: 20 },
  };
}

beforeEach(() => {
  // Default: a key exists, budget healthy, model returns nothing useful yet.
  mockAnthropicGenerate.mockReturnValue(mockLlm);
  mockRoute.mockResolvedValue({
    model: 'claude-haiku-test',
    tier: 't2' as const,
    degraded: false,
    requestedTier: 't2' as const,
    notice: null,
  });
});

afterEach(() => {
  vi.clearAllMocks();
});

describe('synthesizeWorkflowFromText — fail-closed contract', () => {
  it('returns null when there is no LLM key, and does NOT record a model call', async () => {
    mockAnthropicGenerate.mockReturnValueOnce(null);
    const result = await synthesizeWorkflowFromText('acc', 'usr', 'chase unpaid invoices', []);
    expect(result).toBeNull();
    expect(mockRecordModelCall).not.toHaveBeenCalled();
    expect(mockLlm).not.toHaveBeenCalled();
  });

  it('returns null when the router degrades (budget spent) without calling the model', async () => {
    mockRoute.mockResolvedValueOnce({
      model: 'claude-haiku-test',
      tier: 't2' as const,
      degraded: true,
      requestedTier: 't2' as const,
      notice: 'budget spent',
    });
    const result = await synthesizeWorkflowFromText('acc', 'usr', 'sort my inbox', []);
    expect(result).toBeNull();
    expect(mockLlm).not.toHaveBeenCalled();
    expect(mockRecordModelCall).not.toHaveBeenCalled();
  });

  it('returns null when the model response contains no JSON object (parse failure)', async () => {
    mockLlm.mockResolvedValueOnce(fakeResult('I cannot classify this chore.'));
    const result = await synthesizeWorkflowFromText('acc', 'usr', 'something vague', []);
    expect(result).toBeNull();
    // The call still happened, so a model call is recorded (outcome:'ok').
    expect(mockRecordModelCall).toHaveBeenCalledTimes(1);
  });

  it('parses a clean response into a normalized DiagnosisWorkflow and records outcome ok', async () => {
    mockLlm.mockResolvedValueOnce(
      fakeResult(
        JSON.stringify({
          label: 'Morning email triage',
          category: 'email',
          frequency: 'daily',
          friction: 'New mail piles up overnight',
        }),
      ),
    );
    const result = await synthesizeWorkflowFromText('acc', 'usr', 'deal with my morning email', []);
    expect(result).toEqual({
      key: 'freeform',
      label: 'Morning email triage',
      category: 'email',
      hoursPerWeek: 0,
      frequency: 'daily',
      friction: 'New mail piles up overnight',
      recommendedNibbin: null,
    });
    expect(mockRecordModelCall).toHaveBeenCalledTimes(1);
    expect(mockRecordModelCall).toHaveBeenCalledWith(
      expect.objectContaining({ outcome: 'ok', task: 'custom_spec_draft' }),
    );
  });

  it('falls back to other/weekly when the model returns invalid enum values', async () => {
    mockLlm.mockResolvedValueOnce(
      fakeResult(
        JSON.stringify({
          label: 'Mystery chore',
          category: 'bogus',
          frequency: 'bogus',
          friction: 'who knows',
        }),
      ),
    );
    const result = await synthesizeWorkflowFromText('acc', 'usr', 'a thing', []);
    expect(result?.category).toBe('other');
    expect(result?.frequency).toBe('weekly');
    expect(result?.label).toBe('Mystery chore');
  });

  it('falls back to the input slice for an empty label and nulls a blank friction', async () => {
    const input = 'I want help keeping all my client paperwork organized and findable';
    mockLlm.mockResolvedValueOnce(
      fakeResult(
        JSON.stringify({
          label: '   ',
          category: 'docs',
          frequency: 'weekly',
          friction: '   ',
        }),
      ),
    );
    const result = await synthesizeWorkflowFromText('acc', 'usr', input, []);
    expect(result?.label).toBe(input.slice(0, 50));
    expect(result?.friction).toBeNull();
    expect(result?.category).toBe('docs');
  });

  it('returns null AND records outcome error when the model throws a generic error', async () => {
    mockLlm.mockRejectedValueOnce(new Error('network blew up'));
    const result = await synthesizeWorkflowFromText('acc', 'usr', 'do the thing', []);
    expect(result).toBeNull();
    expect(mockRecordModelCall).toHaveBeenCalledTimes(1);
    expect(mockRecordModelCall).toHaveBeenCalledWith(
      expect.objectContaining({ outcome: 'error', task: 'custom_spec_draft' }),
    );
  });

  it('returns null WITHOUT recording when the thrown error is frontier_budget_exhausted', async () => {
    mockLlm.mockRejectedValueOnce(new Error('frontier_budget_exhausted'));
    const result = await synthesizeWorkflowFromText('acc', 'usr', 'do the thing', []);
    expect(result).toBeNull();
    expect(mockRecordModelCall).not.toHaveBeenCalled();
  });
});
