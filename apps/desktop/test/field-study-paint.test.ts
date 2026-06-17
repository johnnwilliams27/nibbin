/**
 * NIB-2: paint() state → view routing tests.
 *
 * Tests the `viewForState()` pure function extracted from paint() in
 * field-study.ts. This function has no DOM or bridge imports so it can run
 * under vitest directly.
 *
 * TDD: these tests were written BEFORE the implementation changes and drove
 * the extraction of `viewForState` from `paint()`.
 */
import { describe, expect, it } from 'vitest';
import { viewForState } from '../src/ui/views/field-study-state.js';

describe('viewForState — NIB-2 paint() routing', () => {
  // States that should always show the entry surface (start buttons reachable)
  it('NOT_STARTED routes to entry', () => {
    expect(viewForState('NOT_STARTED')).toBe('entry');
  });

  it('COMPLETE routes to entry', () => {
    expect(viewForState('COMPLETE')).toBe('entry');
  });

  it('DELETED routes to entry', () => {
    expect(viewForState('DELETED')).toBe('entry');
  });

  it('DAEMON_OFFLINE routes to entry — the NIB-2 fix (was dead-end stateView)', () => {
    expect(viewForState('DAEMON_OFFLINE')).toBe('entry');
  });

  it('unrecognized state routes to entry (safe fallback for future states)', () => {
    expect(viewForState('SOME_FUTURE_STATE')).toBe('entry');
    expect(viewForState('')).toBe('entry');
  });

  // States where a study is actively running — entry must NOT show
  it('ACTIVE routes to studyOrScan, not entry', () => {
    expect(viewForState('ACTIVE')).toBe('studyOrScan');
    expect(viewForState('ACTIVE')).not.toBe('entry');
  });

  it('PAUSED routes to studyOrScan, not entry', () => {
    expect(viewForState('PAUSED')).toBe('studyOrScan');
    expect(viewForState('PAUSED')).not.toBe('entry');
  });

  it('CONSENTED routes to consent surface, not entry', () => {
    expect(viewForState('CONSENTED')).toBe('consent');
    expect(viewForState('CONSENTED')).not.toBe('entry');
  });

  it('REVIEW routes to state surface, not entry', () => {
    expect(viewForState('REVIEW')).toBe('state');
    expect(viewForState('REVIEW')).not.toBe('entry');
  });

  it('SYNTHESIZING routes to state surface, not entry', () => {
    expect(viewForState('SYNTHESIZING')).toBe('state');
    expect(viewForState('SYNTHESIZING')).not.toBe('entry');
  });

  it('RAW_DELETING routes to state surface, not entry', () => {
    expect(viewForState('RAW_DELETING')).toBe('state');
    expect(viewForState('RAW_DELETING')).not.toBe('entry');
  });
});
