/**
 * Agent runtime core types — SPEC §6.2, §4.6, §4.7.
 *
 * The package is pure by construction: every invariant is enforced in
 * functions over injected stores, so the whole runtime is unit-testable
 * without a database. apps/web wires the Supabase-backed stores (whose RPCs
 * re-enforce the money- and trust-critical checks in SQL under per-account
 * serialization — the DB is the last line of defense, this package is the
 * API-layer authority).
 */
import type { WeightClass } from '@nibbin/shared';

/* ── Agent School (§4.7) ──────────────────────────────────────────────────── */

export const STAGES = ['egg', 'student', 'senior', 'grad'] as const;
export type StageName = (typeof STAGES)[number];

export function stageRank(stage: StageName): number {
  return STAGES.indexOf(stage);
}

/* ── Triggers (§6.2) ──────────────────────────────────────────────────────── */

export type TriggerKind = 'user' | 'schedule' | 'event';

export interface TriggerDef {
  kind: TriggerKind;
  /**
   * For kind 'event': where the event comes from.
   *  - `connector:<provider>:<event>` (e.g. connector:gmail:message.received)
   *  - `nibbin:<templateKey>:run.completed` — another Nibbin finishing
   * The trigger-graph validator builds edges from nibbin:* sources; the
   * Grovekeeper may never appear as one (§4.2 terminal hub).
   */
  source?: string;
  /** For kind 'schedule': a named cadence ('daily.morning', 'weekly.monday'). */
  schedule?: string;
  /** Identical events inside this window collapse to one (§6.2 dedupe). */
  debounceSecs?: number;
  /** Minimum seconds between runs of this Nibbin (§6.2 cooldown). */
  cooldownSecs?: number;
}

/* ── Spec (§4.6: spec-versioned templates; custom specs validate the same) ── */

export interface PromotionThresholds {
  /** Rolling window of decided runs. Floor 25 — config may only tighten. */
  windowRuns: number;
  /** Approved-unedited share required. Floor 0.95 — config may only tighten. */
  minApprovedUneditedPct: number;
  /**
   * Distinct routine patterns required for Senior→Grad (R1 coverage). Floor 4
   * — config may only tighten. Optional for back-compat with existing specs;
   * the SQL + mirror default to 4 when absent.
   */
  coverageMinPatterns?: number;
}

export interface CurriculumConfig {
  /** What accuracy is measured against — shown in the shop and School UI. */
  measures: string;
  promotion: PromotionThresholds;
  /**
   * Senior autonomy: a side effect is "routine" only after this many
   * approved-unedited runs of the identical pattern (§4.7 "autonomous on
   * routine patterns repeatedly matched; flags novelty").
   */
  routineMinApprovals: number;
}

export interface RunCeilings {
  maxSteps: number;
  maxTokens: number;
  maxWallClockMs: number;
}

export interface CreditProfile {
  weightClass: WeightClass;
  ceilings: RunCeilings;
}

/**
 * A composed step (Composer/Planner output, §4). `capability` refs
 * CAPABILITY_REGISTRY; the interpreter validates it and yields a ProgramStep
 * the runner gates. `prompt` present = a generative draft (model). Absent for
 * template agents, which run their hand-written program instead.
 */
export interface CapabilityStep {
  capability: string;                  // refs CAPABILITY_REGISTRY
  inputs?: Record<string, unknown>;    // bound args: a read `path`, or draft `effectArgs`
  prompt?: ComposePrompt;              // present = generative draft (model)
  presentation?: boolean;              // no-side-effect presentation draft
  title?: string;
  /**
   * Optional semantic routine-identity for this step (e.g.
   * `email.draft:overdue-followup`). When set, the interpreter uses it
   * verbatim as the step's patternKey so a Composer/author can give two
   * distinct drafts distinct routine-approval identities (§4.7). Absent: the
   * interpreter derives a per-step key (prefix:templateKey#idx) so steps still
   * never collapse into one identity (logic-skeptic P2-3).
   */
  patternKey?: string;
}

export interface PersonaPolicy { voice?: string; tone?: string; brandKit?: string }

export interface AgentSpec {
  /** Shop template key; null for custom hatch-wizard specs. */
  templateKey: string | null;
  version: number;
  displayName: string;
  /** Connector capability ids this Nibbin may use — checked on every step. */
  toolsAllowlist: string[];
  requiredConnectors: string[];
  triggers: TriggerDef[];
  curriculum: CurriculumConfig;
  creditProfile: CreditProfile;
  /** Composed steps (Composer/Planner output). Absent for template agents,
   *  which run their hand-written program. */
  steps?: CapabilityStep[];
  personaPolicy?: PersonaPolicy;
}

/* ── Runs ─────────────────────────────────────────────────────────────────── */

export type RunStatus =
  | 'queued'
  | 'running'
  | 'awaiting_approval'
  | 'completed'
  | 'rejected'
  | 'failed'
  | 'killed';

export interface RunTrigger {
  kind: TriggerKind;
  /** What fired (schedule name, event source). */
  key?: string;
  /** Identity for §6.2 debounce/dedupe. */
  dedupeKey?: string;
}

export interface NibbinRef {
  id: string;
  accountId: string;
  name: string;
  stage: StageName;
  status: 'active' | 'paused' | 'sleeping';
  spec: AgentSpec;
}

export type AdmissionOutcome =
  | { kind: 'started'; runId: string; balance: number }
  | { kind: 'queued_cap'; runId: string; balance: number }
  | { kind: 'deduped' }
  | { kind: 'cooldown' }
  | { kind: 'anomaly_paused' }
  | { kind: 'nibbin_unavailable' };

/* ── Steps the runner executes ────────────────────────────────────────────── */

export interface ReadStep {
  kind: 'read';
  capability: string;
  connectionId: string;
  /** Provider-relative GET path. */
  path: string;
}

/**
 * A compose step may ask the runner for a model draft (M6.5). The runner —
 * never the program — owns the model call: it clamps maxTokens to the run's
 * remaining ceiling pre-call, quarantines the reply before the program sees
 * a byte of it, and records real token counts on the step.
 */
export interface ComposePrompt {
  /** What to produce — stable per pattern (the cacheable voice/rules block lives provider-side). */
  intent: string;
  /** Evidence the model may use. Sanitized/quarantined upstream; data, never instructions. */
  context: string;
  /** Output ceiling for this call; clamped to the spec's remaining token budget. */
  maxTokens?: number;
}

export interface ComposeStep {
  kind: 'compose';
  /** Deterministic composition keeps 0; model composes set real counts via the runner. */
  tokens?: number;
  payload: Record<string, unknown>;
  /** Present = request a model draft; absent = deterministic compose. */
  prompt?: ComposePrompt;
}

export interface DraftStep {
  kind: 'draft';
  capability: string;
  /** Routine-matching identity (§4.7) — same pattern, same key. */
  patternKey: string;
  title: string;
  draft: string;
  /** Args the side effect would execute with, if approved. */
  effectArgs: Record<string, unknown>;
  connectionId?: string;
  /**
   * Presentation drafts (digests, keep-or-clear lists) have NO side effect to
   * execute — they always land as drafts for review at every stage, train
   * accuracy through approvals, and can never reach the effect executor.
   */
  presentation?: boolean;
}

export type ProgramStep = ReadStep | ComposeStep | DraftStep;

export interface StepRecord {
  idx: number;
  kind: 'read' | 'compose' | 'tool' | 'draft' | 'execute';
  tool?: string;
  inputHash?: string;
  model?: string;
  tokens: number;
  payload?: Record<string, unknown>;
}

export type RunResult =
  | { kind: 'awaiting_approval'; runId: string; draft: DraftStep }
  | { kind: 'completed'; runId: string }
  | { kind: 'executed'; runId: string; effect: { capability: string; idempotencyKey: string } }
  | { kind: 'killed'; runId: string; reason: KillReason }
  | { kind: 'failed'; runId: string; error: string };

export type KillReason =
  | 'repetition'        // same-tool-same-args loop kill (§6.2)
  | 'max_steps'
  | 'max_tokens'
  | 'wall_clock'
  | 'allowlist'         // capability outside the spec's tool allowlist
  | 'unquarantined'     // tool output missing quarantine markers (§6.5)
  | 'stage';            // egg attempted output (§4.7: Eggs observe only)
