/**
 * Idempotent "study stopped" reporter.
 *
 * The web shows a "Field study in progress / Watching" card while
 * `study_status.status='active'`. The desktop POSTs `active` on study start and
 * `stopped` via explicit daemon control signals or background poll transitions.
 *
 * THE GAP this closes: a study can leave the active phase by paths that send no
 * `stopped` signal — the daemon's day-14 hard stop / quick-scan backstop
 * (`stop_day14` → REVIEW), `delete_everything` (→ RAW_DELETING), or the app
 * being offline at stop time. Without a signal the web shows a stale card until
 * its own staleness fallback kicks in.
 *
 * This module watches `bridge.studyStatus()` snapshots (fed from main.ts on a
 * recurring poll and at boot) and fires `postStudyStatus({status:'stopped'})`
 * exactly once per study when it transitions OUT of the active phase
 * (ACTIVE/PAUSED), regardless of path.
 *
 * Posting twice is harmless (the web upserts), but a module-level "already
 * reported" set prevents spamming the endpoint on every poll tick.
 */
import type { StudyStatus } from './bridge.js';
import type { StudySnapshot } from '../core/study-machine.js';
import { postStudyStatus } from './post-study-status.js';

/**
 * States that mean the study is no longer capturing → should report `stopped`.
 * The "active phase" is ACTIVE and PAUSED; everything later means capture has
 * ended. NOT_STARTED / CONSENTED (pre-capture) and the synthetic
 * DAEMON_OFFLINE state are intentionally absent — they trigger no report.
 */
const POST_ACTIVE_STATES: ReadonlySet<string> = new Set([
  'REVIEW',
  'SYNTHESIZING',
  'RAW_DELETING',
  'COMPLETE',
  'DELETED',
]);

/** Module-level record of study ids we've already reported `stopped` for. */
const reportedStopped = new Set<string>();

/**
 * PURE decision helper — does this snapshot warrant a one-time `stopped` report?
 *
 * True when:
 *   - the snapshot carries a study id, AND
 *   - the state is one of the post-active states (capture has ended), AND
 *   - we have not already reported `stopped` for that study id.
 *
 * Unit-testable without IPC: callers pass the "already reported" set explicitly.
 */
export function stoppedReportNeeded(
  snapshot: StudyStatus,
  alreadyReported: ReadonlySet<string>,
): boolean {
  const study = snapshot.study as Partial<StudySnapshot> | null;
  const studyId = study?.studyId;
  if (!studyId) return false;
  if (!POST_ACTIVE_STATES.has(snapshot.state)) return false;
  return !alreadyReported.has(studyId);
}

/**
 * Inspect a fresh `studyStatus()` snapshot and, if the study has just left the
 * active phase and hasn't been reported yet, fire a one-time `stopped` signal.
 *
 * Fire-and-forget: `postStudyStatus` already swallows network/auth errors.
 * Missing required fields (studyId/startedAt) are skipped silently — we can't
 * build a valid payload without them, and the daemon populates them once a
 * study has actually started.
 */
export async function reportStudyStatus(snapshot: StudyStatus): Promise<void> {
  if (!stoppedReportNeeded(snapshot, reportedStopped)) return;

  const study = snapshot.study as Partial<StudySnapshot> | null;
  const studyId = study?.studyId;
  const startedAt = study?.startedAt;
  // stoppedReportNeeded already guarantees studyId; guard startedAt (required by
  // the payload) — a stopped study with no startedAt can't form a valid signal.
  if (!studyId || !startedAt) return;

  // Mark BEFORE awaiting so a second poll tick that arrives mid-flight does not
  // re-fire. postStudyStatus is idempotent on the web side regardless.
  reportedStopped.add(studyId);

  await postStudyStatus({
    studyId,
    kind: study?.kind ?? 'full_study',
    label: study?.label ?? null,
    status: 'stopped',
    startedAt,
    endsAt: study?.endsAt ?? null,
  });
}

/** Test-only: reset the module-level reported set. */
export function __resetReportedStoppedForTests(): void {
  reportedStopped.clear();
}
