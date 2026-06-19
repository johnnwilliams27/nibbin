/**
 * Unit tests for the style profile injector (SPEC §4A Slice 1).
 * loadStyleProfileBlock must:
 *   • return null when there is no profile;
 *   • return null when confidence < MIN_CONFIDENCE and no user_notes;
 *   • render a "What we know about your voice:" block with the correct labels;
 *   • include user_notes when present;
 *   • return null (not throw) on any load error.
 */
import { describe, it, expect, vi } from 'vitest';

// Mock ./load at the top level so the mock is hoisted before inject.ts is imported.
const mockLoad = vi.fn();
vi.mock('./load', () => ({
  loadStyleProfile: (...args: unknown[]) => mockLoad(...args),
}));

// Import after mock is hoisted.
import { loadStyleProfileBlock } from './inject';

function makeProfile(overrides: Record<string, unknown> = {}) {
  return {
    account_id: 'acc-1',
    tone_profile: null,
    field_study_cues: {},
    user_notes: null,
    stats: { edits_analyzed: 0, confidence: 0, last_updated: null, derived_from: [] },
    version: 0,
    created_at: '2026-01-01',
    updated_at: '2026-01-01',
    ...overrides,
  };
}

describe('loadStyleProfileBlock', () => {
  it('returns null when loadStyleProfile returns null', async () => {
    mockLoad.mockResolvedValue(null);
    const result = await loadStyleProfileBlock('acc-1');
    expect(result).toBeNull();
  });

  it('returns null when confidence is below threshold and no user_notes', async () => {
    mockLoad.mockResolvedValue(
      makeProfile({ stats: { edits_analyzed: 1, confidence: 0.05, last_updated: null, derived_from: [] } }),
    );
    const result = await loadStyleProfileBlock('acc-1');
    expect(result).toBeNull();
  });

  it('returns a block with voice labels when confidence is sufficient', async () => {
    mockLoad.mockResolvedValue(
      makeProfile({
        tone_profile: {
          formality: 0.2,
          sentiment: 0.7,
          pace: 0.3,
          signature_sign_offs: ['Thanks,'],
          removals: ['filler words'],
        },
        stats: { edits_analyzed: 5, confidence: 0.4, last_updated: '2026-01-01', derived_from: [] },
      }),
    );
    const result = await loadStyleProfileBlock('acc-1');
    expect(result).not.toBeNull();
    expect(result).toContain('What we know about your voice');
    expect(result).toContain('casual');
    expect(result).toContain('warm');
    expect(result).toContain('terse');
    expect(result).toContain('Thanks,');
    expect(result).toContain('filler words');
  });

  it('includes user_notes even when confidence is low', async () => {
    mockLoad.mockResolvedValue(
      makeProfile({
        user_notes: 'Never use exclamation marks.',
        stats: { edits_analyzed: 0, confidence: 0, last_updated: null, derived_from: [] },
      }),
    );
    const result = await loadStyleProfileBlock('acc-1');
    expect(result).not.toBeNull();
    expect(result).toContain('Never use exclamation marks.');
  });

  it('returns null (not throw) when loadStyleProfile throws', async () => {
    mockLoad.mockRejectedValue(new Error('db error'));
    await expect(loadStyleProfileBlock('acc-1')).resolves.toBeNull();
  });
});
