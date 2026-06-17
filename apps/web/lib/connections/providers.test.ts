import { describe, expect, it } from 'vitest';
import { CONNECTABLE_PROVIDERS } from './providers';

it('lists Gmail as the only wired provider for v1', () => {
  const gmail = CONNECTABLE_PROVIDERS.find((p) => p.id === 'gmail');
  expect(gmail?.wired).toBe(true);
  expect(CONNECTABLE_PROVIDERS.filter((p) => p.wired)).toHaveLength(1);
});
