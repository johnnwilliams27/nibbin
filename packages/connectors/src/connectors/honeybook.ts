/**
 * HoneyBook [H] — photographer/creative CRM of record (SPEC §4.3). Partner
 * API; read scopes on Day One, messages:send arrives per-Nibbin (C8) and
 * passes the velocity caps.
 */
import { HttpConnectorClient } from './base';
import type { Connection } from '../types';
import type { TokenVault } from '../vault';
import type { UnsafeTestOverrides } from '../egress/safe-fetch';
import { SendVelocityLimiter } from '../send-velocity';

const BASE = 'https://api.honeybook.com';

export interface HoneyBookProject {
  id: string;
  stage?: string;
  created_at?: string;
  updated_at?: string;
  client_id?: string;
}

export class HoneyBookClient extends HttpConnectorClient {
  constructor(connection: Connection, vault: TokenVault, unsafeTestOverrides?: UnsafeTestOverrides) {
    super(connection, BASE, vault, unsafeTestOverrides);
  }

  async listProjects(updatedSinceIso: string, page = 1): Promise<{ projects?: HoneyBookProject[] }> {
    const params = new URLSearchParams({ updated_since: updatedSinceIso, page: String(page) });
    const { data } = await this.readJson<{ projects?: HoneyBookProject[] }>(`/v2/projects?${params}`);
    return data;
  }

  async listContacts(page = 1): Promise<{ contacts?: Array<{ id: string; created_at?: string }> }> {
    const { data } = await this.readJson<{ contacts?: Array<{ id: string; created_at?: string }> }>(
      `/v2/contacts?page=${page}`,
    );
    return data;
  }

  async listPayments(updatedSinceIso: string): Promise<{ payments?: Array<{ id: string; status?: string; due_at?: string; paid_at?: string }> }> {
    const params = new URLSearchParams({ updated_since: updatedSinceIso });
    const { data } = await this.readJson<{ payments?: Array<{ id: string; status?: string; due_at?: string; paid_at?: string }> }>(
      `/v2/payments?${params}`,
    );
    return data;
  }

  /** Post-adoption write path: messages:send grant + velocity caps. */
  async sendMessage(
    projectId: string,
    body: string,
    limiter: SendVelocityLimiter,
    accountCreatedAtMs: number,
  ): Promise<unknown> {
    if (!this.connection.scopes.includes('messages:send')) {
      throw new Error('connection lacks messages:send — write scopes are granted per-Nibbin at adoption (C8)');
    }
    const decision = await limiter.checkAndConsume(this.connection.accountId, this.descriptor, accountCreatedAtMs);
    if (!decision.allowed) {
      throw new Error(`send blocked by velocity cap (${decision.reason}); retry in ${decision.retryAfterMs}ms`);
    }
    const res = await this.request(`/v2/projects/${encodeURIComponent(projectId)}/messages`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ body }),
    });
    return res.json();
  }
}
