/**
 * Shared plumbing for hand-built [H] connector clients.
 *
 * Every request: vault-read the token (C9 — tokens never live on this
 * object), egress through safeFetch pinned to the connector's allowlist,
 * quarantine the response (data, never instructions). Refresh-on-401 is the
 * caller's concern at M4; this layer surfaces a typed error.
 */
import { getConnector } from '../registry/registry';
import type { ConnectorDescriptor } from '../registry/types';
import { safeFetch, type SafeResponse, type UnsafeTestOverrides } from '../egress/safe-fetch';
import { quarantine, type QuarantinedContent } from '../quarantine';
import type { StoredToken, TokenVault } from '../vault';
import { refreshAccessToken } from '../oauth/flow';
import { oauthClientCredentials } from '../oauth/client-credentials';
import type { Connection, ConnectorClient } from '../types';

export class ConnectorRequestError extends Error {
  constructor(
    readonly provider: string,
    readonly status: number,
    readonly kind: 'auth' | 'rate-limit' | 'provider' | 'connection-state' | 'egress',
  ) {
    super(`${provider} request failed: ${kind} (status ${status})`);
    this.name = 'ConnectorRequestError';
  }
}

export class HttpConnectorClient implements ConnectorClient {
  readonly descriptor: ConnectorDescriptor;

  constructor(
    readonly connection: Connection,
    private readonly baseUrl: string,
    private readonly vault: TokenVault,
    private readonly unsafeTestOverrides?: UnsafeTestOverrides,
  ) {
    this.descriptor = getConnector(connection.provider);
    const base = new URL(baseUrl);
    if (!this.descriptor.egressAllowlist.some((p) => matches(base.hostname, p))) {
      throw new Error(`${connection.provider} base URL ${base.hostname} is outside its egress allowlist`);
    }
  }

  get provider(): string {
    return this.connection.provider;
  }

  protected async request(
    path: string,
    init: { method?: string; body?: string; headers?: Record<string, string>; signal?: AbortSignal } = {},
    isRetry = false,
  ): Promise<SafeResponse> {
    if (this.connection.status !== 'active') {
      // revoked/paused connections are unusable everywhere, not just in the UI
      throw new ConnectorRequestError(this.provider, 0, 'connection-state');
    }
    const token = await this.vault.read(this.connection.id);
    const res = await safeFetch(
      new URL(path, this.baseUrl).href,
      {
        method: init.method ?? 'GET',
        headers: {
          authorization: `${token.tokenType ?? 'Bearer'} ${token.accessToken}`,
          accept: 'application/json',
          ...init.headers,
        },
        body: init.body,
        signal: init.signal,
      },
      { allowedHosts: this.descriptor.egressAllowlist },
      this.unsafeTestOverrides,
    );
    if (res.status === 401 || res.status === 403) {
      // Access tokens expire ~hourly. On the first auth failure, try a one-shot
      // refresh-and-retry: refresh the access token from the stored refresh
      // token, re-seal it in the vault, and replay the request (which re-reads
      // the now-fresh token). If refresh is impossible or fails (no/revoked
      // refresh token), surface the auth error — the user must reconnect.
      if (!isRetry && (await this.tryRefresh(token))) {
        return this.request(path, init, true);
      }
      throw new ConnectorRequestError(this.provider, res.status, 'auth');
    }
    if (res.status === 429) throw new ConnectorRequestError(this.provider, res.status, 'rate-limit');
    if (res.status >= 400) throw new ConnectorRequestError(this.provider, res.status, 'provider');
    return res;
  }

  /** Refresh the access token from the stored refresh token and re-seal it.
   * Returns false (no throw) when refresh is impossible/fails so the caller can
   * fall through to a typed auth error. */
  private async tryRefresh(current: StoredToken): Promise<boolean> {
    if (!current.refreshToken) return false;
    const creds = oauthClientCredentials(this.connection.provider);
    if (!creds) return false;
    try {
      const next = await refreshAccessToken(
        this.connection.provider,
        current,
        creds.clientId,
        creds.clientSecret,
        this.unsafeTestOverrides,
      );
      await this.vault.store(this.connection.id, next);
      return true;
    } catch {
      return false;
    }
  }

  /** Read-only fetch; the result is quarantined external data. */
  async read(path: string): Promise<QuarantinedContent> {
    const res = await this.request(path);
    return quarantine(res.text(), `${this.provider}:${this.connection.id}:${path.split('?')[0]}`);
  }

  /** JSON convenience over read() for structured deterministic scans. */
  protected async readJson<T>(path: string, signal?: AbortSignal): Promise<{ data: T; quarantined: QuarantinedContent }> {
    const res = await this.request(path, { signal });
    const text = res.text();
    return {
      data: JSON.parse(text) as T,
      quarantined: quarantine(text, `${this.provider}:${this.connection.id}:${path.split('?')[0]}`),
    };
  }
}

function matches(host: string, pattern: string): boolean {
  const h = host.toLowerCase();
  const p = pattern.toLowerCase();
  if (p.startsWith('*.')) return h === p.slice(2) || h.endsWith(p.slice(1));
  return h === p;
}
