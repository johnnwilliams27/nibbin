/**
 * Study lifecycle state machine (SPEC §5):
 *
 *   NOT_STARTED → CONSENTED → ACTIVE ⇄ PAUSED
 *     → (day-14 daemon-enforced stop | user stop) → REVIEW
 *     → SYNTHESIZING → RAW_DELETING (verified) → COMPLETE
 *   "delete everything" reachable from any state → RAW_DELETING → DELETED.
 *
 * This module is PURE and SERIALIZABLE — the TS daemon simulator, the review
 * UI, and the Rust daemon (apps/desktop/src-tauri/crates/study) all implement
 * exactly these semantics; the Rust port is the production enforcer (C2 lives
 * in the daemon, never the UI). It must never import UI or IO modules.
 */

export const STUDY_DAYS = 14;
export const STUDY_DURATION_MS = STUDY_DAYS * 24 * 60 * 60 * 1000;

export type StudyState =
  | 'NOT_STARTED'
  | 'CONSENTED'
  | 'ACTIVE'
  | 'PAUSED'
  | 'REVIEW'
  | 'SYNTHESIZING'
  | 'RAW_DELETING'
  | 'COMPLETE'
  | 'DELETED';

export interface DeletionReceipt {
  verified_at: string;
  checked_paths: string[];
  residual_files: string[];
  verified: boolean;
}

export interface StudySnapshot {
  v: 1;
  studyId: string;
  state: StudyState;
  consentedAt: string | null;
  startedAt: string | null;
  /** Hard stop: startedAt + 14 days, wall clock. Daemon-enforced (C2). */
  endsAt: string | null;
  stoppedBy: 'day14_daemon' | 'user' | null;
  /** True when the study was aborted via delete-everything. */
  aborted: boolean;
  deletionReceipt: DeletionReceipt | null;
  /**
   * Highest wall-clock observed while ACTIVE/PAUSED. The day-14 stop fires
   * against max(now, clockHighWater), so winding the clock back cannot revive
   * an expired study (C2 anti-rollback). Mirrors the Rust twin.
   */
  clockHighWater: string | null;
}

export type StudyCommand =
  | { type: 'consent'; at: string }
  | { type: 'start'; at: string }
  | { type: 'pause' }
  | { type: 'resume' }
  /** Daemon-only: the day-14 hard stop. */
  | { type: 'stop_day14'; at: string }
  | { type: 'stop_early'; at: string }
  | { type: 'finish_review' }
  | { type: 'synthesis_complete' }
  | { type: 'deletion_verified'; receipt: DeletionReceipt }
  | { type: 'delete_everything' };

export class InvalidTransitionError extends Error {
  constructor(state: StudyState, command: StudyCommand['type']) {
    super(`invalid study transition: ${command} from ${state}`);
    this.name = 'InvalidTransitionError';
  }
}

export function newStudy(studyId: string): StudySnapshot {
  return {
    v: 1,
    studyId,
    state: 'NOT_STARTED',
    consentedAt: null,
    startedAt: null,
    endsAt: null,
    stoppedBy: null,
    aborted: false,
    deletionReceipt: null,
    clockHighWater: null,
  };
}

/** Monotonic clock observation — never lowers the high-water mark (C2). */
export function observeClock(snap: StudySnapshot, nowIso: string): StudySnapshot {
  if (snap.state !== 'ACTIVE' && snap.state !== 'PAUSED') return snap;
  const high =
    snap.clockHighWater !== null && snap.clockHighWater >= nowIso ? snap.clockHighWater : nowIso;
  return { ...snap, clockHighWater: high };
}

function effectiveNow(snap: StudySnapshot, nowIso: string): string {
  return snap.clockHighWater !== null && snap.clockHighWater > nowIso ? snap.clockHighWater : nowIso;
}

const TERMINAL: ReadonlySet<StudyState> = new Set(['COMPLETE', 'DELETED']);

export function transition(snap: StudySnapshot, cmd: StudyCommand): StudySnapshot {
  // "Delete everything" is reachable from any non-terminal state.
  if (cmd.type === 'delete_everything') {
    if (TERMINAL.has(snap.state)) throw new InvalidTransitionError(snap.state, cmd.type);
    return { ...snap, state: 'RAW_DELETING', aborted: true };
  }

  switch (cmd.type) {
    case 'consent':
      if (snap.state !== 'NOT_STARTED') throw new InvalidTransitionError(snap.state, cmd.type);
      return { ...snap, state: 'CONSENTED', consentedAt: cmd.at };
    case 'start': {
      if (snap.state !== 'CONSENTED') throw new InvalidTransitionError(snap.state, cmd.type);
      const endsAt = new Date(new Date(cmd.at).getTime() + STUDY_DURATION_MS).toISOString();
      return { ...snap, state: 'ACTIVE', startedAt: cmd.at, endsAt };
    }
    case 'pause':
      if (snap.state !== 'ACTIVE') throw new InvalidTransitionError(snap.state, cmd.type);
      return { ...snap, state: 'PAUSED' };
    case 'resume':
      if (snap.state !== 'PAUSED') throw new InvalidTransitionError(snap.state, cmd.type);
      return { ...snap, state: 'ACTIVE' };
    case 'stop_day14':
      // The hard stop fires whether the study is running or paused.
      if (snap.state !== 'ACTIVE' && snap.state !== 'PAUSED') {
        throw new InvalidTransitionError(snap.state, cmd.type);
      }
      return { ...snap, state: 'REVIEW', stoppedBy: 'day14_daemon' };
    case 'stop_early':
      if (snap.state !== 'ACTIVE' && snap.state !== 'PAUSED') {
        throw new InvalidTransitionError(snap.state, cmd.type);
      }
      return { ...snap, state: 'REVIEW', stoppedBy: 'user' };
    case 'finish_review':
      if (snap.state !== 'REVIEW') throw new InvalidTransitionError(snap.state, cmd.type);
      return { ...snap, state: 'SYNTHESIZING' };
    case 'synthesis_complete':
      if (snap.state !== 'SYNTHESIZING') throw new InvalidTransitionError(snap.state, cmd.type);
      return { ...snap, state: 'RAW_DELETING' };
    case 'deletion_verified': {
      if (snap.state !== 'RAW_DELETING') throw new InvalidTransitionError(snap.state, cmd.type);
      if (!cmd.receipt.verified) throw new Error('deletion_verified requires a verified receipt');
      const next: StudyState = snap.aborted ? 'DELETED' : 'COMPLETE';
      return { ...snap, state: next, deletionReceipt: cmd.receipt };
    }
  }
}

/** Capture may run ONLY here. Everything else records nothing. */
export function captureAllowed(snap: StudySnapshot): boolean {
  return snap.state === 'ACTIVE';
}

/** True when the daemon must fire the day-14 stop on its next tick. Uses the
 * monotonic high-water mark, so a rolled-back clock cannot revive the study. */
export function deadlinePassed(snap: StudySnapshot, nowIso: string): boolean {
  return (
    (snap.state === 'ACTIVE' || snap.state === 'PAUSED') &&
    snap.endsAt !== null &&
    effectiveNow(snap, nowIso) >= snap.endsAt
  );
}

/** Countdown for the always-visible tray display. Never negative; never counts
 * back up if the clock is wound backward. */
export function remainingMs(snap: StudySnapshot, nowIso: string): number {
  if (snap.endsAt === null) return STUDY_DURATION_MS;
  return Math.max(0, new Date(snap.endsAt).getTime() - new Date(effectiveNow(snap, nowIso)).getTime());
}
