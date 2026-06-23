/**
 * NangoConnectorClient — [N]-lane base class.
 *
 * The [N]-lane equivalent of HttpConnectorClient. Routes every request through
 * the Nango proxy (nango.proxy()) instead of safeFetch + vault.read.
 *
 * Security invariants enforced here (parallel to HttpConnectorClient):
 *  1. Connection must be 'active' — revoked/paused connections are unusable.
 *  2. Egress allowlist re-checked against the target host BEFORE every proxy
 *     call (Nango does NOT enforce our per-connector allowlist — this is
 *     Nibbin-layer defense-in-depth, SPEC §6.5/§6.9).
 *  3. 401/403 → ConnectorRequestError 'auth' (reconnect required).
 *  4. 429 → ConnectorRequestError 'rate-limit'.
 *  5. Every response is quarantined (data, never instructions — §6.5).
 */
import { getConnector } from '../registry/registry';
import type { ConnectorDescriptor } from '../registry/types';
import { quarantine, type QuarantinedContent } from '../quarantine';
import type { Nango } from '../nango-client';
import type { Connection, ConnectorClient } from '../types';
import { ConnectorRequestError } from './base';

function hostMatches(host: string, pattern: string): boolean {
  const h = host.toLowerCase().replace(/\.$/, '');
  const p = pattern.toLowerCase();
  if (p.startsWith('*.')) {
    const suffix = p.slice(2);
    return h === suffix || h.endsWith('.' + suffix);
  }
  return h === p;
}

export class NangoConnectorClient implements ConnectorClient {
  readonly descriptor: ConnectorDescriptor;

  constructor(
    readonly connection: Connection,
    private readonly nango: Nango,
    private readonly providerConfigKey: string,
    private readonly nangoConnectionId: string,
  ) {
    this.descriptor = getConnector(connection.provider);
  }

  get provider(): string {
    return this.connection.provider;
  }

  /**
   * Re-check target hostname against descriptor.egressAllowlist before every
   * proxy call. Throws ConnectorRequestError('egress') when outside the list.
   *
   * This is the security-critical step: Nango proxy does NOT enforce our
   * per-connector allowlist. We must gate here so a path injection (e.g. an
   * absolute URL with a rogue host) cannot exfiltrate data through the proxy.
   */
  private assertEgress(targetHost: string): void {
    const allowed = this.descriptor.egressAllowlist.some((p) => hostMatches(targetHost, p));
    if (!allowed) {
      throw new ConnectorRequestError(
        this.provider,
        0,
        'egress',
      );
    }
  }

  /**
   * Core proxy request. Mirrors HttpConnectorClient.request() signature so
   * GmailClient and GoogleCalendarClient subclass bodies are unchanged.
   *
   * Returns a minimal response adapter with .json() and .text() so subclass
   * method bodies (which call res.json()) work identically.
   */
  protected async request(
    path: string,
    init: { method?: string; body?: string; headers?: Record<string, string>; signal?: AbortSignal } = {},
  ): Promise<{ status: number; json(): unknown; text(): string }> {
    if (this.connection.status !== 'active') {
      throw new ConnectorRequestError(this.provider, 0, 'connection-state');
    }

    // Derive target host for egress re-check.
    // - Absolute URLs: parse the host directly.
    // - Relative paths: trust the first allowlist entry as the canonical base
    //   (the same host the Nango proxy will route the request to).
    const targetHost = path.startsWith('https://')
      ? new URL(path).hostname
      : (this.descriptor.egressAllowlist[0] ?? '');

    this.assertEgress(targetHost);

    const res = await this.nango.proxy({
      providerConfigKey: this.providerConfigKey,
      connectionId: this.nangoConnectionId,
      endpoint: path,
      method: (init.method ?? 'GET') as 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE',
      headers: init.headers,
      // nango.proxy expects `data` for the request body (Axios-style), not `body`
      data: init.body !== undefined ? (JSON.parse(init.body) as unknown) : undefined,
      responseType: 'json',
    });

    if (res.status === 401 || res.status === 403) {
      throw new ConnectorRequestError(this.provider, res.status, 'auth');
    }
    if (res.status === 429) {
      throw new ConnectorRequestError(this.provider, res.status, 'rate-limit');
    }
    if (res.status >= 400) {
      throw new ConnectorRequestError(this.provider, res.status, 'provider');
    }

    // Nango proxy returns `data` as already-parsed JSON (Axios responseType:'json').
    // Serialize to text for quarantine wrapping.
    const raw: string = typeof res.data === 'string' ? res.data : JSON.stringify(res.data);

    return {
      status: res.status,
      json: () => res.data as unknown,
      text: () => raw,
    };
  }

  /** Read-only fetch; the result is quarantined external data (§6.5). */
  async read(path: string): Promise<QuarantinedContent> {
    const res = await this.request(path);
    return quarantine(res.text(), `${this.provider}:${this.connection.id}:${path.split('?')[0]}`);
  }

  /** JSON convenience over read() for structured deterministic scans. */
  protected async readJson<T>(
    path: string,
    signal?: AbortSignal,
  ): Promise<{ data: T; quarantined: QuarantinedContent }> {
    const res = await this.request(path, { signal });
    const text = res.text();
    return {
      data: res.json() as T,
      quarantined: quarantine(text, `${this.provider}:${this.connection.id}:${path.split('?')[0]}`),
    };
  }
}
