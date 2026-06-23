/**
 * Gmail [N] — where solo business arrives (SPEC §4.3).
 *
 * Pending Google verification + CASA, this client runs on gmail.metadata
 * (headers/labels only) behind the 100-user tester allowlist (docs/RISKS.md
 * §1, docs/STATE.md). The §4.4 modules it powers (inquiry rate, overdue
 * threads, newsletter noise) are metadata-computable by design.
 *
 * Send paths exist for post-adoption write grants and are double-gated:
 * granted-scope check + send-velocity caps. Agent School stage gating happens
 * in the M4 runtime on top of this.
 *
 * Transport: Nango proxy lane ([N]). Token custody is Nango Cloud.
 */
import { NangoConnectorClient } from './nango-base';
import type { Nango } from '../nango-client';
import type { Connection } from '../types';
import { SendVelocityLimiter } from '../send-velocity';

/**
 * Thrown by makeGmailClient when a method=N connection has no nangoConnectionId.
 * N-method connections MUST have a nangoConnectionId — vault reads are blocked
 * for N connections (no live vault token). This typed error lets callers surface
 * a "reconnect required" message rather than silently calling Nango with ''.
 */
export class NangoConnectionMissingError extends Error {
  constructor(
    readonly provider: string,
    readonly connectionId: string,
  ) {
    super(
      `${provider} connection ${connectionId} is method=N but has no nangoConnectionId — reconnect required`,
    );
    this.name = 'NangoConnectionMissingError';
  }
}

/**
 * Factory for GmailClient — the preferred way to instantiate the client in
 * apps/web. Validates that method=N connections have a non-null nangoConnectionId
 * (N connections have no live vault token; an empty string would silently
 * send invalid Nango requests). Non-N connections are passed through with
 * an empty string id for backward compatibility.
 */
export function makeGmailClient(connection: Connection, nango: Nango): GmailClient {
  if (connection.provider !== 'gmail') {
    throw new Error(`provider mismatch: expected gmail, got ${connection.provider}`);
  }
  if (connection.method === 'N' && !connection.nangoConnectionId) {
    throw new NangoConnectionMissingError(connection.provider, connection.id);
  }
  return new GmailClient(connection, nango, connection.nangoConnectionId ?? '');
}

const SCOPE_COMPOSE = 'https://www.googleapis.com/auth/gmail.compose';
const SCOPE_SEND = 'https://www.googleapis.com/auth/gmail.send';

// ── Body helpers (exported for unit-testing without a live client) ──────────

const BODY_LIMIT = 8 * 1024; // 8 KB of plain text max

interface GmailFullMessage {
  id: string;
  snippet?: string;
  payload?: GmailPart;
}
interface GmailPart {
  mimeType?: string;
  body?: { data?: string };
  parts?: GmailPart[];
  headers?: Array<{ name: string; value: string }>;
}

export function decodeBase64Url(encoded: string): string {
  const base64 = encoded.replace(/-/g, '+').replace(/_/g, '/');
  return Buffer.from(base64, 'base64').toString('utf-8');
}

export function findPlainText(part: GmailPart): string | null {
  if (part.mimeType === 'text/plain' && part.body?.data) {
    return decodeBase64Url(part.body.data);
  }
  for (const child of part.parts ?? []) {
    const found = findPlainText(child);
    if (found) return found;
  }
  return null;
}

export interface GmailMessageMeta {
  id: string;
  threadId: string;
  labelIds?: string[];
  internalDate?: string;
  /** Short server-side preview (~first 200 chars). Present even on format=metadata. */
  snippet?: string;
  payload?: { headers?: Array<{ name: string; value: string }> };
}

interface ListMessagesResponse {
  messages?: Array<{ id: string; threadId: string }>;
  nextPageToken?: string;
  resultSizeEstimate?: number;
}

export class GmailClient extends NangoConnectorClient {
  constructor(
    connection: Connection,
    nango: Nango,
    nangoConnectionId: string,
  ) {
    super(connection, nango, 'google-mail', nangoConnectionId);
  }

  /** List message ids matching a Gmail query (e.g. `after:2026/03/01 in:inbox`). */
  async listMessages(query: string, pageToken?: string, maxResults = 100): Promise<ListMessagesResponse> {
    const params = new URLSearchParams({ q: query, maxResults: String(maxResults) });
    if (pageToken) params.set('pageToken', pageToken);
    const { data } = await this.readJson<ListMessagesResponse>(`/gmail/v1/users/me/messages?${params}`);
    return data;
  }

  /** Headers/labels only — works on the gmail.metadata scope. */
  async getMessageMetadata(id: string): Promise<GmailMessageMeta> {
    const params = new URLSearchParams({ format: 'metadata' });
    // Bcc is included so isSensitiveThread can screen reply-all/Bcc'd sensitive
    // recipients (RT-3: a bank Bcc'd on a sent message would otherwise pass the
    // sensitive-recipient gate even though the body reaches the LLM).
    for (const h of ['From', 'To', 'Cc', 'Bcc', 'Subject', 'Date', 'List-Unsubscribe', 'In-Reply-To']) {
      params.append('metadataHeaders', h);
    }
    const { data } = await this.readJson<GmailMessageMeta>(
      `/gmail/v1/users/me/messages/${encodeURIComponent(id)}?${params}`,
    );
    return data;
  }

  async listThreads(query: string, maxResults = 100): Promise<{ threads?: Array<{ id: string }> }> {
    const params = new URLSearchParams({ q: query, maxResults: String(maxResults) });
    const { data } = await this.readJson<{ threads?: Array<{ id: string }> }>(
      `/gmail/v1/users/me/threads?${params}`,
    );
    return data;
  }

  /** Fetch history since `startHistoryId`. historyTypes defaults to ['messageAdded']. */
  async historyList(
    opts: {
      startHistoryId: string;
      historyTypes?: string[];
      maxResults?: number;
    },
    signal?: AbortSignal,
  ): Promise<{
    history?: Array<{ id: string; messages?: Array<{ id: string; threadId: string }> }>;
    historyId?: string;
  }> {
    const params = new URLSearchParams({
      startHistoryId: opts.startHistoryId,
      maxResults: String(opts.maxResults ?? 100),
    });
    for (const ht of opts.historyTypes ?? ['messageAdded']) {
      params.append('historyTypes', ht);
    }
    const { data } = await this.readJson<{
      history?: Array<{ id: string; messages?: Array<{ id: string; threadId: string }> }>;
      historyId?: string;
    }>(`/gmail/v1/users/me/history?${params}`, signal);
    return data;
  }

  /** Returns the authenticated user's email address and current historyId. */
  async getProfile(): Promise<{ emailAddress: string; historyId: string }> {
    const { data } = await this.readJson<{ emailAddress: string; historyId: string }>(
      '/gmail/v1/users/me/profile',
    );
    return data;
  }

  /**
   * Fetch the plain-text body of a single message (Spec 4 sweep).
   * Uses format=full; walks the MIME tree to find text/plain; decodes base64url.
   * Truncates to 8 KB. Returns '' on any failure — the sweep must tolerate
   * individual message failures without aborting.
   */
  async getMessageBody(id: string): Promise<string> {
    try {
      const { data } = await this.readJson<GmailFullMessage>(
        `/gmail/v1/users/me/messages/${encodeURIComponent(id)}?format=full`,
      );
      const plain = data.payload ? findPlainText(data.payload) : null;
      if (plain) return plain.slice(0, BODY_LIMIT);
      // Fallback: subject + snippet
      const subject =
        data.payload?.headers?.find((h) => h.name.toLowerCase() === 'subject')?.value ?? '';
      const snippet = data.snippet ?? '';
      return `${subject}\n${snippet}`.trim().slice(0, BODY_LIMIT);
    } catch {
      return '';
    }
  }

  /** Register the Pub/Sub watch that powers the webhook path. */
  async watch(topicName: string): Promise<{ historyId?: string; expiration?: string }> {
    const res = await this.request('/gmail/v1/users/me/watch', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ topicName, labelIds: ['INBOX'] }),
    });
    return res.json() as { historyId?: string; expiration?: string };
  }

  /** Draft creation — needs the post-adoption gmail.compose grant. Drafts never send. */
  async createDraft(rawRfc822Base64Url: string): Promise<{ id?: string }> {
    this.requireGrantedScope(SCOPE_COMPOSE);
    const res = await this.request('/gmail/v1/users/me/drafts', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ message: { raw: rawRfc822Base64Url } }),
    });
    return res.json() as { id?: string };
  }

  /** Delete a draft (compose scope). Used to keep Nibbin/Gmail drafts in sync. */
  async deleteDraft(draftId: string): Promise<void> {
    this.requireGrantedScope(SCOPE_COMPOSE);
    await this.request(`/gmail/v1/users/me/drafts/${encodeURIComponent(draftId)}`, { method: 'DELETE' });
  }

  /** Send an existing draft (send scope + velocity already consumed by caller). */
  async sendDraft(draftId: string): Promise<{ id?: string }> {
    this.requireGrantedScope(SCOPE_SEND);
    const res = await this.request('/gmail/v1/users/me/drafts/send', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ id: draftId }),
    });
    return res.json() as { id?: string };
  }

  /**
   * Send — needs the post-adoption gmail.send grant AND a velocity-cap pass
   * (docs/RISKS.md §2: outbound-send abuse is an OAuth-app killer).
   */
  async sendMessage(
    rawRfc822Base64Url: string,
    limiter: SendVelocityLimiter,
    accountCreatedAtMs: number,
  ): Promise<{ id?: string }> {
    this.requireGrantedScope(SCOPE_SEND);
    const decision = await limiter.checkAndConsume(this.connection.accountId, this.descriptor, accountCreatedAtMs);
    if (!decision.allowed) {
      throw new Error(`send blocked by velocity cap (${decision.reason}); retry in ${decision.retryAfterMs}ms`);
    }
    const res = await this.request('/gmail/v1/users/me/messages/send', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ raw: rawRfc822Base64Url }),
    });
    return res.json() as { id?: string };
  }

  /**
   * Send without an in-process velocity limiter — velocity MUST already have
   * been consumed atomically (e.g. via the send_velocity_consume SQL RPC)
   * before calling this method. Callers that pre-consume via the RPC use this
   * to avoid the double-consume bug (FIX 1, Spec 2 review).
   */
  async sendMessageDirect(rawRfc822Base64Url: string): Promise<{ id?: string }> {
    this.requireGrantedScope(SCOPE_SEND);
    const res = await this.request('/gmail/v1/users/me/messages/send', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ raw: rawRfc822Base64Url }),
    });
    return res.json() as { id?: string };
  }

  private requireGrantedScope(scope: string): void {
    if (!this.connection.scopes.includes(scope)) {
      throw new Error(`connection lacks ${scope} — write scopes are granted per-Nibbin at adoption (C8)`);
    }
  }
}
