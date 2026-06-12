/**
 * The web app's router instance (§6.3).
 *
 * The frontier budget is DURABLE as of M6.5: pgBudgetStore's take() is one
 * atomic Postgres statement keyed (user_id, day), so the per-user/day cap
 * holds across every Vercel instance and survives deploys (#24 closed —
 * this file used to carry the in-memory-store warning).
 *
 * Model pins (T1 Haiku, T2 Sonnet, Opus diagnosis pin) come from
 * @nibbin/router defaults — founder decision 2026-06-12. Override per
 * environment via NIBBIN_MODEL_T{0,1,2} / NIBBIN_FRONTIER_BUDGET; any model
 * change gates on the eval suite (SPEC §9 decision log).
 */
import { createRouter, type Router, type Tier } from '@nibbin/router';
import { pgBudgetStore } from './budget-store';

function budgetFromEnv(): number | undefined {
  const raw = process.env.NIBBIN_FRONTIER_BUDGET;
  if (!raw) return undefined;
  const n = Number.parseInt(raw, 10);
  return Number.isInteger(n) && n >= 0 ? n : undefined;
}

function modelsFromEnv(): Partial<Record<Tier, string>> | undefined {
  const models: Partial<Record<Tier, string>> = {};
  for (const tier of ['t0', 't1', 't2'] as const) {
    const v = process.env[`NIBBIN_MODEL_${tier.toUpperCase()}`];
    if (v && v.trim() !== '') models[tier] = v.trim();
  }
  return Object.keys(models).length > 0 ? models : undefined;
}

const forGlobal = globalThis as typeof globalThis & { __nibbinRouter?: Router };

export const groveRouter: Router = (forGlobal.__nibbinRouter ??= createRouter({
  dailyFrontierBudget: budgetFromEnv(),
  models: modelsFromEnv(),
  budgetStore: pgBudgetStore(),
}));
