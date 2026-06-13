import { describe, expect, it } from 'vitest';
import {
  applyUnderstandingTurn,
  initialUnderstandingState,
  UNDERSTANDING_MAX_TURNS,
  UNDERSTANDING_OPENER,
} from '../src/understanding';
import { ONBOARDING_STEPS } from '../src/index';
import type { OnboardingState, UnderstandingModelTurn } from '../src/types';

function understandingState(): OnboardingState {
  return {
    step: 'understand',
    userName: 'June',
    keeperName: 'Bramble',
    answers: {},
    understanding: initialUnderstandingState(),
    profile: null,
  };
}

const modelContinue: UnderstandingModelTurn = {
  extraction: { jobTitle: 'wedding photographer', businessModel: 'bookings' },
  nextQuestion: { prompt: 'Where does most of your work come from?', placeholder: 'Referrals, Instagram…' },
  confidence: 0.4,
};

describe('applyUnderstandingTurn — extraction + counting', () => {
  it('merges the model extraction into the profile and records the turn', () => {
    const state = understandingState();
    const turn = applyUnderstandingTurn(state, 'I shoot weddings', modelContinue);
    const u = turn.state.understanding!;
    expect(u.profile.jobTitle).toBe('wedding photographer');
    expect(u.profile.businessModel).toBe('bookings');
    expect(u.profile.raw.at(-1)).toEqual({ q: state.understanding!.currentQuestion.prompt, a: 'I shoot weddings' });
    expect(u.askedCount).toBe(1);
  });

  it('advances to the model-supplied next question when not yet done', () => {
    const turn = applyUnderstandingTurn(understandingState(), 'I shoot weddings', modelContinue);
    expect(turn.state.step).toBe('understand');
    expect(turn.state.understanding!.currentQuestion.prompt).toBe('Where does most of your work come from?');
    expect(turn.messages.at(-1)!.card.kind).toBe('question');
  });

  it('does not mutate the input state (purity)', () => {
    const state = understandingState();
    const frozen = JSON.parse(JSON.stringify(state));
    applyUnderstandingTurn(state, 'I shoot weddings', modelContinue);
    expect(state).toEqual(frozen);
  });
});

it('the cap constant is 5', () => {
  expect(UNDERSTANDING_MAX_TURNS).toBe(5);
});

function runTurns(start: OnboardingState, turns: Array<UnderstandingModelTurn | null>): OnboardingState {
  let state = start;
  for (const [i, mt] of turns.entries()) {
    state = applyUnderstandingTurn(state, `answer ${i}`, mt).state;
  }
  return state;
}

describe('applyUnderstandingTurn — termination', () => {
  it('stops when the model returns nextQuestion: null', () => {
    const done = applyUnderstandingTurn(understandingState(), 'x', {
      extraction: {}, nextQuestion: null, confidence: 0.3,
    });
    expect(done.state.step).toBe('done');
    expect(done.state.profile).not.toBeNull();
    expect(done.messages.at(-1)!.card.kind).toBe('celebration');
  });

  it('stops when confidence reaches 0.75', () => {
    const done = applyUnderstandingTurn(understandingState(), 'x', {
      extraction: { confidence: 0.8 }, nextQuestion: { prompt: 'more?', placeholder: '' }, confidence: 0.8,
    });
    expect(done.state.step).toBe('done');
  });

  it('the cap wins over the model — a 5th turn ends even if the model wants more', () => {
    const keepGoing: UnderstandingModelTurn = {
      extraction: {}, nextQuestion: { prompt: 'and?', placeholder: '' }, confidence: 0.1,
    };
    const state = runTurns(understandingState(), [keepGoing, keepGoing, keepGoing, keepGoing]);
    expect(state.step).toBe('understand');
    expect(state.understanding!.askedCount).toBe(4);
    const fifth = applyUnderstandingTurn(state, 'x', keepGoing);
    expect(fifth.state.understanding!.askedCount).toBe(5);
    expect(fifth.state.step).toBe('done'); // never a 6th question
  });
});

describe('package step list', () => {
  it('ONBOARDING_STEPS reflects the new flow', () => {
    expect([...ONBOARDING_STEPS]).toEqual(['ask_user_name', 'ask_keeper_name', 'understand', 'done']);
  });
});

describe('applyUnderstandingTurn — static fallback (no model)', () => {
  it('serves the fallback questions in order, then ends', () => {
    let state = understandingState();
    expect(state.understanding!.currentQuestion.prompt).toBe(UNDERSTANDING_OPENER.prompt);

    // answer the opener with no model → first fallback question
    const t1 = applyUnderstandingTurn(state, 'Carpenter', null);
    expect(t1.state.step).toBe('understand');
    const q1 = t1.state.understanding!.currentQuestion.prompt;
    expect(q1).not.toBe(UNDERSTANDING_OPENER.prompt);

    // answer the first fallback → second fallback (channels, multi)
    const t2 = applyUnderstandingTurn(t1.state, 'Quotes and scheduling', null);
    expect(t2.state.understanding!.currentQuestion.multi).toBe(true);

    // answer the last fallback → done (fallback exhausted)
    const t3 = applyUnderstandingTurn(t2.state, 'Texts', null);
    expect(t3.state.step).toBe('done');
  });

  it('still records raw answers on the fallback path', () => {
    const t1 = applyUnderstandingTurn(understandingState(), 'Carpenter', null);
    expect(t1.state.understanding!.profile.raw).toEqual([
      { q: UNDERSTANDING_OPENER.prompt, a: 'Carpenter' },
    ]);
  });
});

describe('applyUnderstandingTurn — answer size clamping', () => {
  it('clamps each stored answer to 280 chars regardless of input length', () => {
    const longAnswer = 'x'.repeat(2000);
    const state = understandingState();
    const turn = applyUnderstandingTurn(state, longAnswer, modelContinue);
    const u = turn.state.understanding!;
    // stored in turns
    expect(u.turns.at(-1)!.a.length).toBeLessThanOrEqual(280);
    // stored in profile.raw
    expect(u.profile.raw.at(-1)!.a.length).toBeLessThanOrEqual(280);
  });

  it('five turns each with 2000-char answers stay within bounds', () => {
    const longAnswer = 'y'.repeat(2000);
    const keepGoing: UnderstandingModelTurn = {
      extraction: {}, nextQuestion: { prompt: 'and?', placeholder: '' }, confidence: 0.1,
    };
    const state = runTurns(understandingState(), [keepGoing, keepGoing, keepGoing, keepGoing]);
    const fifth = applyUnderstandingTurn(state, longAnswer, keepGoing);
    // even after cap completion, all stored answers should be <= 280
    const allTurns = fifth.state.understanding!.turns;
    for (const t of allTurns) {
      expect(t.a.length).toBeLessThanOrEqual(280);
    }
  });
});
