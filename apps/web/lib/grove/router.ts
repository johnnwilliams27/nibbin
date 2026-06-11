/**
 * The web app's router instance (§6.3). One per server process so the
 * in-memory per-user frontier budget actually accumulates across requests —
 * stashed on globalThis to survive dev hot reloads. A durable budget store
 * replaces the in-memory one when the agent runtime lands (M4).
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
