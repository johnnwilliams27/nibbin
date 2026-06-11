import { describe, expect, it } from 'vitest';
import {
  captureAllowed,
  deadlinePassed,
  InvalidTransitionError,
  newStudy,
  remainingMs,
  STUDY_DURATION_MS,
  transition,
  type DeletionReceipt,
  type StudySnapshot,
} from '../src/core/study-machine.js';

const T0 = '2026-06-10T08:00:00.000Z';
const DAY = 24 * 60 * 60 * 1000;

function at(daysFromT0: number): string {
  return new Date(new Date(T0).getTime() + daysFromT0 * DAY).toISOString();
}

const receipt: DeletionReceipt = {
  verified_at: at(15),
  checked_paths: ['/tmp/store'],
  residual_files: [],
  verified: true,
};

function started(): StudySnapshot {
  return transition(transition(newStudy('s1'), { type: 'consent', at: T0 }), { type: 'start', at: T0 });
}

describe('study lifecycle state machine', () => {
  it('walks the happy path NOT_STARTED → … → COMPLETE', () => {
    let s = started();
    expect(s.state).toBe('ACTIVE');
    expect(s.endsAt).toBe(at(14));

    s = transition(s, { type: 'stop_day14', at: at(14) });
    expect(s.state).toBe('REVIEW');
    expect(s.stoppedBy).toBe('day14_daemon');

    s = transition(s, { type: 'finish_review' });
    s = transition(s, { type: 'synthesis_complete' });
    expect(s.state).toBe('RAW_DELETING');

    s = transition(s, { type: 'deletion_verified', receipt });
    expect(s.state).toBe('COMPLETE');
    expect(s.deletionReceipt).toEqual(receipt);
  });

  it('pauses and resumes; the hard stop fires from PAUSED too', () => {
    let s = transition(started(), { type: 'pause' });
    expect(s.state).toBe('PAUSED');
    expect(captureAllowed(s)).toBe(false);
    s = transition(s, { type: 'resume' });
    expect(captureAllowed(s)).toBe(true);
    s = transition(transition(s, { type: 'pause' }), { type: 'stop_day14', at: at(14) });
    expect(s.state).toBe('REVIEW');
  });

  it('delete-everything is reachable from every non-terminal state and ends in DELETED', () => {
    const reachable: StudySnapshot[] = [
      newStudy('s1'),
      transition(newStudy('s1'), { type: 'consent', at: T0 }),
      started(),
      transition(started(), { type: 'pause' }),
      transition(started(), { type: 'stop_day14', at: at(14) }),
      transition(transition(started(), { type: 'stop_day14', at: at(14) }), { type: 'finish_review' }),
    ];
    for (const s of reachable) {
      const deleting = transition(s, { type: 'delete_everything' });
      expect(deleting.state).toBe('RAW_DELETING');
      expect(deleting.aborted).toBe(true);
      const done = transition(deleting, { type: 'deletion_verified', receipt });
      expect(done.state).toBe('DELETED');
    }
  });

  it('rejects deletion receipts that did not verify', () => {
    const deleting = transition(started(), { type: 'delete_everything' });
    expect(() =>
      transition(deleting, { type: 'deletion_verified', receipt: { ...receipt, verified: false } }),
    ).toThrow('verified receipt');
  });

  it('rejects invalid transitions (capture states are unreachable after REVIEW)', () => {
    const reviewing = transition(started(), { type: 'stop_day14', at: at(14) });
    expect(() => transition(reviewing, { type: 'resume' })).toThrow(InvalidTransitionError);
    expect(() => transition(reviewing, { type: 'start', at: at(15) })).toThrow(InvalidTransitionError);
    const complete = transition(
      transition(transition(reviewing, { type: 'finish_review' }), { type: 'synthesis_complete' }),
      { type: 'deletion_verified', receipt },
    );
    expect(() => transition(complete, { type: 'delete_everything' })).toThrow(InvalidTransitionError);
  });

  it('deadline math: passes at exactly day 14, from ACTIVE or PAUSED, never before', () => {
    const s = started();
    expect(deadlinePassed(s, at(13.999))).toBe(false);
    expect(deadlinePassed(s, at(14))).toBe(true);
    expect(deadlinePassed(transition(s, { type: 'pause' }), at(15))).toBe(true);
    expect(remainingMs(s, T0)).toBe(STUDY_DURATION_MS);
    expect(remainingMs(s, at(15))).toBe(0);
  });
});
