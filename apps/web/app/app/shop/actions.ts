'use server';

/**
 * Shop adoption action (§4.6): one tap adopts; the Nibbin hatches as an Egg
 * in the grove and the first draft follows fast. Trust-critical checks live
 * below this layer (trigger-graph validation in @nibbin/runtime, the tier cap
 * in the adopt_nibbin RPC).
 */
import { redirect } from 'next/navigation';
import { SHOP_TEMPLATE_KEYS } from '@nibbin/runtime';
import { appSession } from '../../../lib/auth/app-session';
import { adoptTemplate } from '../../../lib/runtime/adopt';

export async function adoptFromShopAction(formData: FormData): Promise<void> {
  const templateKey = String(formData.get('templateKey') ?? '');
  if (!SHOP_TEMPLATE_KEYS.includes(templateKey)) throw new Error('unknown template');

  const { user, accountId } = await appSession();
  let result;
  try {
    result = await adoptTemplate(accountId, user.id, templateKey);
  } catch (e) {
    if (e instanceof Error && e.message === 'nibbin_limit') redirect('/app/shop?limit=1');
    throw e;
  }

  if (result.missingConnectors.length > 0) {
    redirect(
      `/app/connections?needed=${encodeURIComponent(result.missingConnectors.join(','))}` +
        `&resume=${encodeURIComponent(templateKey)}`,
    );
  }
  // the hatch ceremony and the first draft live in the grove (the Keeper rides
  // along as the docked panel on Grove Home)
  redirect('/app');
}
