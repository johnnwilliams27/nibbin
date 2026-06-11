/**
 * Onboarding script â€” Â§4.1 steps 2â€“3 as a pure state machine. The server owns
 * the state (grove_state row); surfaces send user input here and render what
 * comes back. Naming is mandatory (the single strongest ownership mechanic);
 * the three seeding questions are skippable.
 */
import * as copy from './copy';
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
  'q_craft',
  'q_time',
  'q_channels',
  'done',
];

export function initialOnboardingState(): OnboardingState {
  return { step: 'ask_user_name', userName: null, keeperName: null, answers: {} };
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
    case 'q_craft':
      return [
        msg({
          kind: 'question',
          prompt: copy.Q_CRAFT.prompt,
          placeholder: copy.Q_CRAFT.placeholder,
          chips: [copy.SKIP_CHIP],
          skippable: true,
          transcript: `${copy.Q_CRAFT.prompt} (you can skip this)`,
        }),
      ];
    case 'q_time':
      return [
        msg({
          kind: 'question',
          prompt: copy.Q_TIME.prompt,
          placeholder: copy.Q_TIME.placeholder,
          chips: [copy.SKIP_CHIP],
          skippable: true,
          transcript: `${copy.Q_TIME.prompt} (you can skip this)`,
        }),
      ];
    case 'q_channels':
      return [
        msg({
          kind: 'question',
          prompt: copy.Q_CHANNELS.prompt,
          chips: [...copy.CHANNEL_CHIPS, copy.SKIP_CHIP],
          multi: true,
          skippable: true,
          transcript: `${copy.Q_CHANNELS.prompt} Choices: ${copy.CHANNEL_CHIPS.map((c) => c.label).join(', ')} (you can skip this)`,
        }),
      ];
    case 'done':
      return [
        msg({
          kind: 'celebration',
          title: copy.DONE.title,
          detail: copy.DONE.detail,
          transcript: `${copy.DONE.title}. ${copy.DONE.detail}`,
        }),
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
      const next: OnboardingState = { ...state, keeperName: text, step: 'q_craft' };
      return {
        state: next,
        // Naming the Grovekeeper is a first-time event â€” the one place
        // 'delighted' is allowed during onboarding (Â§4.2: used sparingly).
        messages: [
          msg({
            kind: 'celebration',
            title: copy.ASK_KEEPER_NAME.ack(text),
            detail: '',
            transcript: copy.ASK_KEEPER_NAME.ack(text),
          }),
          ...promptCard('q_craft'),
        ],
        expression: 'delighted',
      };
    }

    case 'q_craft': {
      if (input.skip) {
        return {
          state: { ...state, step: 'q_time' },
          messages: [prose(copy.Q_CRAFT.skipAck), ...promptCard('q_time')],
          expression: 'presenting',
        };
      }
      if (text.length === 0) return retryTurn(state, copy.Q_CRAFT.skipAck);
      if (text.length > copy.ANSWER_MAX) return retryTurn(state, copy.Q_CRAFT.tooLong);
      return {
        state: { ...state, step: 'q_time', answers: { ...state.answers, craft: text } },
        messages: [prose(copy.Q_CRAFT.ack), ...promptCard('q_time')],
        expression: 'presenting',
      };
    }

    case 'q_time': {
      if (input.skip) {
        return {
          state: { ...state, step: 'q_channels' },
          messages: [prose(copy.Q_TIME.skipAck), ...promptCard('q_channels')],
          expression: 'presenting',
        };
      }
      if (text.length === 0) return retryTurn(state, copy.Q_TIME.skipAck);
      if (text.length > copy.ANSWER_MAX) return retryTurn(state, copy.Q_TIME.tooLong);
      return {
        state: { ...state, step: 'q_channels', answers: { ...state.answers, timeSinks: text } },
        messages: [prose(copy.Q_TIME.ack), ...promptCard('q_channels')],
        expression: 'presenting',
      };
    }

    case 'q_channels': {
      const valid = new Set(copy.CHANNEL_CHIPS.map((c) => c.id));
      const picked = (input.channels ?? []).filter((c) => valid.has(c)).slice(0, copy.CHANNEL_CHIPS.length);
      if (input.skip || picked.length === 0) {
        return {
          state: { ...state, step: 'done' },
          messages: [prose(copy.Q_CHANNELS.skipAck), ...promptCard('done')],
          expression: 'presenting',
        };
      }
      return {
        state: { ...state, step: 'done', answers: { ...state.answers, channels: picked } },
        messages: [prose(copy.Q_CHANNELS.ack), ...promptCard('done')],
        expression: 'presenting',
      };
    }

    case 'done':
      // Nothing to advance â€” callers should be in freeform chat by now.
      return { state, messages: [], expression: 'idle' };
  }
}
