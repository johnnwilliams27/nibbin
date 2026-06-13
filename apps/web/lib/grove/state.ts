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
  type UnderstandingProfile,
  type UnderstandingState,
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

function emptyProfileFallback(): UnderstandingProfile {
  return { jobTitle: null, businessModel: 'unknown', workShape: [], channels: [], tools: [], pains: [], confidence: 0, raw: [] };
}

function parseUnderstanding(raw: unknown): UnderstandingState | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const o = raw as Record<string, unknown>;
  const u = o._understanding;
  if (typeof u !== 'object' || u === null) return null;
  // trust-but-bound: the row is the user's own; re-validate shape, clamp sizes.
  const s = u as Partial<UnderstandingState>;
  if (!s.currentQuestion || typeof (s.currentQuestion as { prompt?: unknown }).prompt !== 'string') return null;
  return {
    turns: Array.isArray(s.turns) ? s.turns.slice(0, 5) as UnderstandingState['turns'] : [],
    profile: (s.profile ?? null) as UnderstandingState['profile'] ?? emptyProfileFallback(),
    askedCount: typeof s.askedCount === 'number' ? Math.max(0, Math.min(5, s.askedCount)) : 0,
    fallbackIndex: typeof s.fallbackIndex === 'number' ? Math.max(0, s.fallbackIndex) : 0,
    currentQuestion: s.currentQuestion as UnderstandingState['currentQuestion'],
  };
}

function parseProfile(raw: unknown): UnderstandingProfile | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const p = (raw as Record<string, unknown>)._profile;
  return typeof p === 'object' && p !== null ? (p as UnderstandingProfile) : null;
}

interface SaveShape {
  answers: OnboardingAnswers;
  understanding: UnderstandingState | null;
  profile: UnderstandingProfile | null;
}

/** Pack the legacy answers + understanding + profile into the answers jsonb. */
export function answersForSave(s: SaveShape): Record<string, unknown> {
  const out: Record<string, unknown> = { ...s.answers };
  if (s.understanding) out._understanding = s.understanding;
  if (s.profile) out._profile = s.profile;
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
  return {
    step,
    userName,
    keeperName,
    answers: parseAnswers(row.answers),
    understanding: parseUnderstanding(row.answers),
    profile: parseProfile(row.answers),
  };
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
