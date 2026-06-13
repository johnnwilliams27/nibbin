import { describe, expect, it } from 'vitest';
import { deriveRecommendations, DEFAULT_STARTER_CONNECTIONS } from './recommendations';
import type { UnderstandingProfile } from '@nibbin/keeper';

function profile(p: Partial<UnderstandingProfile>): UnderstandingProfile {
  return { jobTitle: null, businessModel: 'unknown', workShape: [], channels: [], tools: [], pains: [], confidence: 0, raw: [], ...p };
}

describe('deriveRecommendations', () => {
  it('recommends email + payments for a bookings business that mentions invoicing', () => {
    const rec = deriveRecommendations(profile({ businessModel: 'bookings', channels: ['email'], pains: ['invoicing'] }));
    const providers = rec.connections.map((c) => c.provider);
    expect(providers).toContain('gmail');
    expect(providers).toContain('stripe');
  });

  it('falls back to the default starter set for an empty profile (the floor)', () => {
    const rec = deriveRecommendations(profile({}));
    expect(rec.source).toBe('default_floor');
    expect(rec.connections.map((c) => c.provider)).toEqual(DEFAULT_STARTER_CONNECTIONS.map((c) => c.provider));
    expect(rec.nibbins.length).toBeGreaterThan(0);
  });

  it('never returns an empty connection list', () => {
    for (const bm of ['bookings', 'projects', 'jobs', 'products', 'retainer', 'mixed', 'unknown'] as const) {
      const rec = deriveRecommendations(profile({ businessModel: bm }));
      expect(rec.connections.length).toBeGreaterThan(0);
    }
  });
});
