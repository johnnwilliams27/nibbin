import { expect, it, describe } from 'vitest';
import { CONNECTABLE_PROVIDERS } from '../lib/connections/providers';
import { CONNECTORS } from '../lib/connections/catalog';

describe('google-calendar is lit up', () => {
  it('is wired in CONNECTABLE_PROVIDERS', () => {
    expect(CONNECTABLE_PROVIDERS.find((p) => p.id === 'google-calendar')?.wired).toBe(true);
  });
  it('shows live in the user-facing catalog', () => {
    const entry = CONNECTORS.find((x) => x.id === 'google-calendar');
    expect(entry?.status).toBe('live');
  });
});
