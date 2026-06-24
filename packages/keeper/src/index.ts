/**
 * @nibbin/keeper — the Grovekeeper's conversation core (SPEC §4.2).
 *
 * C10 (INVARIANTS): the Grovekeeper holds zero side-effect tools, permanently.
 * This package is pure by construction — state machines and copy in, messages
 * and state out. It performs no IO, exports no tool interface, and must never
 * grow one. Side-effectful work belongs to specialists, gated by Agent School
 * at the runtime layer (M4) — never here.
 */
export {
  advanceOnboarding,
  initialOnboardingState,
  isOnboardingComplete,
  nextStepStage,
  ONBOARDING_STEPS,
  turnForState,
} from './onboarding';
export type { NextStepStage } from './onboarding';
export { NEXT_STEP } from './copy';
export { CHAT_INPUT_MAX, keeperChat } from './chat';
export type { KeeperChatContext, KeeperChatDeps, KeeperChatReply } from './chat';
export { buildKeeperContext, KEEPER_SYSTEM_PROMPT } from './prompt';
export {
  SYNTHESIS_SYSTEM_PROMPT,
  buildSynthesisInput,
} from './synthesis-prompt';
export type { SynthesisPassage } from './synthesis-prompt';
export type { KeeperPromptContext } from './prompt';
export { ANSWER_MAX, CHANNEL_CHIPS, DONE, NAME_MAX, SKIP_CHIP } from './copy';
export {
  applyUnderstandingTurn,
  initialUnderstandingState,
  understandingQuestionCard,
  UNDERSTANDING_MAX_TURNS,
  UNDERSTANDING_OPENER,
  skipUnderstanding,
} from './understanding';
export type {
  CelebrationCard,
  ChartCard,
  Citation,
  DraftApprovalCard,
  FieldNotesCard,
  KeeperCard,
  KeeperExpression,
  KeeperMessage,
  KeeperTurn,
  OnboardingAnswers,
  OnboardingInput,
  OnboardingState,
  OnboardingStep,
  PendingProposal,
  PendingQueue,
  PendingRun,
  ProseCard,
  QuestionCard,
  QuestionChip,
  RecommendationCard,
  ScanFindingCard,
  SynthesisCard,
  UnderstandingModelTurn,
  UnderstandingProfile,
  UnderstandingQuestion,
  UnderstandingState,
} from './types';
