/**
 * Managed-auth aggregator adapter — method [A] (SPEC §4.3): hundreds of
 * connections at near-zero marginal cost via a Composio/Nango-class provider.
 *
 * Auth model: the aggregator hosts the OAuth dance and custodies provider
 * tokens; what WE custody is the aggregator connection id, and per C9 even
 * that opaque handle goes into the vault (it is a bearer capability against
 * our aggregator tenant). Requests to providers go through the aggregator's
 * proxy endpoint, which injects credentials server-side — provider tokens
 * never transit Nibbin.
 *
 * Scope policy is enforced at session creation: we ask the aggregator for
 * the descriptor's READ scopes only (C8); write-scope upgrades re-run a
 * session with read+write, per-Nibbin, same as the hand-built engine.
 */
import { getConnector } from './registry/registry';
import { safeFetch, type SafeResponse, type UnsafeTestOverrides } from './egress/safe-fetch';
import { quarantine, type QuarantinedContent } from './quarantine';
import type { TokenVault } from './vault';
import type { Connection, ConnectorClient } from './types';

export interface AggregatorConfig {
  /** e.g. https://api.nango.dev — server-side env, never NEXT_PUBLIC */
  baseUrl: string;
  secretKey: string;
}

export interface ConnectSession {
  sessionToken: string;
  expiresAtMs?: number;
}

export class AggregatorGateway {
  private readonly host: string;

  constructor(
    private readonly config: AggregatorConfig,
    private readonly unsafeTestOverrides?: UnsafeTestOverrides,
  ) {
    const url = new URL(config.baseUrl);
    if (url.protocol !== 'https:' && !unsafeTestOverrides?.allowHttp) {
      throw new Error('aggregator baseUrl must be https');
    }
    this.host = url.hostname;
  }

  private async call(path: string, init: { method?: string; body?: unknown } = {}): Promise<SafeResponse> {
    const res = await safeFetch(
      `${this.config.baseUrl.replace(/\/$/, '')}${path}`,
      {
        method: init.method ?? 'GET',
        headers: {
          authorization: `Bearer ${this.config.secretKey}`,
          'content-type': 'application/json',
        },
        body: init.body === undefined ? undefined : JSON.stringify(init.body),
      },
      { allowedHosts: [this.host] },
      this.unsafeTestOverrides,
    );
    if (res.status >= 400) throw new Error(`aggregator call ${path} failed with status ${res.status}`);
    return res;
  }

  /**
   * Hosted-auth session for a first connect — READ scopes only, always (C8).
   */
  async createConnectSession(provider: string, accountId: string): Promise<ConnectSession> {
    const descriptor = getConnector(provider);
    if (descriptor.method !== 'A') throw new Error(`${provider} is not an aggregator connector`);
    const res = await this.call('/connect/sessions', {
      method: 'POST',
      body: {
        provider: descriptor.id,
        end_user: { id: accountId },
        scopes: descriptor.scopes.read,
      },
    });
    const body = res.json() as { data?: { token?: string; expires_at?: string } };
    if (!body.data?.token) throw new Error('aggregator returned no session token');
    return {
      sessionToken: body.data.token,
      expiresAtMs: body.data.expires_at ? Date.parse(body.data.expires_at) : undefined,
    };
  }

  /**
   * Per-Nibbin write-scope upgrade (C8): read + the requested subset of
   * declared write scopes, with the plain-language reason recorded upstream.
   */
  async createWriteUpgradeSession(
    provider: string,
    accountId: string,
    writeScopes: string[],
    nibbinId: string,
    plainLanguageReason: string,
  ): Promise<ConnectSession> {
    const descriptor = getConnector(provider);
    if (descriptor.method !== 'A') throw new Error(`${provider} is not an aggregator connector`);
    if (!nibbinId.trim() || plainLanguageReason.trim().length < 12) {
      throw new Error('write scopes are requested per-Nibbin with a plain-language reason (C8)');
    }
    const declared = new Set(descriptor.scopes.write);
    for (const s of writeScopes) {
      if (!declared.has(s)) throw new Error(`"${s}" is not a declared write scope for ${provider}`);
    }
    const res = await this.call('/connect/sessions', {
      method: 'POST',
      body: {
        provider: descriptor.id,
        end_user: { id: accountId },
        scopes: [...descriptor.scopes.read, ...writeScopes],
      },
    });
    const body = res.json() as { data?: { token?: string } };
    if (!body.data?.token) throw new Error('aggregator returned no session token');
    return { sessionToken: body.data.token };
  }

  /** After callback: seal the aggregator connection handle into the vault (C9). */
  async storeConnectionHandle(vault: TokenVault, connectionId: string, aggregatorConnectionId: string): Promise<void> {
    await vault.store(connectionId, {
      accessToken: aggregatorConnectionId,
      tokenType: 'aggregator-connection',
      scopes: [],
    });
  }

  /** Proxy a provider request; credentials are injected aggregator-side. */
  async proxy(connection: Connection, vault: TokenVault, providerPath: string): Promise<SafeResponse> {
    if (connection.status !== 'active') throw new Error(`connection ${connection.id} is not active`);
    const handle = await vault.read(connection.id);
    return this.call(`/proxy/${encodeURIComponent(connection.provider)}${providerPath}`, {
      method: 'POST',
      body: { connection_id: handle.accessToken, method: 'GET', path: providerPath },
    });
  }
}

/** ConnectorClient over the aggregator proxy, for M4's scan engine. */
export class AggregatorConnectorClient implements ConnectorClient {
  constructor(
    readonly connection: Connection,
    private readonly gateway: AggregatorGateway,
    private readonly vault: TokenVault,
  ) {
    const d = getConnector(connection.provider);
    if (d.method !== 'A') throw new Error(`${connection.provider} is not an aggregator connector`);
  }

  get provider(): string {
    return this.connection.provider;
  }

  async read(path: string): Promise<QuarantinedContent> {
    const res = await this.gateway.proxy(this.connection, this.vault, path);
    return quarantine(res.text(), `${this.provider}:${this.connection.id}:${path.split('?')[0]}`);
  }
}
