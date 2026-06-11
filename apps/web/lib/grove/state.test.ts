import { describe, expect, it } from 'vitest';
import { sanitizeInput, stateFromRow } from './state';

describe('stateFromRow', () => {
  it('a missing row is a fresh grove', () => {
    expect(stateFromRow(null, null)).toEqual({
      step: 'ask_user_name',
      userName: null,
      keeperName: null,
      answers: {},
    });
  });

  it('maps a healthy row through', () => {
    const state = stateFromRow(
      {
        keeper_name: 'Bramble',
        onboarding_step: 'q_time',
        answers: { craft: 'Photographer', channels: ['email'] },
      },
      'June',
    );
    expect(state).toEqual({
      step: 'q_time',
      userName: 'June',
      keeperName: 'Bramble',
      answers: { craft: 'Photographer', channels: ['email'] },
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
