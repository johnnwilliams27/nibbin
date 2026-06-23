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
  it('returns [] when no model is configured (null generate)', async () => {
    expect(await deriveProposalsFromObservation(summary, null)).toEqual([]);
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
    expect(out).toHaveLength(1);
    expect(out[0].field_key).toBe('facts');
    expect(out[0].value).toBe('Design is the primary daily focus.');
  });

  it('returns [] on a non-JSON / garbage model response (graceful)', async () => {
    const gen = async () => ({
      text: 'sorry, cannot help with that',
      usage: { inputTokens: 1, cacheWriteTokens: 0, cacheReadTokens: 0, outputTokens: 1 },
      stopReason: 'end_turn',
      model: 'claude-haiku-4-5',
    });
    expect(await deriveProposalsFromObservation(summary, gen as never)).toEqual([]);
  });

  it('returns [] on a thin/empty summary (no events)', async () => {
    const thin: ObservationSummary = {
      ...summary,
      total_events_reviewed: 0,
      active_ms: 0,
      top_apps: [],
      workflow_shapes: [],
    };
    // Even with a working generate, a thin summary must not produce proposals.
    // The function detects thin data via the summary fields and returns [].
    const gen = async () => ({
      text: JSON.stringify([{ field_key: 'facts', value: 'something', rationale: 'r' }]),
      usage: { inputTokens: 1, cacheWriteTokens: 0, cacheReadTokens: 0, outputTokens: 1 },
      stopReason: 'end_turn',
      model: 'claude-haiku-4-5',
    });
    expect(await deriveProposalsFromObservation(thin, gen as never)).toEqual([]);
  });

  it('caps proposals at 3 even if the model returns more', async () => {
    const gen = async () => ({
      text: JSON.stringify([
        { field_key: 'facts', value: 'Fact 1.', rationale: 'r1' },
        { field_key: 'pricing', value: 'Pricing 1.', rationale: 'r2' },
        { field_key: 'policies', value: 'Policy 1.', rationale: 'r3' },
        { field_key: 'faq', value: 'FAQ 1.', rationale: 'r4' }, // 4th — should not pass the Zod .max(3) guard
      ]),
      usage: { inputTokens: 1, cacheWriteTokens: 0, cacheReadTokens: 0, outputTokens: 1 },
      stopReason: 'end_turn',
      model: 'claude-haiku-4-5',
    });
    const out = await deriveProposalsFromObservation(summary, gen as never);
    // modelOut schema is .max(3) — more than 3 proposals → parse failure → []
    expect(out).toEqual([]);
  });

  it('returns [] when generate throws', async () => {
    const gen = async () => { throw new Error('network failure'); };
    expect(await deriveProposalsFromObservation(summary, gen as never)).toEqual([]);
  });
});
