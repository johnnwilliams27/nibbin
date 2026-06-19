import type { ChannelAction, ChannelPort, DeliveryResult, OutboundChannelMessage } from '../types';

export interface TelegramConfig {
  botToken: string;
  fetchImpl?: typeof fetch;
}

const PLAN_ID_RE = /^p[sw]:/;

function button(a: ChannelAction, requestId?: string) {
  if (a.kind === 'open' && a.deepLink) return { text: a.label, url: a.deepLink };
  // Plan-session callbacks carry an explicit callbackData (e.g. 'ps:go').
  // Prefer explicit callbackData; fall back to id-prefix detection; else legacy.
  if (a.callbackData) return { text: a.label, callback_data: a.callbackData };
  if (PLAN_ID_RE.test(a.id)) return { text: a.label, callback_data: a.id };
  // Legacy: callback buttons carry "<requestId>:<kind>" so the inbound webhook
  // routes the press through the existing approval gate (Plan 05). Never a secret.
  return { text: a.label, callback_data: `${requestId ?? ''}:${a.kind}` };
}

export function telegramAdapter(cfg: TelegramConfig): ChannelPort {
  const doFetch = cfg.fetchImpl ?? fetch;
  return {
    channel: 'telegram',
    async deliver(msg: OutboundChannelMessage): Promise<DeliveryResult> {
      const body: Record<string, unknown> = { chat_id: msg.externalId, text: msg.body };
      if (msg.actions?.length) {
        body.reply_markup = { inline_keyboard: [msg.actions.map((a) => button(a, msg.requestId))] };
      }
      try {
        const res = await doFetch(`https://api.telegram.org/bot${cfg.botToken}/sendMessage`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(body),
        });
        const data = (await res.json()) as { ok: boolean; result?: { message_id: number }; description?: string };
        if (!res.ok || !data.ok) return { delivered: false, error: data.description ?? `telegram ${res.status}` };
        return { delivered: true, providerMessageId: String(data.result?.message_id ?? ''), costMicroUsd: 0 };
      } catch (e) {
        return { delivered: false, error: e instanceof Error ? e.message : 'telegram network error' };
      }
    },
  };
}
