'use server';

import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import { appSession } from '../../../lib/auth/app-session';
import { serviceClient } from '../../../lib/supabase/service';
import { adoptTemplate } from '../../../lib/runtime/adopt';
import type { AdoptOutcome } from '../../../components/adopt/types';

/**
 * Adopt a recommended Nibbin straight from the diagnosis reveal. Returns an
 * AdoptOutcome so the client can play the hatch ceremony; a missing connector
 * or error becomes a navigation the client performs instead of a redirect here.
 */
export async function adoptRecommendationOutcome(templateKey: string): Promise<AdoptOutcome> {
  const key = templateKey.trim();
  if (!key) return { ok: false, redirectTo: '/app/diagnosis' };

  const { user, accountId } = await appSession();

  try {
    const result = await adoptTemplate(accountId, user.id, key);
    if (result.missingConnectors.length > 0) {
      return {
        ok: false,
        redirectTo: `/app/diagnosis?needs=${encodeURIComponent(result.missingConnectors.join(','))}`,
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
  } catch {
    return { ok: false, redirectTo: '/app/diagnosis?error=adopt' };
  }
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
