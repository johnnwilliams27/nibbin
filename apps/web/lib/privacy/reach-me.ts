/**
 * Reach-me data loader — shared between the docked Keeper panel (layout.tsx)
 * and the focal onboarding canvas (page.tsx).
 *
 * "Reach me on the go" surfaces the same Telegram/SMS/WhatsApp channel-connect
 * flow that lives on /app/settings/privacy, but inside the Keeper chat. It
 * reuses the existing server actions (connectChannel / disconnectChannel /
 * saveChannelPrefs) verbatim — this loader only gathers the read state those
 * surfaces need to render. No new backend, no new RPC.
 *
 * It mirrors the same queries the privacy page runs (page.tsx lines ~59–76):
 * notification_channels, channel_prefs, and the feature flags. RLS scopes both
 * tables to the caller's account, so no explicit account filter is needed (the
 * privacy page relies on the same).
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import { channelMeta, type ChannelFlags } from './channels';

/** A connectable channel and its current state for the reach-me modal. */
export interface ReachMeChannel {
  channel: 'telegram' | 'sms' | 'whatsapp';
  label: string;
  help: string;
  live: boolean;
  /** notification_channels.id when connected (verified/pending), else null. */
  channelId: string | null;
  /** Connection status: 'verified' | 'pending' | null (not connected). */
  status: 'verified' | 'pending' | null;
  /** channel_prefs.enabled — the "Reach me here" toggle. Defaults true. */
  enabled: boolean;
  /** Existing pref values carried as hidden inputs so saving the toggle does
   *  not clobber the urgency/priority set on the granular privacy page. */
  priority: number;
  urgencyThreshold: string;
}

export interface ReachMeData {
  /** The Telegram bot handle (NEXT_PUBLIC_TELEGRAM_BOT) for the handoff copy. */
  botHandle: string | null;
  channels: ReachMeChannel[];
}

const CHANNELS = ['telegram', 'sms', 'whatsapp'] as const;

/**
 * Load reach-me channel state for the current account. `supabase` must be the
 * request-scoped client (RLS-enforced), exactly as the privacy page uses.
 */
export async function loadReachMeData(
  supabase: SupabaseClient,
): Promise<ReachMeData> {
  const [{ data: channels }, { data: chanPrefs }] = await Promise.all([
    supabase
      .from('notification_channels')
      .select('id, channel, status, external_label')
      .neq('status', 'revoked'),
    supabase
      .from('channel_prefs')
      .select('channel, enabled, priority, urgency_threshold'),
  ]);

  const flags: ChannelFlags = {
    telegram: !!process.env.TELEGRAM_BOT_TOKEN,
    sms: process.env.CHANNELS_SMS_ENABLED === 'true',
    whatsapp: process.env.CHANNELS_WHATSAPP_ENABLED === 'true',
  };
  const meta = channelMeta(flags);

  const connectedByChannel = new Map(
    ((channels ?? []) as Array<{ id: string; channel: string; status: string }>).map((c) => [
      c.channel,
      c,
    ]),
  );
  const prefByChannel = new Map(
    ((chanPrefs ?? []) as Array<{
      channel: string;
      enabled: boolean;
      priority: number;
      urgency_threshold: string;
    }>).map((p) => [p.channel, p]),
  );

  const out: ReachMeChannel[] = CHANNELS.map((ch) => {
    const m = meta[ch];
    const connected = connectedByChannel.get(ch);
    const pref = prefByChannel.get(ch);
    const status =
      connected?.status === 'verified'
        ? 'verified'
        : connected?.status === 'pending'
          ? 'pending'
          : null;
    return {
      channel: ch,
      label: m.label,
      help: m.help,
      live: m.live,
      channelId: connected?.id ?? null,
      status,
      enabled: pref?.enabled ?? true,
      priority: pref?.priority ?? 100,
      urgencyThreshold: pref?.urgency_threshold ?? 'all',
    };
  });

  return {
    botHandle: process.env.NEXT_PUBLIC_TELEGRAM_BOT ?? null,
    channels: out,
  };
}
