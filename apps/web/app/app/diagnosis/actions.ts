'use server';

import { redirect } from 'next/navigation';
import { appSession } from '../../../lib/auth/app-session';
import { adoptTemplate } from '../../../lib/runtime/adopt';

/**
 * Adopt a recommended Nibbin straight from the diagnosis reveal. Same path as
 * the grove's adopt (adoptTemplate → adopt_nibbin under the account lock). A
 * missing required connector bounces back with a hint rather than erroring.
 */
export async function adoptRecommendation(formData: FormData) {
  const templateKey = String(formData.get('templateKey') ?? '').trim();
  if (!templateKey) redirect('/app/diagnosis');

  const { user, accountId } = await appSession();

  // redirect() throws NEXT_REDIRECT, so resolve the target first, then redirect
  // OUTSIDE the try — otherwise the catch would swallow the redirect.
  let target = '/app/grove';
  try {
    const result = await adoptTemplate(accountId, user.id, templateKey);
    if (result.missingConnectors && result.missingConnectors.length > 0) {
      target = `/app/diagnosis?needs=${encodeURIComponent(result.missingConnectors.join(','))}`;
    }
  } catch {
    target = '/app/diagnosis?error=adopt';
  }
  redirect(target);
}
