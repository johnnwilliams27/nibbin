import { classifyComplexity } from './classifier';
import { dayKey, InMemoryBudgetStore } from './budget';
import { chooseModel } from './reinforce';
import {
  DEFAULT_DAILY_FRONTIER_BUDGET,
  DEFAULT_MODELS,
  DEFAULT_REINFORCEMENT,
  DEFAULT_TASK_CANDIDATES,
  DEFAULT_TASK_MODELS,
  DEGRADATION_NOTICE,
  TIER_FOR_TASK,
  UNBUDGETED_T2_TASKS,
} from './tiers';
import type {
  BudgetStatus,
  Classification,
  RouteDecision,
  RouteRequest,
  Router,
  RouterConfig,
  RouterOverrides,
  Tier,
} from './types';

function requestedTierFor(req: RouteRequest): { tier: Tier; classification?: Classification } {
  if (req.task === 'chat') {
    const classification = classifyComplexity(req.text ?? '');
    return { tier: classification.tier, classification };
  }
  return { tier: TIER_FOR_TASK[req.task] };
}

function validate(config: RouterConfig): void {
  for (const tier of ['t0', 't1', 't2'] as const) {
    if (!config.models[tier] || config.models[tier].trim() === '') {
      throw new Error(`router config: missing model for ${tier}`);
    }
  }
  for (const [task, model] of Object.entries(config.taskModels)) {
    if (!model || model.trim() === '') {
      throw new Error(`router config: empty task-model pin for ${task}`);
    }
  }
  if (!Number.isInteger(config.dailyFrontierBudget) || config.dailyFrontierBudget < 0) {
    throw new Error('router config: dailyFrontierBudget must be a non-negative integer');
  }
}

export function createRouter(overrides: RouterOverrides = {}): Router {
  const config: RouterConfig = {
    models: { ...DEFAULT_MODELS, ...overrides.models },
    taskModels: { ...DEFAULT_TASK_MODELS, ...overrides.taskModels },
    taskCandidates: { ...DEFAULT_TASK_CANDIDATES, ...overrides.taskCandidates },
    reinforcement: { ...DEFAULT_REINFORCEMENT, ...overrides.reinforcement },
    performance: overrides.performance,
    dailyFrontierBudget: overrides.dailyFrontierBudget ?? DEFAULT_DAILY_FRONTIER_BUDGET,
    budgetStore: overrides.budgetStore ?? new InMemoryBudgetStore(),
    now: overrides.now ?? (() => new Date()),
  };
  validate(config);

  return {
    get config() {
      return config;
    },

    reconfigure(patch) {
      const next: RouterConfig = {
        ...config,
        models: { ...config.models, ...patch.models },
        taskModels: { ...config.taskModels, ...patch.taskModels },
        taskCandidates: { ...config.taskCandidates, ...patch.taskCandidates },
        reinforcement: { ...config.reinforcement, ...patch.reinforcement },
        dailyFrontierBudget: patch.dailyFrontierBudget ?? config.dailyFrontierBudget,
      };
      validate(next);
      config.models = next.models;
      config.taskModels = next.taskModels;
      config.taskCandidates = next.taskCandidates;
      config.reinforcement = next.reinforcement;
      config.dailyFrontierBudget = next.dailyFrontierBudget;
    },

    async route(req: RouteRequest): Promise<RouteDecision> {
      if (!req.userId || req.userId.trim() === '') {
        throw new Error('route: userId is required');
      }
      const { tier: requestedTier, classification } = requestedTierFor(req);
      // The static, config-pinned model for a tier: the task pin (the Opus
      // diagnosis pin) when serving the requested tier, else the tier default.
      // A degraded request serves the plain tier default — no task pin.
      const staticModelFor = (tier: Tier): string =>
        (tier === requestedTier ? config.taskModels[req.task] : undefined) ?? config.models[tier];

      // The model actually served, after reinforcement. Reinforcement applies
      // ONLY when serving the REQUESTED tier: the candidate set is an
      // eval-cleared allowlist vetted for THIS task at THIS tier, so a budget
      // degradation to a lower tier serves that lower tier's plain default
      // unchanged (matches the existing degrade-to-tier-default semantics).
      //
      // Candidate set = the explicit per-task allowlist if configured, else a
      // single-element set seeded from the static model. With one candidate,
      // OR no performance source, OR insufficient data, chooseModel returns the
      // first element = the static model — byte-for-byte today's behavior. The
      // static model is FORCED to lead the seeded/default set so it is always
      // the guaranteed fallback (reinforcement only ever shifts AMONG the set).
      const modelFor = (tier: Tier): string => {
        const staticModel = staticModelFor(tier);
        if (tier !== requestedTier) return staticModel;
        const configured = config.taskCandidates[req.task];
        const candidates =
          configured && configured.length > 0
            ? // keep the static (configured) model as the lead/fallback, then
              // the remaining eval-cleared challengers in their listed order.
              [staticModel, ...configured.filter((m) => m !== staticModel)]
            : [staticModel];
        return chooseModel(candidates, req.task, tier, config.performance, config.reinforcement);
      };

      // §6.3 + #24 gate condition: ALL T2 draws the per-user daily frontier
      // budget EXCEPT the two named pipeline splurges (diagnosis synthesis,
      // custom-spec drafting), which carry their own caller-side controls.
      // Origin is caller-claimed, so it alone must never bypass the budget:
      // complex_plan with origin:'pipeline' is budgeted like everything else.
      const unbudgeted = req.origin === 'pipeline' && UNBUDGETED_T2_TASKS.has(req.task);
      if (requestedTier === 't2' && !unbudgeted) {
        const day = dayKey(config.now(), req.timezone);
        const limit = config.dailyFrontierBudget;
        const take = await config.budgetStore.take(req.userId, day, limit);
        const budget: BudgetStatus = {
          limit,
          used: take.used,
          remaining: Math.max(0, limit - take.used),
          dayKey: day,
        };
        if (take.granted) {
          return {
            tier: 't2',
            model: modelFor('t2'),
            requestedTier,
            degraded: false,
            notice: null,
            classification,
            budget,
          };
        }
        // At cap: degrade to T1 with transparent phrasing — never silent.
        return {
          tier: 't1',
          model: modelFor('t1'),
          requestedTier,
          degraded: true,
          notice: DEGRADATION_NOTICE,
          classification,
          budget,
        };
      }

      return {
        tier: requestedTier,
        model: modelFor(requestedTier),
        requestedTier,
        degraded: false,
        notice: null,
        classification,
      };
    },
  };
}
