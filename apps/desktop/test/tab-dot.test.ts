/**
 * NIB-7 / Task C — shouldShowDot() unit tests.
 *
 * The Field Study tab dot is a first-timer nudge:
 *   - Shown only when the user has NEVER completed a field study (everCompleted
 *     = false) AND no study is currently running.
 *   - Permanently suppressed once the user has completed ≥1 study on this
 *     device (everCompleted = true).
 *   - Fail-closed: empty/unknown state → no dot.
 */
import { describe, expect, it } from 'vitest';
import { shouldShowDot, RUNNING_STATES, EVER_COMPLETED_KEY } from '../src/ui/tab-dot.js';

describe('shouldShowDot — NIB-7 Task C first-timer nudge', () => {
  // ---- First-timer (everCompleted = false) ----

  it('shows dot for NOT_STARTED when never completed', () => {
    expect(shouldShowDot(false, 'NOT_STARTED')).toBe(true);
  });

  it('shows dot for DAEMON_OFFLINE when never completed', () => {
    expect(shouldShowDot(false, 'DAEMON_OFFLINE')).toBe(true);
  });

  it('shows dot for COMPLETE when never completed (between first completion and next start)', () => {
    expect(shouldShowDot(false, 'COMPLETE')).toBe(true);
  });

  it('shows dot for DELETED when never completed', () => {
    expect(shouldShowDot(false, 'DELETED')).toBe(true);
  });

  it('shows dot for unrecognized state when never completed', () => {
    expect(shouldShowDot(false, 'SOME_FUTURE_STATE')).toBe(true);
  });

  // ---- Running states — dot must NOT show regardless of everCompleted ----

  it.each([...RUNNING_STATES])(
    'hides dot for running state "%s" even when never completed',
    (state) => {
      expect(shouldShowDot(false, state)).toBe(false);
    },
  );

  // ---- Veteran (everCompleted = true) — dot always suppressed ----

  it('hides dot for NOT_STARTED after completing at least one study', () => {
    expect(shouldShowDot(true, 'NOT_STARTED')).toBe(false);
  });

  it('hides dot for DAEMON_OFFLINE after completing at least one study', () => {
    expect(shouldShowDot(true, 'DAEMON_OFFLINE')).toBe(false);
  });

  it('hides dot for COMPLETE after completing at least one study', () => {
    expect(shouldShowDot(true, 'COMPLETE')).toBe(false);
  });

  it('hides dot for DELETED after completing at least one study', () => {
    expect(shouldShowDot(true, 'DELETED')).toBe(false);
  });

  it('hides dot for any unrecognized state after completing at least one study', () => {
    expect(shouldShowDot(true, 'SOME_FUTURE_STATE')).toBe(false);
  });

  it.each([...RUNNING_STATES])(
    'hides dot for running state "%s" after completing at least one study',
    (state) => {
      expect(shouldShowDot(true, state)).toBe(false);
    },
  );

  // ---- Fail-closed: empty state ----

  it('hides dot when state is empty string (fail-closed)', () => {
    expect(shouldShowDot(false, '')).toBe(false);
  });

  it('hides dot when state is empty string even for first-timer', () => {
    expect(shouldShowDot(true, '')).toBe(false);
  });

  // ---- Exported constants ----

  it('EVER_COMPLETED_KEY is the canonical localStorage key', () => {
    expect(EVER_COMPLETED_KEY).toBe('nibbin.fieldStudyEverCompleted');
  });

  it('RUNNING_STATES includes all six in-flight states', () => {
    for (const state of ['CONSENTED', 'ACTIVE', 'PAUSED', 'REVIEW', 'SYNTHESIZING', 'RAW_DELETING']) {
      expect(RUNNING_STATES.has(state)).toBe(true);
    }
  });
});
