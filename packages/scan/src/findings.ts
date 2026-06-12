/**
 * Finding construction — every finding carries the §4.4 quartet: plain
 * insight, quantified cost (with the math in `basis`), the Nibbin that fixes
 * it, and a one-tap adopt action resolved from the shop templates.
 */
import type { Finding, QuantifiedCost } from '@nibbin/connectors';
import { getTemplate, TEMPLATE_FOR_SCAN_MODULE } from '@nibbin/runtime';

export function makeFinding(
  moduleId: string,
  connectionId: string,
  insight: string,
  cost: QuantifiedCost,
  evidence?: Record<string, unknown>,
): Finding {
  const templateKey = TEMPLATE_FOR_SCAN_MODULE[moduleId];
  if (!templateKey) throw new Error(`scan module ${moduleId} has no shop template mapping`);
  const template = getTemplate(templateKey);
  return {
    module: moduleId,
    connectionId,
    insight,
    cost,
    recommendedNibbin: templateKey,
    adoptAction: {
      specTemplateKey: templateKey,
      requiredConnectors: template.spec.requiredConnectors,
    },
    ...(evidence ? { evidence } : {}),
  };
}

export const WEEK_MS = 7 * 86_400_000;
export const DAY_MS = 86_400_000;

export function weeksIn(window: { startMs: number; endMs: number }): number {
  return Math.max(1, (window.endMs - window.startMs) / WEEK_MS);
}

export function round1(n: number): number {
  return Math.round(n * 10) / 10;
}

/** Median of a non-empty list; 0 for empty. */
export function median(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}
