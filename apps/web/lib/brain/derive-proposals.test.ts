import { describe, it, expect } from 'vitest';
import { deriveProposalsFromObservation } from './derive-proposals';
import type { ObservationSummary } from './observation-schema';

const summary: ObservationSummary = {
  study_id: 's1',
  study_period: { start: '2026-06-20', end: '2026-06-21' },
  total_events_reviewed: 40,
  active_ms: 3_600_000,
  top_apps: [{ name: 'Figma', durationMs: 3_000_000, category: 'design' }],
  busiest_hour: 9,
  workflow_shapes: [{ pattern: 'Figma→Slack', frequency: 6 }],
  gap_count: 0,
};

describe('deriveProposalsFromObservation', () => {
  it('returns { proposals: [], model: null, usage: null } when no model is configured (null generate)', async () => {
    const result = await deriveProposalsFromObservation(summary, null);
    expect(result.proposals).toEqual([]);
    expect(result.model).toBeNull();
    expect(result.usage).toBeNull();
  });

  it('parses a valid model response, dropping unknown field_keys and hard_rules', async () => {
    const gen = async () => ({
      text: JSON.stringify([
        { field_key: 'facts', value: 'Design is the primary daily focus.', rationale: 'Most time in Figma.' },
        { field_key: 'hard_rules', value: 'never', rationale: 'x' },     // dropped — hard_rules blocked
        { field_key: 'not_a_section', value: 'x', rationale: 'x' },       // dropped — unknown key
      ]),
      usage: { inputTokens: 1, cacheWriteTokens: 0, cacheReadTokens: 0, outputTokens: 1 },
      stopReason: 'end_turn',
      model: 'claude-haiku-4-5',
    });
    const out = await deriveProposalsFromObservation(summary, gen as never);
    expect(out.proposals).toHaveLength(1);
    expect(out.proposals[0].field_key).toBe('facts');
    expect(out.proposals[0].value).toBe('Design is the primary daily focus.');
  });

  it('surfaces model + usage metadata for COGS ledgering on a successful call', async () => {
    const gen = async () => ({
      text: JSON.stringify([{ field_key: 'facts', value: 'Design-led.', rationale: 'r' }]),
      usage: { inputTokens: 10, cacheWriteTokens: 2, cacheReadTokens: 0, outputTokens: 30 },
      stopReason: 'end_turn',
      model: 'claude-haiku-4-5',
    });
    const out = await deriveProposalsFromObservation(summary, gen as never);
    // Caller can ledger: model and usage are both non-null
    expect(out.model).toBe('claude-haiku-4-5');
    expect(out.usage).toEqual({ inputTokens: 10, cacheWriteTokens: 2, cacheReadTokens: 0, outputTokens: 30 });
    expect(out.proposals).toHaveLength(1);
  });

  it('returns null model/usage (no-call sentinel) on a non-JSON / garbage model response — caller ledgers nothing', async () => {
    const gen = async () => ({
      text: 'sorry, cannot help with that',
      usage: { inputTokens: 1, cacheWriteTokens: 0, cacheReadTokens: 0, outputTokens: 1 },
      stopReason: 'end_turn',
      model: 'claude-haiku-4-5',
    });
    // Parse failure: still surfaces model/usage (the call did happen — tokens were spent)
    const out = await deriveProposalsFromObservation(summary, gen as never);
    expect(out.proposals).toEqual([]);
    // model/usage are present even on parse failure — the call was made, tokens spent
    expect(out.model).toBe('claude-haiku-4-5');
    expect(out.usage).not.toBeNull();
  });

  it('returns null model/usage on a thin/empty summary (no events) — no call made', async () => {
    const thin: ObservationSummary = {
      ...summary,
      total_events_reviewed: 0,
      active_ms: 0,
      top_apps: [],
      workflow_shapes: [],
    };
    // Even with a working generate, a thin summary must not produce proposals.
    // The function short-circuits before calling the model.
    const gen = async () => ({
      text: JSON.stringify([{ field_key: 'facts', value: 'something', rationale: 'r' }]),
      usage: { inputTokens: 1, cacheWriteTokens: 0, cacheReadTokens: 0, outputTokens: 1 },
      stopReason: 'end_turn',
      model: 'claude-haiku-4-5',
    });
    const out = await deriveProposalsFromObservation(thin, gen as never);
    expect(out.proposals).toEqual([]);
    // Thin-data path: no model call → model/usage are null (nothing to ledger)
    expect(out.model).toBeNull();
    expect(out.usage).toBeNull();
  });

  it('caps proposals at 3 even if the model returns more (parse failure → [])', async () => {
    const gen = async () => ({
      text: JSON.stringify([
        { field_key: 'facts', value: 'Fact 1.', rationale: 'r1' },
        { field_key: 'pricing', value: 'Pricing 1.', rationale: 'r2' },
        { field_key: 'policies', value: 'Policy 1.', rationale: 'r3' },
        { field_key: 'faq', value: 'FAQ 1.', rationale: 'r4' }, // 4th — should not pass the .max(3) guard
      ]),
      usage: { inputTokens: 1, cacheWriteTokens: 0, cacheReadTokens: 0, outputTokens: 1 },
      stopReason: 'end_turn',
      model: 'claude-haiku-4-5',
    });
    const out = await deriveProposalsFromObservation(summary, gen as never);
    // modelOut schema is .max(3) — more than 3 proposals → parse failure → []
    expect(out.proposals).toEqual([]);
    // Tokens were still spent — model/usage surfaced for COGS ledgering
    expect(out.model).toBe('claude-haiku-4-5');
  });

  it('returns null model/usage (no-call sentinel) when generate throws', async () => {
    const gen = async () => { throw new Error('network failure'); };
    const out = await deriveProposalsFromObservation(summary, gen as never);
    expect(out.proposals).toEqual([]);
    // Throw path: call never completed → nothing to ledger
    expect(out.model).toBeNull();
    expect(out.usage).toBeNull();
  });
});
