import type { ChannelPort, DeliveryResult, OutboundChannelMessage } from '../types.js';

export interface SmsConfig {
  accountSid: string;
  authToken: string;
  fromNumber: string;
  perMessageMicroUsd: number;   // delivery COGS estimate (tuned against the §11 SMS sub-cap)
  fetchImpl?: typeof fetch;
}

/** SMS has no buttons — approve/deny become reply keywords (the inbound webhook
 *  maps the keyword back through the approval gate, Plan 05). */
function renderBody(msg: OutboundChannelMessage): string {
  const hasApprove = msg.actions?.some((a) => a.kind === 'approve');
  const hasDeny = msg.actions?.some((a) => a.kind === 'deny');
  const lines = [msg.body];
  if (hasApprove && hasDeny) lines.push('Reply APPROVE or DENY.');
  if (msg.deepLink) lines.push(msg.deepLink);
  return lines.join('\n');
}

export function smsAdapter(cfg: SmsConfig): ChannelPort {
  const doFetch = cfg.fetchImpl ?? fetch;
  const auth = 'Basic ' + Buffer.from(`${cfg.accountSid}:${cfg.authToken}`).toString('base64');
  return {
    channel: 'sms',
    async deliver(msg: OutboundChannelMessage): Promise<DeliveryResult> {
      const form = new URLSearchParams({ To: msg.externalId, From: cfg.fromNumber, Body: renderBody(msg) });
      try {
        const res = await doFetch(`https://api.twilio.com/2010-04-01/Accounts/${cfg.accountSid}/Messages.json`, {
          method: 'POST',
          headers: { authorization: auth, 'content-type': 'application/x-www-form-urlencoded' },
          body: form.toString(),
        });
        const data = (await res.json()) as { sid?: string; message?: string };
        if (!res.ok || !data.sid) return { delivered: false, error: data.message ?? `twilio ${res.status}` };
        return { delivered: true, providerMessageId: data.sid, costMicroUsd: cfg.perMessageMicroUsd };
      } catch (e) {
        return { delivered: false, error: e instanceof Error ? e.message : 'twilio network error' };
      }
    },
  };
}
