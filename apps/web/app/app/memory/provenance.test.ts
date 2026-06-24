/**
 * Task 12 — provenance.test.ts
 *
 * Pure-function unit tests for provenance.ts helpers.
 * No React, no DOM, no Supabase — all inputs are plain values.
 *
 * Contract (per plan §Task 12):
 *  - sourceLabel(source) → human string or null
 *  - staleness(lastReviewedAt, now) → { stale: boolean; text: string }
 *  - provenanceText(fieldMeta) → string | null (full composed label)
 *  - STALE_DAYS is 60 (exported constant)
 *
 * Graceful-empty rules:
 *  - null / undefined meta → null (silent, never "unknown")
 *  - unknown source string → null (not "unknown")
 *  - absent lastReviewedAt → stale:false, text:'' (no staleness if never reviewed)
 */

import { describe, it, expect } from 'vitest';
import {
  STALE_DAYS,
  sourceLabel,
  staleness,
  provenanceText,
} from './provenance';

// ---------------------------------------------------------------------------
// STALE_DAYS constant
// ---------------------------------------------------------------------------

describe('STALE_DAYS', () => {
  it('is 60', () => {
    expect(STALE_DAYS).toBe(60);
  });
});

// ---------------------------------------------------------------------------
// sourceLabel
// ---------------------------------------------------------------------------

describe('sourceLabel', () => {
  it('field_study → "From Field Study"', () => {
    expect(sourceLabel('field_study')).toBe('From Field Study');
  });

  it('connector:gmail → "From Gmail"', () => {
    expect(sourceLabel('connector:gmail')).toBe('From Gmail');
  });

  it('user_entered → "You wrote this"', () => {
    expect(sourceLabel('user_entered')).toBe('You wrote this');
  });

  it('seeded → "From your onboarding"', () => {
    expect(sourceLabel('seeded')).toBe('From your onboarding');
  });

  it('unknown string → null (silent, never "unknown")', () => {
    expect(sourceLabel('some_future_source')).toBeNull();
  });

  it('empty string → null', () => {
    expect(sourceLabel('')).toBeNull();
  });

  it('connector:stripe → null (only gmail is mapped)', () => {
    expect(sourceLabel('connector:stripe')).toBeNull();
  });

  it('FIELD_STUDY (wrong case) → null (case-sensitive)', () => {
    expect(sourceLabel('FIELD_STUDY')).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// staleness
// ---------------------------------------------------------------------------

describe('staleness — fresh (< STALE_DAYS ago)', () => {
  const now = new Date('2026-06-23T12:00:00Z');

  it('reviewed 30 days ago → stale:false, text:""', () => {
    const lastReviewedAt = '2026-05-24T12:00:00Z'; // 30 days ago
    const result = staleness(lastReviewedAt, now);
    expect(result.stale).toBe(false);
    expect(result.text).toBe('');
  });

  it('reviewed exactly today → stale:false', () => {
    const lastReviewedAt = '2026-06-23T12:00:00Z';
    const result = staleness(lastReviewedAt, now);
    expect(result.stale).toBe(false);
  });

  it('reviewed 59 days ago → stale:false (boundary)', () => {
    const d = new Date(now);
    d.setDate(d.getDate() - 59);
    const result = staleness(d.toISOString(), now);
    expect(result.stale).toBe(false);
  });

  it('reviewed exactly 60 days ago → stale:false (boundary: > not >=)', () => {
    const d = new Date(now);
    d.setDate(d.getDate() - 60);
    const result = staleness(d.toISOString(), now);
    expect(result.stale).toBe(false);
  });
});

describe('staleness — stale (> STALE_DAYS ago)', () => {
  const now = new Date('2026-06-23T12:00:00Z');

  it('reviewed 61 days ago → stale:true', () => {
    const d = new Date(now);
    d.setDate(d.getDate() - 61);
    const result = staleness(d.toISOString(), now);
    expect(result.stale).toBe(true);
  });

  it('stale text contains "worth a check?"', () => {
    const result = staleness('2025-01-01T00:00:00Z', now);
    expect(result.text).toContain('worth a check?');
  });

  it('reviewed 1 year ago → stale:true', () => {
    const result = staleness('2025-06-23T12:00:00Z', now);
    expect(result.stale).toBe(true);
  });

  it('reviewed in 2020 → stale:true', () => {
    const result = staleness('2020-01-01T00:00:00Z', now);
    expect(result.stale).toBe(true);
  });
});

describe('staleness — null / absent lastReviewedAt', () => {
  const now = new Date('2026-06-23T12:00:00Z');

  it('null lastReviewedAt → stale:false, text:"" (silent)', () => {
    const result = staleness(null, now);
    expect(result.stale).toBe(false);
    expect(result.text).toBe('');
  });

  it('undefined lastReviewedAt → stale:false, text:""', () => {
    const result = staleness(undefined, now);
    expect(result.stale).toBe(false);
    expect(result.text).toBe('');
  });
});

describe('staleness — default `now` parameter', () => {
  it('uses current time when now is not provided', () => {
    // A very old date should always be stale when tested now
    const result = staleness('2020-01-01T00:00:00Z');
    expect(result.stale).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// provenanceText — full composed line
// ---------------------------------------------------------------------------

describe('provenanceText', () => {
  const now = new Date('2026-06-23T12:00:00Z');

  it('null meta → null (silent)', () => {
    expect(provenanceText(null, now)).toBeNull();
  });

  it('undefined meta → null (silent)', () => {
    expect(provenanceText(undefined, now)).toBeNull();
  });

  it('unknown source → null (silent, never "unknown")', () => {
    expect(provenanceText({ source: 'future_source', lastReviewedAt: '2026-06-01T00:00:00Z' }, now)).toBeNull();
  });

  it('known source, fresh → just the label (no staleness copy)', () => {
    const result = provenanceText({ source: 'user_entered', lastReviewedAt: '2026-06-20T00:00:00Z' }, now);
    expect(result).toBe('You wrote this');
  });

  it('field_study, fresh → "From Field Study"', () => {
    const result = provenanceText({ source: 'field_study', lastReviewedAt: '2026-06-20T00:00:00Z' }, now);
    expect(result).toBe('From Field Study');
  });

  it('known source, stale → label + staleness copy', () => {
    const result = provenanceText({ source: 'user_entered', lastReviewedAt: '2025-01-01T00:00:00Z' }, now);
    expect(result).toContain('You wrote this');
    expect(result).toContain('worth a check?');
  });

  it('connector:gmail, stale → "From Gmail — worth a check?"', () => {
    const result = provenanceText({ source: 'connector:gmail', lastReviewedAt: '2025-01-01T00:00:00Z' }, now);
    expect(result).toBe('From Gmail — worth a check?');
  });

  it('seeded, fresh → "From your onboarding"', () => {
    const result = provenanceText({ source: 'seeded', lastReviewedAt: '2026-06-20T00:00:00Z' }, now);
    expect(result).toBe('From your onboarding');
  });

  it('known source, null lastReviewedAt → just the label (no staleness)', () => {
    const result = provenanceText({ source: 'field_study', lastReviewedAt: null }, now);
    expect(result).toBe('From Field Study');
  });

  it('stale label uses "—" dash separator before staleness copy', () => {
    const result = provenanceText({ source: 'seeded', lastReviewedAt: '2020-01-01T00:00:00Z' }, now);
    expect(result).toMatch(/— worth a check\?/);
  });
});
