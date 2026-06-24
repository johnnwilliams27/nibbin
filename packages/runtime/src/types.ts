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

/* ── Crystallization (Slice 4): a done plan_run → a durable B-spec ───────────
 *
 * `crystallizeTranscript` deterministically extracts the executable
 * `CapabilityStep[]` from a successful Planner transcript (NEVER LLM-authored);
 * `crystallizabilityGate` refuses runs that can't safely recur (fail-closed).
 * The result is either the ordered steps or a specific refusal reason.
 */
export type CrystalRefusal =
  | 'not_done'            // run did not reach `done`
  | 'no_action'           // produced no approved connector action (read-only/research)
  | 'utility_in_path'     // used web.*/scratchpad/memory.retrieve/ask_human (runtime reasoning, not a B-step)
  | 'branching'           // observation-dependent branching the linear extract can't represent
  | 'ungeneralizable'     // a raw atomic pick whose args can't be reduced to a reusable step
  | 'invalid_spec';       // the extracted steps failed validateComposedSpec

export type CrystalResult =
  | { ok: true; steps: CapabilityStep[] }
  | { ok: false; reason: CrystalRefusal; detail?: string };

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
  /** Unix-ms timestamp of the most recent stage change; used to scope routine-approval counts to the current stage tenure (§4.7 #44). */
  stageChangedAt: number;
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
  | { kind: 'completed'; runId: string; resourceConflict?: { capability: string; resourceType: string; resourceId: string; holderNibbin: string }; nudgeSkipped?: { capability: string; resourceKind: string; resourceId: string; reason: 'max_count' | 'too_soon'; floor: boolean } }
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
  | 'stage'             // legacy — kept for any persisted step records referencing the old reason
  | 'observe';          // action level is 'observe' — no output produced (§ action-levels)

/* ── Planner (Slice 3a): mode C — the supervised bounded-ReAct loop ──────────
 *
 * Where the linear interpreter front-loads a fixed `steps[]`, the Planner picks
 * its next tool at runtime over a VALIDATED, pre-provisioned surface. The
 * safety thesis (design §1): provisioning is fixed at plan-preview and can
 * never self-grant; the validator re-runs fail-closed on every pick; every
 * yielded step rides the SAME runner gates (via dispatchStep); web egress is
 * redacted-then-quarantined; the loop is bounded by maxIterations + the
 * existing ceilings + repetition + a no-progress kill; ephemeral (no roster
 * row), but the run is persisted for resume + audit.
 */

/** The fixed utility tools the harness dispatches in-process (distinct from
 *  connector capabilities). A plan's `toolsAllowlist` may include these ids. */
export type PlannerToolId =
  | 'scratchpad.write' | 'scratchpad.read' | 'memory.retrieve' | 'memory.write'
  | 'web.search' | 'web.fetch' | 'ask_human' | 'done';

export interface PlannerTool {
  id: PlannerToolId;
  /** does this tool egress outside the system (web.*) */
  egress: boolean;
  /** JSON-schema-lite for the pick's args (mirrors PrimitiveInputField). */
  argSchema: Record<string, { type: 'number' | 'string' | 'enum' | 'boolean'; required?: boolean; min?: number; max?: number; values?: string[] }>;
}

export interface PlanSpec {
  kind: 'plan';
  ephemeral: true;
  goal: string;
  /** narrative, for preview only — never executed */
  intendedSteps: string[];
  /** connector capability ids + PlannerToolId + computer_use.* — the provisioned surface */
  toolsAllowlist: string[];
  requiredConnectors: string[];
  /**
   * `frontier` for a free-orchestration plan over vetted connector/utility
   * tools; `computer_use` (10×) when the plan provisions any computer_use.*
   * (browser) verb (design §3 table: "computer_use (free orchestration /
   * browser)"). validatePlanSpec REQUIRES `computer_use` whenever the allowlist
   * contains a computer_use capability.
   */
  weightClass: 'frontier' | 'computer_use';
  ceilings: RunCeilings & { maxIterations: number };
  personaPolicy?: PersonaPolicy;
}

export interface PendingRequest {
  requestId: string;
  kind: 'auth' | 'decision' | 'value' | 'approval';
  question: string;
  /** for 'approval': the held DraftStep payload */
  context: Record<string, unknown>;
}

/** One ReAct turn, persisted for resume + audit. */
export interface PlanTurn {
  idx: number;
  pick:
    | { tool: string; args: Record<string, unknown> }
    | { done: true; artifact: unknown }
    | { ask_human: true; kind: PendingRequest['kind']; question: string };
  /** quarantined-wrapped observation or human response, length-capped */
  observation?: string;
}

export interface PlanRunState {
  runId: string;
  accountId: string;
  plan: PlanSpec;
  transcript: PlanTurn[];
  scratchpad: Record<string, string>;
  status: 'running' | 'needs_input' | 'done' | 'failed' | 'killed';
  pending?: PendingRequest;
  artifact?: unknown;
}

/** The Planner-level outcome. (The linear runner's RunResult is unchanged: a
 *  yielded draft still returns `awaiting_approval` from the runner; the harness
 *  wraps that into a plan-level `needs_input(kind:'approval')`.) */
export type PlanOutcome =
  | { kind: 'needs_input'; runId: string; request: PendingRequest }
  | { kind: 'done'; runId: string; artifact: unknown }
  | { kind: 'killed'; runId: string; reason: KillReason | 'max_iterations' | 'no_progress' }
  | { kind: 'failed'; runId: string; error: string };
