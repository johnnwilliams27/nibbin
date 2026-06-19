/**
 * Public interface of the LLM router — SPEC §6.3. M4 (agent runtime) consumes
 * this exact surface; changes here are interface changes, not refactors.
 */

/** Routing tiers per the §6.3 table. */
export type Tier = 't0' | 't1' | 't2';

/**
 * Every routed unit of work names its task. The §6.3 table maps known task
 * types to tiers deterministically; freeform Grovekeeper `chat` is the one
 * task whose tier is decided by the complexity classifier.
 */
export type RoutedTask =
  // T0 — local/open-weight + smallest API class
  | 'chat'
  | 'smalltalk'
  | 'intent_classification'
  | 'routing'
  | 'formatting'
  | 'field_notes_copy'
  | 'journal_phrasing'
  | 'style_extraction'
  // T1 — mid (Sonnet-class)
  | 'specialist_draft'
  | 'scan_synthesis'
  | 'training_feedback'
  | 'map_labeling'
  | 'onboarding_understanding'
  | 'sweep_pass1'
  | 'sweep_pass2'
  | 'memory_extract'
  // T2 — frontier (Opus/Fable-class)
  | 'diagnosis_synthesis'
  | 'custom_spec_draft'
  | 'nibbin_note'
  | 'complex_plan'
  | 'plan_synthesis';

/**
 * Where the request came from. Only `chat`-origin T2 grants draw down the
 * per-user daily frontier budget (§6.3: "T2 access from chat is budgeted per
 * user per day"). Pipeline work — diagnosis synthesis, custom-spec drafting —
 * is budgeted by its own controls, never silently degraded: the diagnosis is
 * the one deliberate splurge.
 */
export type RouteOrigin = 'chat' | 'pipeline';

export interface RouteRequest {
  /** The user on whose behalf the work runs — keys the frontier budget. */
  userId: string;
  task: RoutedTask;
  origin: RouteOrigin;
  /** Freeform text; required when task is 'chat' (the classifier reads it). */
  text?: string;
  /** IANA timezone for the user's budget day; defaults to UTC. */
  timezone?: string;
}

/** What the T0 complexity classifier concluded about a chat request. */
export interface Classification {
  tier: Tier;
  /** 0..1 — higher means more complex. */
  score: number;
  /** Human-readable signals that contributed (for COGS dashboards, M8). */
  signals: string[];
}

export interface BudgetStatus {
  limit: number;
  used: number;
  remaining: number;
  /** The user-local calendar day this budget window covers (YYYY-MM-DD). */
  dayKey: string;
}

/**
 * A routing decision. `degraded` is never silent: when true, `notice` carries
 * the user-facing phrasing the surface must show.
 */
export interface RouteDecision {
  /** Tier actually granted. */
  tier: Tier;
  /** Model id resolved from config for the granted tier. */
  model: string;
  /** Tier the task/classifier asked for, before budget enforcement. */
  requestedTier: Tier;
  degraded: boolean;
  /** Present exactly when degraded — transparent phrasing, never null then. */
  notice: string | null;
  /** Present when the classifier ran (task === 'chat'). */
  classification?: Classification;
  /** Present when the frontier budget was consulted. */
  budget?: BudgetStatus;
}

/**
 * Per-user daily frontier budget store. `take` must be atomic per
 * (userId, dayKey): grant and increment in one step, deny at the limit.
 * The in-memory implementation suits a single server process; a durable
 * store slots in here when the agent runtime lands (M4).
 */
export interface BudgetStore {
  take(userId: string, dayKey: string, limit: number): Promise<{ granted: boolean; used: number }>;
  used(userId: string, dayKey: string): Promise<number>;
}

/**
 * Reinforcement weighting parameters (§4B "quality-within-budget"). Thin and
 * deterministic — NOT ML. Defaults live in tiers.ts (`DEFAULT_REINFORCEMENT`).
 */
export interface ReinforcementParams {
  /** Min decided (human-rated) calls before a candidate is actionable. */
  minDecidedCalls: number;
  /** Min approved-unedited rate to be quality-eligible at all (0..1). */
  qualityBar: number;
  /** P8 tie-break band: rates within this of the best are "as good" (0..1). */
  qualityTolerance: number;
  /** Hard exclusion: drop a candidate refusing/erroring above this (0..1). */
  maxRefusalErrorRate: number;
}

/**
 * One model's measured performance for a (task, tier) over the policy window,
 * derived from the Slice-A `model_task_performance` substrate. Rates are
 * pre-divided in the read layer; `avgCostMicroUsd` is the P8 cost signal.
 * `decidedCalls` is the human-rated subset that gates the min-volume floor.
 */
export interface PerfStat {
  /** Total calls in the window (volume; not all are human-decided). */
  calls: number;
  /** Calls that carried a run_id + an approval (the quality denominator). */
  decidedCalls: number;
  /** approved_unedited / decidedCalls, 0..1. 0 when decidedCalls is 0. */
  approvedUneditedRate: number;
  /** (refusals + errors) / calls, 0..1. The degradation/churn signal. */
  refusalErrorRate: number;
  /** Average cost per call in micro-USD — the cost-aware (P8) tie-break. */
  avgCostMicroUsd: number;
}

/**
 * A read-only snapshot the router consults to reinforce among eval-cleared
 * candidates. Synchronous + pure: `route()` stays cheap and deterministic; the
 * caller (apps/web) refreshes the snapshot out-of-band from
 * `model_task_performance`. Returns undefined when there is no row for the
 * (model, task, tier) — the router treats that as "no data", which falls back
 * to the configured default. A router with NO source (the default) never
 * reweights — behavior is exactly the static config.
 */
export interface PerformanceSource {
  getPerformance(model: string, task: RoutedTask, tier: Tier): PerfStat | undefined;
}

export interface RouterConfig {
  /** Model id per tier — hot-reloadable via Router.reconfigure (ENVIRONMENT). */
  models: Record<Tier, string>;
  /**
   * Per-task pins overriding the tier default (the Opus diagnosis pin lives
   * here). Hot-reloadable; model changes gate on the eval suite.
   */
  taskModels: Partial<Record<RoutedTask, string>>;
  /**
   * Per-task ORDERED candidate sets — the eval-cleared allowlist reinforcement
   * may shift traffic among. A task absent here (or with one entry) is seeded
   * from the configured model and never reweights. Hot-reloadable.
   */
  taskCandidates: Partial<Record<RoutedTask, readonly string[]>>;
  /** Quality-within-budget weighting params (min-volume floor, cost tie-break). */
  reinforcement: ReinforcementParams;
  /**
   * Optional performance snapshot the policy reads. Absent (the default) ⇒ no
   * reinforcement, exactly the static config. Injected as a fake in tests; in
   * apps/web it is backed by `model_task_performance` (staff/service read).
   */
  performance?: PerformanceSource;
  /** T2-from-chat grants per user per day. */
  dailyFrontierBudget: number;
  budgetStore: BudgetStore;
  /** Injectable clock for tests. */
  now: () => Date;
}

/** Construction/reconfiguration input — sparse maps merge over defaults. */
export interface RouterOverrides {
  models?: Partial<Record<Tier, string>>;
  taskModels?: Partial<Record<RoutedTask, string>>;
  taskCandidates?: Partial<Record<RoutedTask, readonly string[]>>;
  reinforcement?: Partial<ReinforcementParams>;
  performance?: PerformanceSource;
  dailyFrontierBudget?: number;
  budgetStore?: BudgetStore;
  now?: () => Date;
}

export interface Router {
  route(req: RouteRequest): Promise<RouteDecision>;
  /** Hot-reload models/candidates/budget without dropping budget state. */
  reconfigure(
    patch: Pick<
      RouterOverrides,
      'models' | 'taskModels' | 'taskCandidates' | 'reinforcement' | 'dailyFrontierBudget'
    >,
  ): void;
  readonly config: Readonly<RouterConfig>;
}
