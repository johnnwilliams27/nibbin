/**
 * M4 stub. M4 (scan engine, Agent Shop, runtime) is in flight on another
 * branch; until its data surfaces land, the arc runs on this port and every
 * beat degrades to its honest no-data copy. Reconcile on rebase: replace
 * `stubArcData` with the real adapter over runs/scan tables, keep the
 * interface (it was published for exactly this seam).
 */
import type { ArcDataPort } from './types';

export function stubArcData(overrides?: Partial<ArcDataPort>): ArcDataPort {
  return {
    flags: async () => ({ studyActive: false, nearGraduation: false }),
    nibbinDay: async () => [],
    unseenInsights: async () => [],
    journal: async () => [],
    clusters: async () => [],
    nearGraduation: async () => null,
    earnedEvents: async () => [],
    names: async () => ({ keeper: null, firstNibbin: null }),
    ...overrides,
  };
}
