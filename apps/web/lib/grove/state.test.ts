import { describe, expect, it } from 'vitest';
import { sanitizeInput, stateFromRow, answersForSave } from './state';
import { initialUnderstandingState } from '@nibbin/keeper';

describe('stateFromRow', () => {
  it('a missing row is a fresh grove', () => {
    expect(stateFromRow(null, null)).toEqual({
      step: 'ask_user_name',
      userName: null,
      keeperName: null,
      answers: {},
      understanding: null,
      profile: null,
    });
  });

  it('maps a healthy row through', () => {
    const state = stateFromRow(
      {
        keeper_name: 'Bramble',
        onboarding_step: 'understand',
        answers: { craft: 'Photographer', channels: ['email'] },
      },
      'June',
    );
    expect(state).toEqual({
      step: 'understand',
      userName: 'June',
      keeperName: 'Bramble',
      answers: { craft: 'Photographer', channels: ['email'] },
      understanding: null,
      profile: null,
    });
  });

  it('a damaged row degrades safely instead of crashing the turn', () => {
    const state = stateFromRow(
      {
        keeper_name: '   ',
        onboarding_step: 'become_admin',
        answers: { craft: 42, channels: ['email', 'carrier_pigeon', 7], extra: 'x'.repeat(10_000) },
      },
      null,
    );
    expect(state.step).toBe('ask_user_name');
    expect(state.keeperName).toBeNull();
    expect(state.answers).toEqual({ channels: ['email'] });
  });

  it('bounds oversized stored answers', () => {
    const state = stateFromRow(
      { keeper_name: 'B', onboarding_step: 'done', answers: { craft: 'x'.repeat(5000) } },
      null,
    );
    expect(state.answers.craft!.length).toBeLessThanOrEqual(300);
  });
});

describe('sanitizeInput', () => {
  it('keeps only the known fields with the right types', () => {
    expect(
      sanitizeInput({ text: 'hello', skip: 'yes', channels: ['email', 9, 'calls'], evil: true }),
    ).toEqual({ text: 'hello', channels: ['email', 'calls'] });
  });

  it('tolerates garbage', () => {
    expect(sanitizeInput(null)).toEqual({});
    expect(sanitizeInput('boo')).toEqual({});
    expect(sanitizeInput(undefined)).toEqual({});
  });

  it('caps text length', () => {
    expect(sanitizeInput({ text: 'x'.repeat(50_000) }).text!.length).toBe(2000);
  });
});

describe('understanding persistence', () => {
  it('round-trips understanding state through the answers jsonb', () => {
    const understanding = initialUnderstandingState();
    const saved = answersForSave({ answers: {}, understanding, profile: null });
    const row = { keeper_name: 'Bramble', onboarding_step: 'understand', answers: saved };
    const state = stateFromRow(row, 'June');
    expect(state.step).toBe('understand');
    expect(state.understanding?.currentQuestion.prompt).toBe(understanding.currentQuestion.prompt);
    expect(state.understanding?.askedCount).toBe(0);
  });

  it('returns null understanding for a legacy row without the reserved key', () => {
    const row = { keeper_name: 'Bramble', onboarding_step: 'done', answers: { craft: 'Carpenter' } };
    const state = stateFromRow(row, 'June');
    expect(state.understanding).toBeNull();
  });
});
