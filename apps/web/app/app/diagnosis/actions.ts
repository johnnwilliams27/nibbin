'use server';

import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import { appSession } from '../../../lib/auth/app-session';
import { serviceClient } from '../../../lib/supabase/service';
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
  let target = '/app';
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

/**
 * Permanently delete a single diagnosis from the account's history (§6.11 +
 * #29 erasure). DELETE is REVOKED from `authenticated`, so this goes through
 * the service client. The service role bypasses RLS, so the explicit
 * `.eq('account_id', accountId)` IS the authz guard — never delete by id alone.
 */
export async function deleteDiagnosis(formData: FormData) {
  const id = String(formData.get('id') ?? '').trim();
  // Defensive: a missing/blank id deletes nothing and just bounces back.
  if (!id) redirect('/app/diagnosis');

  const { accountId } = await appSession();

  const svc = serviceClient();
  const { error } = await svc
    .from('diagnoses')
    .delete()
    .eq('id', id)
    .eq('account_id', accountId);

  if (!error) {
    // Best-effort analytics; never fail the delete on it.
    try {
      await svc.rpc('emit_product_event', {
        p_account: accountId,
        p_name: 'diagnosis_deleted',
        p_props: { diagnosisId: id },
      });
    } catch {
      // ignore
    }
    revalidatePath('/app/diagnosis');
  }

  redirect('/app/diagnosis');
}
