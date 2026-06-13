/**
 * Onboarding script — §4.1 steps 2–3 as a pure state machine. The server owns
 * the state (grove_state row); surfaces send user input here and render what
 * comes back. Naming is mandatory (the single strongest ownership mechanic);
 * the understanding phase is driven by applyUnderstandingTurn.
 */
import * as copy from './copy';
import { initialUnderstandingState, understandingQuestionCard } from './understanding';
import type {
  KeeperCard,
  KeeperMessage,
  KeeperTurn,
  OnboardingInput,
  OnboardingState,
  OnboardingStep,
} from './types';

export const ONBOARDING_STEPS: readonly OnboardingStep[] = [
  'ask_user_name',
  'ask_keeper_name',
  'understand',
  'done',
];

export function initialOnboardingState(): OnboardingState {
  return { step: 'ask_user_name', userName: null, keeperName: null, answers: {}, understanding: null, profile: null };
}

export function isOnboardingComplete(state: OnboardingState): boolean {
  return state.step === 'done';
}

let turnSeq = 0;
function msg(card: KeeperCard): KeeperMessage {
  turnSeq = (turnSeq + 1) % Number.MAX_SAFE_INTEGER;
  return { id: `k-${turnSeq}`, from: 'keeper', card };
}

function prose(text: string): KeeperMessage {
  return msg({ kind: 'prose', text, transcript: text });
}

/** Clean a free-text answer: collapse whitespace, strip control characters. */
function cleanText(raw: string | undefined): string {
  return (raw ?? '').replace(/[\u0000-\u001F\u007F]/g, ' ').replace(/\s+/g, ' ').trim();
}

function promptCard(step: OnboardingStep): KeeperMessage[] {
  switch (step) {
    case 'ask_user_name':
      return [
        msg({
          kind: 'question',
          prompt: copy.ASK_USER_NAME.prompt,
          placeholder: copy.ASK_USER_NAME.placeholder,
          skippable: false,
          transcript: copy.ASK_USER_NAME.prompt,
        }),
      ];
    case 'ask_keeper_name':
      return [
        msg({
          kind: 'question',
          prompt: copy.ASK_KEEPER_NAME.prompt,
          placeholder: copy.ASK_KEEPER_NAME.placeholder,
          skippable: false,
          transcript: copy.ASK_KEEPER_NAME.prompt,
        }),
      ];
    case 'understand':
      return []; // standing question is rendered by turnForState via the understanding state
    case 'done':
      return [
        msg({ kind: 'celebration', title: copy.DONE.title, detail: copy.DONE.detail, transcript: `${copy.DONE.title}. ${copy.DONE.detail}` }),
      ];
  }
}

/**
 * The Grovekeeper's standing prompt for the current step â€” used to (re)render
 * a conversation on page load. The hatch ceremony lines lead only when the
 * grove is brand new.
 */
export function turnForState(state: OnboardingState): KeeperTurn {
  const fresh = state.step === 'ask_user_name' && state.userName === null;
  const ceremony = fresh ? [prose(copy.HATCH.greeting), prose(copy.HATCH.introduction)] : [];
  if (state.step === 'understand' && state.understanding) {
    return { state, messages: [understandingQuestionCard(state.understanding.currentQuestion)], expression: 'presenting' };
  }
  return {
    state,
    messages: [...ceremony, ...promptCard(state.step)],
    expression: state.step === 'done' ? 'idle' : 'presenting',
  };
}

function retryTurn(state: OnboardingState, text: string): KeeperTurn {
  return { state, messages: [prose(text), ...promptCard(state.step)], expression: 'concerned' };
}

/**
 * Advance the script with the user's input. Pure: same state + input, same
 * turn (message ids aside). Invalid input never advances â€” the Grovekeeper
 * asks again, gently.
 */
export function advanceOnboarding(state: OnboardingState, input: OnboardingInput): KeeperTurn {
  const text = cleanText(input.text);

  switch (state.step) {
    case 'ask_user_name': {
      if (input.skip || text.length === 0) return retryTurn(state, copy.ASK_USER_NAME.retry);
      if (text.length > copy.NAME_MAX) return retryTurn(state, copy.ASK_USER_NAME.tooLong);
      const next: OnboardingState = { ...state, userName: text, step: 'ask_keeper_name' };
      return {
        state: next,
        messages: [prose(copy.ASK_USER_NAME.ack(text)), ...promptCard('ask_keeper_name')],
        expression: 'presenting',
      };
    }

    case 'ask_keeper_name': {
      if (input.skip || text.length === 0) return retryTurn(state, copy.ASK_KEEPER_NAME.retry);
      if (text.length > copy.NAME_MAX) return retryTurn(state, copy.ASK_KEEPER_NAME.tooLong);
      const understanding = initialUnderstandingState();
      const next: OnboardingState = { ...state, keeperName: text, step: 'understand', understanding };
      return {
        state: next,
        messages: [
          msg({ kind: 'celebration', title: copy.ASK_KEEPER_NAME.ack(text), detail: '', transcript: copy.ASK_KEEPER_NAME.ack(text) }),
          understandingQuestionCard(understanding.currentQuestion),
        ],
        expression: 'delighted',
      };
    }

    case 'understand':
      // Driven by the web action via applyUnderstandingTurn (needs the model);
      // advanceOnboarding is a no-op here so a stray call can't corrupt state.
      return { state, messages: [], expression: 'idle' };

    case 'done':
      // Nothing to advance — callers should be in freeform chat by now.
      return { state, messages: [], expression: 'idle' };
  }
}
