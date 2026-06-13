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
  // T1 — mid (Sonnet-class)
  | 'specialist_draft'
  | 'scan_synthesis'
  | 'training_feedback'
  | 'map_labeling'
  | 'onboarding_understanding'
  // T2 — frontier (Opus/Fable-class)
  | 'diagnosis_synthesis'
  | 'custom_spec_draft'
  | 'complex_plan';

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

export interface RouterConfig {
  /** Model id per tier — hot-reloadable via Router.reconfigure (ENVIRONMENT). */
  models: Record<Tier, string>;
  /**
   * Per-task pins overriding the tier default (the Opus diagnosis pin lives
   * here). Hot-reloadable; model changes gate on the eval suite.
   */
  taskModels: Partial<Record<RoutedTask, string>>;
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
  dailyFrontierBudget?: number;
  budgetStore?: BudgetStore;
  now?: () => Date;
}

export interface Router {
  route(req: RouteRequest): Promise<RouteDecision>;
  /** Hot-reload models/budget without dropping budget state. */
  reconfigure(patch: Pick<RouterOverrides, 'models' | 'taskModels' | 'dailyFrontierBudget'>): void;
  readonly config: Readonly<RouterConfig>;
}
