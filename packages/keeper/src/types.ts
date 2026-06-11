/**
 * Grovekeeper conversation types — SPEC §4.2.
 *
 * C10 (INVARIANTS): the Grovekeeper has no hands. Nothing in this package can
 * perform a side effect — every export is a pure function over state and
 * input that returns messages for a surface to render and a state for a
 * caller to persist. There is no tool interface here to misuse, and none may
 * ever be added.
 */

/** Engine poses, CSS-animated by the chat surface (§4.2). */
export type KeeperExpression =
  | 'idle'
  | 'listening'
  | 'thinking'
  | 'presenting'
  | 'delighted'
  | 'concerned';

/** A selectable chip on a question card. */
export interface QuestionChip {
  id: string;
  label: string;
}

interface CardBase {
  /**
   * Plain-text equivalent of the whole card — accessibility parity (§4.2):
   * every card must read completely as a transcript line. Required on every
   * card kind by construction.
   */
  transcript: string;
}

export interface ProseCard extends CardBase {
  kind: 'prose';
  text: string;
}

export interface QuestionCard extends CardBase {
  kind: 'question';
  prompt: string;
  /** Optional pre-canned choices; free text is always allowed alongside. */
  chips?: QuestionChip[];
  /** Chips select multiple (channels question). */
  multi?: boolean;
  skippable: boolean;
  placeholder?: string;
}

export interface CelebrationCard extends CardBase {
  kind: 'celebration';
  title: string;
  detail: string;
}

/* ── Card kinds the scan/shop/runtime fill in from M4 on. Typed now so the
      card system is complete (§4.2); surfaces render them generically until
      their milestones land. ─────────────────────────────────────────────── */

export interface ScanFindingCard extends CardBase {
  kind: 'scan_finding';
  title: string;
  detail: string;
  stat?: { value: string; label: string };
}

export interface RecommendationCard extends CardBase {
  kind: 'recommendation';
  title: string;
  detail: string;
  /** "Scout could handle ~14 of your 19 weekly inquiry replies" */
  math: string;
  adoptLabel: string;
}

export interface DraftApprovalCard extends CardBase {
  kind: 'draft_approval';
  specialistName: string;
  title: string;
  draft: string;
}

export interface FieldNotesCard extends CardBase {
  kind: 'field_notes';
  title: string;
  detail: string;
}

export interface ChartCard extends CardBase {
  kind: 'chart';
  chart: 'sparkline' | 'bars';
  label: string;
  points: Array<{ label: string; value: number }>;
}

export type KeeperCard =
  | ProseCard
  | QuestionCard
  | CelebrationCard
  | ScanFindingCard
  | RecommendationCard
  | DraftApprovalCard
  | FieldNotesCard
  | ChartCard;

export interface KeeperMessage {
  id: string;
  from: 'keeper';
  card: KeeperCard;
}

/** What the Grovekeeper says next, how it stands, and what to persist. */
export interface KeeperTurn {
  state: OnboardingState;
  messages: KeeperMessage[];
  expression: KeeperExpression;
}

/* ── Onboarding (§4.1 steps 2–3) ─────────────────────────────────────────── */

export type OnboardingStep =
  | 'ask_user_name'
  | 'ask_keeper_name'
  | 'q_craft'
  | 'q_time'
  | 'q_channels'
  | 'done';

export interface OnboardingAnswers {
  craft?: string;
  timeSinks?: string;
  channels?: string[];
}

export interface OnboardingState {
  step: OnboardingStep;
  userName: string | null;
  keeperName: string | null;
  answers: OnboardingAnswers;
}

export interface OnboardingInput {
  text?: string;
  skip?: boolean;
  /** Selected chip ids for the channels question. */
  channels?: string[];
}
