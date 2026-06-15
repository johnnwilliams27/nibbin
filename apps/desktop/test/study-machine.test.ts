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

  it('quick scan auto-stop window is six hours; full study stays fourteen days', () => {
    const q = transition(
      transition(newStudy('q', 'quick_scan', 'Invoices'), { type: 'consent', at: T0 }),
      { type: 'start', at: T0 },
    );
    // +6h
    expect(q.endsAt).toBe(new Date(new Date(T0).getTime() + 6 * 60 * 60 * 1000).toISOString());
    expect(q.label).toBe('Invoices');
    // full study still +14 days
    expect(started().endsAt).toBe(at(14));
  });

  it('remainingMs pre-start is kind-aware (quick scan reports 6h, not 14 days)', () => {
    // A quick scan with no endsAt (pre-start) reports its own 6h window.
    const q = newStudy('q', 'quick_scan');
    expect(q.endsAt).toBeNull();
    expect(remainingMs(q, T0)).toBe(6 * 60 * 60 * 1000); // 21_600_000
    // full study still reports 14 days pre-start
    expect(remainingMs(newStudy('f'), T0)).toBe(STUDY_DURATION_MS);
  });

  it('create_study is valid only from NOT_STARTED or a terminal state', () => {
    const complete = transition(
      transition(
        transition(transition(started(), { type: 'stop_day14', at: at(14) }), { type: 'finish_review' }),
        { type: 'synthesis_complete' },
      ),
      { type: 'deletion_verified', receipt },
    );
    expect(complete.state).toBe('COMPLETE');
    const fresh = transition(complete, { type: 'create_study', id: 'q2', kind: 'quick_scan', label: null });
    expect(fresh.state).toBe('NOT_STARTED');
    expect(fresh.studyId).toBe('q2');
    expect(fresh.kind).toBe('quick_scan');
    // not allowed mid-capture
    expect(() =>
      transition(started(), { type: 'create_study', id: 'x', kind: 'full_study', label: null }),
    ).toThrow(InvalidTransitionError);
  });
});
