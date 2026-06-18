'use server';

import { redirect } from 'next/navigation';
import { appSession } from '../../../../lib/auth/app-session';
import { parseNotificationPrefs } from '../../../../lib/privacy/notifications';
import { serviceClient } from '../../../../lib/supabase/service';
import { siteOrigin } from '../../../../lib/site-url';
import { parseChannelPrefsForm, parseSettingsForm } from '../../../../lib/privacy/channels';

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

export async function connectChannel(formData: FormData) {
  const channel = String(formData.get('channel') ?? '');
  const { supabase, accountId } = await appSession();
  const { data: nonce, error } = await supabase.rpc('request_channel_link', {
    target_account: accountId,
    channel,
  });
  if (error || !nonce) redirect('/app/settings/privacy?error=channel');
  // Telegram: deep-link the user to the bot with the nonce; other channels add
  // their own completion path here as they go live.
  if (channel === 'telegram' && process.env.NEXT_PUBLIC_TELEGRAM_BOT) {
    redirect(`https://t.me/${process.env.NEXT_PUBLIC_TELEGRAM_BOT}?start=${nonce}`);
  }
  redirect(`/app/settings/privacy?state=channel_pending&nonce=${nonce}&channel=${channel}`);
}

export async function disconnectChannel(formData: FormData) {
  const channelId = String(formData.get('channel_id') ?? '');
  const { supabase, accountId } = await appSession();
  const { error } = await supabase.rpc('revoke_channel', { target_account: accountId, channel_id: channelId });
  redirect(error ? '/app/settings/privacy?error=channel' : '/app/settings/privacy?state=channel_removed');
}

export async function saveChannelPrefs(formData: FormData) {
  const { channel, enabled, priority, urgencyThreshold } = parseChannelPrefsForm(formData);
  const { supabase, accountId } = await appSession();
  const { error } = await supabase.rpc('set_channel_prefs', {
    target_account: accountId,
    p_channel: channel, // NB: the SQL param is `p_channel` (renamed to avoid an ON CONFLICT (account_id, channel) ambiguity in Plan 01)
    enabled,
    priority,
    urgency_threshold: urgencyThreshold,
  });
  redirect(error ? '/app/settings/privacy?error=channel' : '/app/settings/privacy?state=channel_saved');
}

export async function saveNotificationSettings(formData: FormData) {
  const { quietStart, quietEnd, digestMode } = parseSettingsForm(formData);
  const { supabase, accountId } = await appSession();
  // Write the unified per-account settings...
  const { error } = await supabase.rpc('set_notification_settings', {
    target_account: accountId,
    quiet_start: quietStart,
    quiet_end: quietEnd,
    digest_mode: digestMode,
  });
  // ...and mirror quiet hours into drip_arcs so the LIVE companion-email arc
  // keeps honoring them until the drip worker reads notification_settings
  // (flagged follow-up). Errors here are non-fatal (a pre-arc account has no
  // drip row yet); the unified row is the source of truth.
  await supabase.rpc('set_notification_prefs', {
    target_account: accountId,
    email_enabled: formData.get('email_enabled') === 'on',
    quiet_start: quietStart,
    quiet_end: quietEnd,
  });
  redirect(error ? '/app/settings/privacy?error=quiet' : '/app/settings/privacy?state=quiet_saved');
}
