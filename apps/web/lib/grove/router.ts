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
import { createRouter, type PerformanceSource, type RoutedTask, type Router, type Tier } from '@nibbin/router';
import { pgBudgetStore } from './budget-store';
import { pgPerformanceSource } from './performance-source';

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

/**
 * Slice B reinforcement source. Wired only when NIBBIN_REINFORCEMENT is on, so
 * the policy issues the staff/service read RPC only where it's deliberately
 * enabled. Even when ON it changes NOTHING until a task names a 2nd
 * eval-cleared candidate (DEFAULT_TASK_CANDIDATES is empty) — the source is
 * inert against single-candidate tasks. Candidate sets are added via
 * NIBBIN_TASK_CANDIDATES (JSON map task→[models]) AFTER the swap clears the
 * eval suite (M6.5 §9). Absent the flag, route() is exactly the static config.
 */
function performanceFromEnv(): PerformanceSource | undefined {
  const raw = process.env.NIBBIN_REINFORCEMENT;
  if (!raw || raw.trim() === '' || raw === '0' || raw.toLowerCase() === 'false') return undefined;
  return pgPerformanceSource();
}

function candidatesFromEnv(): Partial<Record<RoutedTask, readonly string[]>> | undefined {
  const raw = process.env.NIBBIN_TASK_CANDIDATES;
  if (!raw || raw.trim() === '') return undefined;
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object') return undefined;
    const out: Partial<Record<RoutedTask, readonly string[]>> = {};
    for (const [task, models] of Object.entries(parsed as Record<string, unknown>)) {
      if (Array.isArray(models) && models.every((m) => typeof m === 'string' && m.trim() !== '')) {
        out[task as RoutedTask] = models as string[];
      }
    }
    return Object.keys(out).length > 0 ? out : undefined;
  } catch {
    console.error('[reinforce] NIBBIN_TASK_CANDIDATES is not valid JSON — ignoring (static routing)');
    return undefined;
  }
}

const forGlobal = globalThis as typeof globalThis & { __nibbinRouter?: Router };

export const groveRouter: Router = (forGlobal.__nibbinRouter ??= createRouter({
  dailyFrontierBudget: budgetFromEnv(),
  models: modelsFromEnv(),
  budgetStore: pgBudgetStore(),
  performance: performanceFromEnv(),
  taskCandidates: candidatesFromEnv(),
}));
