import { expect, it, vi } from 'vitest';

vi.mock('../lib/auth/app-session', () => ({ appSession: async () => ({ user: { id: 'u' }, accountId: 'a' }) }));
vi.mock('../lib/runtime/adopt', () => ({ adoptTemplate: async () => ({ missingConnectors: ['gmail'], name: 'Scribe', nibbinId: '', templateKey: 'scribe', stage: 'egg', firstRun: null }) }));
const redirected: string[] = [];
vi.mock('next/navigation', () => ({ redirect: (u: string) => { redirected.push(u); throw new Error('REDIRECT'); } }));
vi.mock('@nibbin/runtime', () => ({ SHOP_TEMPLATE_KEYS: ['scribe'] }));

it('routes a missing-connector adopt to Connections with needed + resume', async () => {
  const { adoptFromShopAction } = await import('../app/app/shop/actions');
  const fd = new FormData();
  fd.set('templateKey', 'scribe');
  await adoptFromShopAction(fd).catch(() => {});
  expect(redirected[0]).toBe('/app/connections?needed=gmail&resume=scribe');
});
