/**
 * Instagram / Meta Business DMs [H] — where creative inquiries actually
 * arrive (SPEC §4.3). Pending Meta app review (docs/STATE.md): connects are
 * tester-gated until approval.
 *
 * C8 note (also in the registry): Meta's instagram_business_manage_messages
 * covers both reading and sending — there is no read-only DM scope. The
 * compensating controls are structural: `sendReply` is the only send path,
 * it demands an explicit adoption grant recorded on the connection
 * (`dm.reply` in webhook_state.grants is NOT enough — the runtime writes the
 * grant into connection scopes metadata at adoption), and every send passes
 * the velocity caps. The M4 runtime adds Agent School stage gating on top.
 */
import { HttpConnectorClient } from './base';
import type { Connection } from '../types';
import type { TokenVault } from '../vault';
import type { UnsafeTestOverrides } from '../egress/safe-fetch';
import { SendVelocityLimiter } from '../send-velocity';

const BASE = 'https://graph.instagram.com';
/** Marker the adoption flow appends to connection.scopes when dm.reply unlocks. */
export const IG_REPLY_GRANT = 'nibbin:grant:dm.reply';

export interface IgConversation {
  id: string;
  updated_time?: string;
}

export interface IgMessage {
  id: string;
  created_time?: string;
  from?: { id: string };
  message?: string;
}

export class InstagramDmClient extends HttpConnectorClient {
  constructor(connection: Connection, vault: TokenVault, unsafeTestOverrides?: UnsafeTestOverrides) {
    super(connection, BASE, vault, unsafeTestOverrides);
  }

  async listConversations(): Promise<{ data?: IgConversation[] }> {
    const { data } = await this.readJson<{ data?: IgConversation[] }>(
      '/v23.0/me/conversations?fields=id,updated_time',
    );
    return data;
  }

  async listMessages(conversationId: string): Promise<{ data?: IgMessage[] }> {
    const { data } = await this.readJson<{ data?: IgMessage[] }>(
      `/v23.0/${encodeURIComponent(conversationId)}/messages?fields=id,created_time,from,message`,
    );
    return data;
  }

  /**
   * Post-adoption send path: explicit dm.reply grant + velocity caps
   * (stricter for IG — the hardest-won platform approval we'll hold).
   */
  async sendReply(
    recipientId: string,
    text: string,
    limiter: SendVelocityLimiter,
    accountCreatedAtMs: number,
  ): Promise<unknown> {
    if (!this.connection.scopes.includes(IG_REPLY_GRANT)) {
      throw new Error('connection lacks the dm.reply adoption grant — sends unlock per-Nibbin at adoption (C8)');
    }
    const decision = await limiter.checkAndConsume(this.connection.accountId, this.descriptor, accountCreatedAtMs);
    if (!decision.allowed) {
      throw new Error(`send blocked by velocity cap (${decision.reason}); retry in ${decision.retryAfterMs}ms`);
    }
    const res = await this.request('/v23.0/me/messages', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ recipient: { id: recipientId }, message: { text } }),
    });
    return res.json();
  }
}
