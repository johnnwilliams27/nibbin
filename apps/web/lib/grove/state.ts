/**
 * Mapping between the grove_state row and the keeper package's onboarding
 * state. The row is the durable truth; this module re-validates everything on
 * the way in so a damaged or hostile row can never crash a turn or smuggle
 * unbounded data back into the conversation.
 */
import {
  ANSWER_MAX,
  CHANNEL_CHIPS,
  initialOnboardingState,
  NAME_MAX,
  ONBOARDING_STEPS,
  type OnboardingAnswers,
  type OnboardingInput,
  type OnboardingState,
  type OnboardingStep,
} from '@nibbin/keeper';

export interface GroveRow {
  keeper_name: string | null;
  onboarding_step: string;
  answers: unknown;
}

function parseAnswers(raw: unknown): OnboardingAnswers {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return {};
  const o = raw as Record<string, unknown>;
  const out: OnboardingAnswers = {};
  if (typeof o.craft === 'string' && o.craft.trim() !== '') out.craft = o.craft.slice(0, ANSWER_MAX);
  if (typeof o.timeSinks === 'string' && o.timeSinks.trim() !== '') out.timeSinks = o.timeSinks.slice(0, ANSWER_MAX);
  if (Array.isArray(o.channels)) {
    const valid = new Set(CHANNEL_CHIPS.map((c) => c.id));
    const channels = o.channels.filter((c): c is string => typeof c === 'string' && valid.has(c));
    if (channels.length > 0) out.channels = channels.slice(0, CHANNEL_CHIPS.length);
  }
  return out;
}

export function stateFromRow(row: GroveRow | null, userName: string | null): OnboardingState {
  if (!row) return { ...initialOnboardingState(), userName };
  const step: OnboardingStep = (ONBOARDING_STEPS as readonly string[]).includes(row.onboarding_step)
    ? (row.onboarding_step as OnboardingStep)
    : 'ask_user_name';
  const keeperName =
    typeof row.keeper_name === 'string' && row.keeper_name.trim() !== ''
      ? row.keeper_name.slice(0, NAME_MAX)
      : null;
  return { step, userName, keeperName, answers: parseAnswers(row.answers) };
}

/** Shape-check client input before it reaches the state machine. */
export function sanitizeInput(raw: unknown): OnboardingInput {
  const o = typeof raw === 'object' && raw !== null ? (raw as Record<string, unknown>) : {};
  const input: OnboardingInput = {};
  if (typeof o.text === 'string') input.text = o.text.slice(0, 2000);
  if (o.skip === true) input.skip = true;
  if (Array.isArray(o.channels)) {
    input.channels = o.channels.filter((c): c is string => typeof c === 'string').slice(0, 12);
  }
  return input;
}
