'use server';

import { redirect } from 'next/navigation';
import { appSession } from '../../../../lib/auth/app-session';
import { parseNotificationPrefs } from '../../../../lib/privacy/notifications';
import { serviceClient } from '../../../../lib/supabase/service';
import { siteOrigin } from '../../../../lib/site-url';

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

/** Toggle Gmail sweep consent from the Data & Privacy panel.
 * On enable: stamps sweep_consent_at and dispatches the sweep (if not already consented).
 * On disable: clears sweep_consent_at and sweep_consent_by. */
export async function setSweepConsent(formData: FormData): Promise<void> {
  const enable = String(formData.get('enabled') ?? '') === 'true';
  const { user, accountId } = await appSession();
  const svc = serviceClient();
  const { data: conn } = await svc
    .from('connections')
    .select('id, sweep_consent_at')
    .eq('account_id', accountId)
    .eq('provider', 'gmail')
    .eq('status', 'active')
    .maybeSingle();
  if (!conn?.id) redirect('/app/settings/privacy?error=sweep');

  if (enable) {
    if (!conn.sweep_consent_at) {
      const { onGmailConnected } = await import('../../../../lib/sweep/dispatch');
      // stamps consent + dispatches; worker is the authority (fail-closed)
      await onGmailConnected(svc, siteOrigin(), conn.id as string, true, user.id);
    }
  } else {
    await svc
      .from('connections')
      .update({ sweep_consent_at: null, sweep_consent_by: null })
      .eq('id', conn.id as string);
  }
  redirect('/app/settings/privacy?state=sweep_saved');
}

export async function setNotificationPrefs(formData: FormData) {
  const { emailEnabled, quietStart, quietEnd } = parseNotificationPrefs(formData);
  const { supabase, accountId } = await appSession();
  const { error } = await supabase.rpc('set_notification_prefs', {
    target_account: accountId,
    email_enabled: emailEnabled,
    quiet_start: quietStart,
    quiet_end: quietEnd,
  });
  if (error) redirect('/app/settings/privacy?error=notify');
  redirect('/app/settings/privacy?state=notify_saved');
}
