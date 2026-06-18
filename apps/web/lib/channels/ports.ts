import {
  floorAdapter, telegramAdapter, smsAdapter, whatsappAdapter,
  type ChannelKind, type ChannelPort, type ChannelStore, type NotificationsFloorStore,
} from '@nibbin/channels';
import type { SupabaseClient } from '@supabase/supabase-js';

type Env = Record<string, string | undefined>;

export function buildPorts(env: Env): { ports: Map<ChannelKind, ChannelPort>; floor: ChannelPort } {
  const ports = new Map<ChannelKind, ChannelPort>();
  if (env.TELEGRAM_BOT_TOKEN) ports.set('telegram', telegramAdapter({ botToken: env.TELEGRAM_BOT_TOKEN }));
  // ⚑ inert until Plan 06's offline registration flips the flag
  if (env.CHANNELS_SMS_ENABLED === 'true' && env.TWILIO_ACCOUNT_SID && env.TWILIO_AUTH_TOKEN && env.TWILIO_FROM_NUMBER) {
    ports.set('sms', smsAdapter({
      accountSid: env.TWILIO_ACCOUNT_SID, authToken: env.TWILIO_AUTH_TOKEN, fromNumber: env.TWILIO_FROM_NUMBER,
      perMessageMicroUsd: Number(env.TWILIO_PER_MESSAGE_MICROUSD ?? '7900'),
    }));
  }
  if (env.CHANNELS_WHATSAPP_ENABLED === 'true' && env.WHATSAPP_PHONE_NUMBER_ID && env.WHATSAPP_ACCESS_TOKEN) {
    ports.set('whatsapp', whatsappAdapter({
      phoneNumberId: env.WHATSAPP_PHONE_NUMBER_ID, accessToken: env.WHATSAPP_ACCESS_TOKEN,
      perMessageMicroUsd: Number(env.WHATSAPP_PER_MESSAGE_MICROUSD ?? '5000'),
    }));
  }
  const floorStore: NotificationsFloorStore = {
    async insertNotification() { throw new Error('floor store must be bound per request via supabaseChannelStore'); },
  };
  return { ports, floor: floorAdapter(floorStore) };
}

export function supabaseChannelStore(svc: SupabaseClient): ChannelStore {
  return {
    async verifiedChannels(accountId) {
      const { data } = await svc.from('notification_channels')
        .select('channel, external_id').eq('account_id', accountId).eq('status', 'verified');
      return (data ?? []).map((r) => ({ channel: r.channel, externalId: r.external_id }));
    },
    async prefs(accountId) {
      const { data } = await svc.from('channel_prefs')
        .select('channel, enabled, priority, urgency_threshold').eq('account_id', accountId);
      return (data ?? []).map((r) => ({ channel: r.channel, enabled: r.enabled, priority: r.priority, urgencyThreshold: r.urgency_threshold }));
    },
    async quietHours(accountId) {
      const { data } = await svc.from('notification_settings')
        .select('quiet_start, quiet_end').eq('account_id', accountId).maybeSingle();
      return data ? { start: data.quiet_start, end: data.quiet_end } : null;
    },
    async logDelivery(row) {
      await svc.from('channel_messages').insert({
        account_id: row.accountId, channel: row.channel, direction: row.direction, kind: row.kind,
        status: row.status, urgency: row.urgency, provider_message_id: row.providerMessageId ?? null,
        cost_microusd: row.costMicroUsd, request_id: row.requestId ?? null,
      });
    },
  };
}
