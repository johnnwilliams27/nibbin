/**
 * Fixture registry — task → its TaskFixtures (fixtures + versioned rubric).
 * The runner looks up each candidate pair's task here.
 */
import type { RoutedTask } from '../../src/types';
import type { TaskFixtures } from '../types';
import { customSpecDraftFixtures } from './custom_spec_draft';
import { complexPlanFixtures } from './complex_plan';
import { planSynthesisFixtures } from './plan_synthesis';
import { specialistDraftFixtures } from './specialist_draft';
import { mapLabelingFixtures } from './map_labeling';

export const FIXTURES_BY_TASK: Partial<Record<RoutedTask, TaskFixtures>> = {
  custom_spec_draft: customSpecDraftFixtures,
  complex_plan: complexPlanFixtures,
  plan_synthesis: planSynthesisFixtures,
  specialist_draft: specialistDraftFixtures,
  map_labeling: mapLabelingFixtures,
};

export function fixturesForTask(task: RoutedTask): TaskFixtures {
  const f = FIXTURES_BY_TASK[task];
  if (!f) throw new Error(`eval: no fixtures registered for task "${task}"`);
  return f;
}
