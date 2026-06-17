'use server';

import { redirect } from 'next/navigation';
import { appSession } from '../../../../lib/auth/app-session';

/** Toggle model-improvement contribution (R49 structural signals; T&C §7.1).
 * The hidden `enabled` field carries the target value ('true' | 'false'). */
export async function setContribution(formData: FormData) {
  const enabled = formData.get('enabled') === 'true';
  const { supabase, accountId } = await appSession();
  const { error } = await supabase.rpc('set_model_contribution', {
    target_account: accountId,
    enabled,
  });
  if (error) redirect('/app/settings/privacy?error=contribution');
  redirect('/app/settings/privacy?state=saved');
}
