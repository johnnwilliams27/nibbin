/**
 * Pure state-routing helper for the Field Study tab.
 *
 * Extracted from paint() so it can be unit-tested without pulling in the
 * full DOM/bridge/sync-study import chain. No browser APIs, no imports.
 *
 * Returns one of four surface names that paint() uses to decide which
 * sub-view to render:
 *
 *   'entry'      — no study is capturing; show entryView() (the NIB-2 fix
 *                  extends this to DAEMON_OFFLINE and unknown states)
 *   'consent'    — user has consented but the study hasn't started yet
 *   'studyOrScan'— a study is actively running (ACTIVE or PAUSED)
 *   'state'      — mid-flight terminal sub-state (REVIEW/SYNTHESIZING/
 *                  RAW_DELETING) — entry is NOT shown
 */
export type FieldStudySurface = 'entry' | 'consent' | 'studyOrScan' | 'state';

/**
 * Maps a raw daemon state string to the surface that paint() should render.
 *
 * NIB-2 fix: DAEMON_OFFLINE and any unrecognized state now return 'entry'
 * rather than 'state', making the start buttons reachable in every
 * non-running condition.
 */
export function viewForState(state: string): FieldStudySurface {
  switch (state) {
    case 'NOT_STARTED':
    case 'COMPLETE':
    case 'DELETED':
    case 'DAEMON_OFFLINE':
      // NIB-2: DAEMON_OFFLINE is now an entry state, not a dead-end error.
      return 'entry';

    case 'CONSENTED':
      return 'consent';

    case 'ACTIVE':
    case 'PAUSED':
      return 'studyOrScan';

    case 'REVIEW':
    case 'SYNTHESIZING':
    case 'RAW_DELETING':
      return 'state';

    default:
      // Any future or unrecognized state: default to 'entry' so the user
      // always has a path forward rather than a dead end.
      return 'entry';
  }
}
