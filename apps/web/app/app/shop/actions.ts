'use server';

/**
 * Shop adoption action (§4.6): one tap adopts; the Nibbin hatches in the grove
 * and the first draft follows fast. Returns an AdoptOutcome so the client can
 * play the hatch ceremony; the limit / missing-connector paths become a
 * navigation the client performs.
 */
import { SHOP_TEMPLATE_KEYS } from '@nibbin/runtime';
import { appSession } from '../../../lib/auth/app-session';
import { adoptTemplate } from '../../../lib/runtime/adopt';
import type { AdoptOutcome } from '../../../components/adopt/types';

export async function adoptFromShopOutcome(templateKey: string): Promise<AdoptOutcome> {
  if (!SHOP_TEMPLATE_KEYS.includes(templateKey)) throw new Error('unknown template');

  const { user, accountId } = await appSession();
  let result;
  try {
    result = await adoptTemplate(accountId, user.id, templateKey);
  } catch (e) {
    if (e instanceof Error && e.message === 'nibbin_limit') {
      return { ok: false, redirectTo: '/app/shop?limit=1' };
    }
    throw e;
  }

  if (result.missingConnectors.length > 0) {
    return {
      ok: false,
      redirectTo:
        `/app/connections?needed=${encodeURIComponent(result.missingConnectors.join(','))}` +
        `&resume=${encodeURIComponent(templateKey)}`,
    };
  }

  return {
    ok: true,
    nibbinId: result.nibbinId,
    name: result.name,
    species: result.species,
    stage: result.stage,
    palette: result.palette,
    accessory: result.accessory,
    marking: result.marking,
    isFirstAdoption: result.isFirstAdoption,
    ctaPath: '/app',
  };
}
