/**
 * study-status-reporter — pure-helper unit tests.
 *
 * Covers stoppedReportNeeded(): the decision of whether a snapshot warrants a
 * one-time `stopped` report when a study leaves the active phase (ACTIVE/PAUSED)
 * by ANY path — day-14 hard stop (REVIEW), delete-everything (RAW_DELETING),
 * synthesis/completion, etc. Tested without IPC: the "already reported" set is
 * passed in explicitly.
 */
import { describe, expect, it } from 'vitest';
import { stoppedReportNeeded } from '../src/ui/study-status-reporter.js';
import type { StudyStatus } from '../src/ui/bridge.js';

/** Build a StudyStatus snapshot with a given state and optional study fields. */
function snap(state: string, study: Record<string, unknown> | null = { studyId: 's1', startedAt: '2026-06-01T00:00:00Z' }): StudyStatus {
  return {
    state,
    remaining_ms: null,
    paused: null,
    pipeline_halted: null,
    daemon_health: null,
    capture_blocked: null,
    study,
  };
}

describe('stoppedReportNeeded', () => {
  it('reports once on ACTIVE → REVIEW (day-14 / user stop)', () => {
    expect(stoppedReportNeeded(snap('REVIEW'), new Set())).toBe(true);
  });

  it('does NOT re-report the same studyId once recorded', () => {
    const already = new Set(['s1']);
    expect(stoppedReportNeeded(snap('REVIEW'), already)).toBe(false);
  });

  it('does NOT report while still in the active phase (ACTIVE)', () => {
    expect(stoppedReportNeeded(snap('ACTIVE'), new Set())).toBe(false);
  });

  it('does NOT report while paused (PAUSED is still the active phase)', () => {
    expect(stoppedReportNeeded(snap('PAUSED'), new Set())).toBe(false);
  });

  it('does NOT report for pre-capture states (NOT_STARTED, CONSENTED)', () => {
    expect(stoppedReportNeeded(snap('NOT_STARTED'), new Set())).toBe(false);
    expect(stoppedReportNeeded(snap('CONSENTED'), new Set())).toBe(false);
  });

  it('does NOT report for the synthetic DAEMON_OFFLINE state', () => {
    // DAEMON_OFFLINE carries no study; even if it did, it is not a stop signal.
    expect(stoppedReportNeeded(snap('DAEMON_OFFLINE', null), new Set())).toBe(false);
    expect(stoppedReportNeeded(snap('DAEMON_OFFLINE'), new Set())).toBe(false);
  });

  it('reports for the delete path (RAW_DELETING)', () => {
    expect(stoppedReportNeeded(snap('RAW_DELETING'), new Set())).toBe(true);
  });

  it('reports for SYNTHESIZING (capture has ended)', () => {
    expect(stoppedReportNeeded(snap('SYNTHESIZING'), new Set())).toBe(true);
  });

  it('reports for COMPLETE and DELETED', () => {
    expect(stoppedReportNeeded(snap('COMPLETE'), new Set())).toBe(true);
    expect(stoppedReportNeeded(snap('DELETED'), new Set())).toBe(true);
  });

  it('does NOT report when the snapshot carries no study id', () => {
    expect(stoppedReportNeeded(snap('REVIEW', null), new Set())).toBe(false);
    expect(stoppedReportNeeded(snap('REVIEW', {}), new Set())).toBe(false);
  });

  it('resets correctly for a NEW studyId after a previous one was reported', () => {
    const already = new Set(['s1']);
    // s1 already reported → no; a brand-new s2 in a post-active state → yes.
    expect(stoppedReportNeeded(snap('REVIEW', { studyId: 's1', startedAt: 'x' }), already)).toBe(false);
    expect(stoppedReportNeeded(snap('REVIEW', { studyId: 's2', startedAt: 'x' }), already)).toBe(true);
  });
});
