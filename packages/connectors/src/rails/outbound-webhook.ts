/**
 * Outbound webhook rail [G] (SPEC §4.3) — POST events to a user-registered
 * URL. Deny-by-default egress (public hosts only, size/time limits), no
 * credentials of any kind attached, and every delivery is signed with the
 * rail's per-connection secret using the same timestamped scheme our inbound
 * verifier checks (t=...,v1=hex over `${t}.${body}`), so receivers can verify
 * and replay-bound us symmetrically. Velocity-capped like every send path.
 */
import { createHmac } from 'node:crypto';
import { getConnector } from '../registry/registry';
import { safeFetch, type UnsafeTestOverrides } from '../egress/safe-fetch';
import { SendVelocityLimiter } from '../send-velocity';

export interface OutboundWebhookDelivery {
  status: number;
  signatureHeader: string;
}

export async function deliverOutboundWebhook(
  targetUrl: string,
  payload: Record<string, unknown>,
  signingSecret: string,
  accountId: string,
  limiter: SendVelocityLimiter,
  accountCreatedAtMs: number,
  opts: { nowSecs?: number; unsafeTestOverrides?: UnsafeTestOverrides } = {},
): Promise<OutboundWebhookDelivery> {
  const descriptor = getConnector('webhook-rail');
  const decision = await limiter.checkAndConsume(accountId, descriptor, accountCreatedAtMs);
  if (!decision.allowed) {
    throw new Error(`delivery blocked by velocity cap (${decision.reason}); retry in ${decision.retryAfterMs}ms`);
  }
  const body = JSON.stringify(payload);
  const t = opts.nowSecs ?? Math.floor(Date.now() / 1000);
  const v1 = createHmac('sha256', signingSecret).update(`${t}.${body}`).digest('hex');
  const signatureHeader = `t=${t},v1=${v1}`;
  const res = await safeFetch(
    targetUrl,
    {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-nibbin-signature': signatureHeader },
      body,
    },
    { maxResponseBytes: 64 * 1024, timeoutMs: 10_000 },
    opts.unsafeTestOverrides,
  );
  return { status: res.status, signatureHeader };
}
