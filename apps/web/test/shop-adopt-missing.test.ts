import { expect, it, vi } from 'vitest';

vi.mock('../lib/auth/app-session', () => ({ appSession: async () => ({ user: { id: 'u' }, accountId: 'a' }) }));
vi.mock('../lib/runtime/adopt', () => ({ adoptTemplate: async () => ({ missingConnectors: ['gmail'], name: 'Scribe', nibbinId: '', templateKey: 'scribe', stage: 'egg', firstRun: null, species: 'Sprout', palette: 'sage', accessory: 'none', marking: 'none', isFirstAdoption: true }) }));
vi.mock('@nibbin/runtime', () => ({ SHOP_TEMPLATE_KEYS: ['scribe'] }));

it('routes a missing-connector adopt to Connections with needed + resume', async () => {
  const { adoptFromShopOutcome } = await import('../app/app/shop/actions');
  const outcome = await adoptFromShopOutcome('scribe');
  expect(outcome).toEqual({ ok: false, redirectTo: '/app/connections?needed=gmail&resume=scribe' });
});
