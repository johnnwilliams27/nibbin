/**
 * The web app's router instance (§6.3).
 *
 * ⚠️ BUDGET SCOPE — READ BEFORE WIRING A REAL MODEL CALL ⚠️
 * The frontier budget here is an in-memory store on globalThis. It is a true
 * per-user/day cap only within ONE server process. apps/web runs on Vercel
 * (multiple short-lived instances, no shared memory), so the effective cap is
 * `budget × live instances` — i.e. NOT a real cap. This is acceptable today
 * only because M2 chat replies come from the zero-cost scripted T0 floor and
 * NO real T2 model call ships (keeperChat is called without a `generate` dep).
 *
 * Before wiring `generate` to any real (esp. T2/frontier) model, replace
 * InMemoryBudgetStore with a durable atomic store (Postgres upsert on
 * (user_id, day) or Redis INCR with daily TTL) — see BudgetStore in
 * @nibbin/router. The interface is already isolated; only this construction
 * changes. Tracked for M4. (cost-auditor M2, P1.)
 */
import { createRouter, type Router } from '@nibbin/router';

function budgetFromEnv(): number | undefined {
  const raw = process.env.NIBBIN_FRONTIER_BUDGET;
  if (!raw) return undefined;
  const n = Number.parseInt(raw, 10);
  return Number.isInteger(n) && n >= 0 ? n : undefined;
}

const forGlobal = globalThis as typeof globalThis & { __nibbinRouter?: Router };

export const groveRouter: Router = (forGlobal.__nibbinRouter ??= createRouter({
  dailyFrontierBudget: budgetFromEnv(),
}));
