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
import { scanSynthesisFixtures } from './scan_synthesis';
import { onboardingUnderstandingFixtures } from './onboarding_understanding';
import { trainingFeedbackFixtures } from './training_feedback';
import { sweepPass1Fixtures } from './sweep_pass1';
import { sweepPass2Fixtures } from './sweep_pass2';
import { memoryExtractFixtures } from './memory_extract';
import { diagnosisSynthesisFixtures } from './diagnosis_synthesis';
import { nibbinNoteFixtures } from './nibbin_note';

export const FIXTURES_BY_TASK: Partial<Record<RoutedTask, TaskFixtures>> = {
  // T1
  specialist_draft: specialistDraftFixtures,
  scan_synthesis: scanSynthesisFixtures,
  onboarding_understanding: onboardingUnderstandingFixtures,
  training_feedback: trainingFeedbackFixtures,
  map_labeling: mapLabelingFixtures,
  sweep_pass1: sweepPass1Fixtures,
  sweep_pass2: sweepPass2Fixtures,
  memory_extract: memoryExtractFixtures,
  // T2 non-splurge
  custom_spec_draft: customSpecDraftFixtures,
  complex_plan: complexPlanFixtures,
  plan_synthesis: planSynthesisFixtures,
  // T2 splurge (report-only)
  diagnosis_synthesis: diagnosisSynthesisFixtures,
  nibbin_note: nibbinNoteFixtures,
};

export function fixturesForTask(task: RoutedTask): TaskFixtures {
  const f = FIXTURES_BY_TASK[task];
  if (!f) throw new Error(`eval: no fixtures registered for task "${task}"`);
  return f;
}
