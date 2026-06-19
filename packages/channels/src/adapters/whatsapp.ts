import type { ChannelPort, DeliveryResult, OutboundChannelMessage } from '../types';

export interface WhatsAppConfig {
  phoneNumberId: string;
  accessToken: string;
  perMessageMicroUsd: number;
  fetchImpl?: typeof fetch;
}

export function whatsappAdapter(cfg: WhatsAppConfig): ChannelPort {
  const doFetch = cfg.fetchImpl ?? fetch;
  return {
    channel: 'whatsapp',
    async deliver(msg: OutboundChannelMessage): Promise<DeliveryResult> {
      const buttons = (msg.actions ?? [])
        .filter((a) => a.kind === 'approve' || a.kind === 'deny')
        .slice(0, 3)
        .map((a) => ({ type: 'reply', reply: { id: `${msg.requestId ?? ''}:${a.kind}`, title: a.label } }));
      const payload = buttons.length
        ? { messaging_product: 'whatsapp', to: msg.externalId, type: 'interactive',
            interactive: { type: 'button', body: { text: msg.body }, action: { buttons } } }
        : { messaging_product: 'whatsapp', to: msg.externalId, type: 'text', text: { body: msg.body } };
      try {
        const res = await doFetch(`https://graph.facebook.com/v21.0/${cfg.phoneNumberId}/messages`, {
          method: 'POST',
          headers: { authorization: `Bearer ${cfg.accessToken}`, 'content-type': 'application/json' },
          body: JSON.stringify(payload),
        });
        const data = (await res.json()) as { messages?: { id: string }[]; error?: { message: string } };
        if (!res.ok || !data.messages?.[0]) return { delivered: false, error: data.error?.message ?? `whatsapp ${res.status}` };
        return { delivered: true, providerMessageId: data.messages[0].id, costMicroUsd: cfg.perMessageMicroUsd };
      } catch (e) {
        return { delivered: false, error: e instanceof Error ? e.message : 'whatsapp network error' };
      }
    },
  };
}
