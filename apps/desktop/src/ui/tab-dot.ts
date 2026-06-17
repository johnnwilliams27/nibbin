/**
 * Tab-dot visibility — pure, unit-testable.
 *
 * The Field Study tab dot is a first-timer nudge: it shows only when the user
 * has NEVER completed at least one field study AND no study is currently
 * running. Once cleared (by reading `nibbin.fieldStudyEverCompleted` from
 * localStorage), it never reappears — veterans between studies are not nudged.
 *
 * States where a study is actively in-progress — the dot should NOT show.
 */
export const RUNNING_STATES = new Set([
  'CONSENTED', 'ACTIVE', 'PAUSED', 'REVIEW', 'SYNTHESIZING', 'RAW_DELETING',
]);

/**
 * Whether the Field Study tab dot should be shown.
 *
 * @param everCompleted - true if the user has completed ≥1 field study on this
 *   device (read from `localStorage.getItem('nibbin.fieldStudyEverCompleted')`).
 *   When true the dot is permanently suppressed for veterans.
 * @param state - the current daemon state string from `studyStatus().state`.
 *   Fail-closed: an empty/unknown state returns false (no spurious dot).
 */
export function shouldShowDot(everCompleted: boolean, state: string): boolean {
  if (everCompleted) return false;
  if (!state) return false;
  return !RUNNING_STATES.has(state);
}

/** localStorage key used to persist the "ever completed a study" flag. */
export const EVER_COMPLETED_KEY = 'nibbin.fieldStudyEverCompleted';
