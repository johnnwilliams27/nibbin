/**
 * Test/dev port. Production runs on pg-arc-data.ts (the real adapter over
 * M4's runs/scan tables); this stub keeps the scheduler/content tests
 * deterministic and shows every beat's honest no-data degradation.
 */
import type { ArcDataPort } from './types';

export function stubArcData(overrides?: Partial<ArcDataPort>): ArcDataPort {
  return {
    flags: async () => ({ studyActive: false, studyCompleted: false, nearGraduation: false }),
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
