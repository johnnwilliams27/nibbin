/**
 * Task 5 — dock-badge pure seam tests.
 *
 * formatBadgeCount is a pure function; no DOM, no renderer required.
 * These tests verify the badge label logic (capping at 9+, zero suppression)
 * and serve as the "pure seam" gate described in the plan.
 */
import { describe, it, expect } from 'vitest';
import { formatBadgeCount } from './dock-badge';

describe('formatBadgeCount — pure seam', () => {
  it('returns empty string for 0 (no badge rendered)', () => {
    expect(formatBadgeCount(0)).toBe('');
  });

  it('returns empty string for negative values', () => {
    expect(formatBadgeCount(-1)).toBe('');
  });

  it('returns "1" for 1 unread', () => {
    expect(formatBadgeCount(1)).toBe('1');
  });

  it('returns "9" for 9 unread (not capped)', () => {
    expect(formatBadgeCount(9)).toBe('9');
  });

  it('caps at "9+" for 10 unread', () => {
    expect(formatBadgeCount(10)).toBe('9+');
  });

  it('caps at "9+" for 14 unread (plan 5g)', () => {
    expect(formatBadgeCount(14)).toBe('9+');
  });

  it('caps at "9+" for large numbers', () => {
    expect(formatBadgeCount(999)).toBe('9+');
  });

  it('returns string type for all non-zero inputs below cap', () => {
    expect(typeof formatBadgeCount(3)).toBe('string');
  });
});
