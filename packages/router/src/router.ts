import { classifyComplexity } from './classifier';
import { dayKey, InMemoryBudgetStore } from './budget';
import { DEFAULT_DAILY_FRONTIER_BUDGET, DEFAULT_MODELS, DEGRADATION_NOTICE, TIER_FOR_TASK } from './tiers';
import type {
  BudgetStatus,
  Classification,
  RouteDecision,
  RouteRequest,
  Router,
  RouterConfig,
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
  if (!Number.isInteger(config.dailyFrontierBudget) || config.dailyFrontierBudget < 0) {
    throw new Error('router config: dailyFrontierBudget must be a non-negative integer');
  }
}

export function createRouter(overrides: Partial<RouterConfig> = {}): Router {
  const config: RouterConfig = {
    models: { ...DEFAULT_MODELS, ...overrides.models },
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
        dailyFrontierBudget: patch.dailyFrontierBudget ?? config.dailyFrontierBudget,
      };
      validate(next);
      config.models = next.models;
      config.dailyFrontierBudget = next.dailyFrontierBudget;
    },

    async route(req: RouteRequest): Promise<RouteDecision> {
      if (!req.userId || req.userId.trim() === '') {
        throw new Error('route: userId is required');
      }
      const { tier: requestedTier, classification } = requestedTierFor(req);

      // §6.3: only T2 reached *from chat* draws the per-user daily frontier
      // budget. Pipeline T2 (diagnosis synthesis, custom-spec drafting) is the
      // deliberate splurge and is never degraded here.
      if (requestedTier === 't2' && req.origin === 'chat') {
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
            model: config.models.t2,
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
          model: config.models.t1,
          requestedTier,
          degraded: true,
          notice: DEGRADATION_NOTICE,
          classification,
          budget,
        };
      }

      return {
        tier: requestedTier,
        model: config.models[requestedTier],
        requestedTier,
        degraded: false,
        notice: null,
        classification,
      };
    },
  };
}
