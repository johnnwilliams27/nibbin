/**
 * Token vault client (C9): OAuth tokens live in Supabase Vault, never in the
 * app database, never in logs. The app DB holds `connections.token_ref` — a
 * uuid into vault.secrets — and the only read/write path is the private.*
 * security-definer RPCs (service-role-execute only; see the M3 migration).
 *
 * Revocation cascades: `revoke()` destroys the vault secret and flips the
 * connection to 'revoked' in one transaction; the runtime treats any
 * non-'active' connection as unusable and pauses dependent Nibbins politely.
 */
import { safeFetch, type UnsafeTestOverrides } from './egress/safe-fetch';

/** What gets sealed into the vault. Never persisted or logged anywhere else. */
export interface StoredToken {
  accessToken: string;
  refreshToken?: string;
  /** epoch ms; undefined for non-expiring credentials */
  expiresAtMs?: number;
  tokenType?: string;
  /** scopes actually granted at consent time */
  scopes: string[];
}

export interface TokenVault {
  /** Seal a token payload for a connection; returns the vault reference. */
  store(connectionId: string, token: StoredToken): Promise<string>;
  /** Unseal — service-side only; throws if the connection has no live token. */
  read(connectionId: string): Promise<StoredToken>;
  /** One-click revoke: destroy the secret, mark the connection revoked. */
  revoke(connectionId: string, actorUserId?: string): Promise<void>;
}

/** Redact token material for any log/error surface. */
export function redactToken(token: StoredToken): Record<string, unknown> {
  return {
    accessToken: '[vaulted]',
    refreshToken: token.refreshToken === undefined ? undefined : '[vaulted]',
    expiresAtMs: token.expiresAtMs,
    tokenType: token.tokenType,
    scopes: token.scopes,
  };
}

function parseStoredToken(payload: string): StoredToken {
  const parsed = JSON.parse(payload) as Partial<StoredToken>;
  if (typeof parsed.accessToken !== 'string' || !Array.isArray(parsed.scopes)) {
    throw new Error('vault payload is not a StoredToken');
  }
  return parsed as StoredToken;
}

/** In-memory vault for tests and local harnesses. Same contract, no Supabase. */
export class MemoryTokenVault implements TokenVault {
  private secrets = new Map<string, string>();
  readonly revoked = new Set<string>();
  private refCounter = 0;

  async store(connectionId: string, token: StoredToken): Promise<string> {
    if (this.revoked.has(connectionId)) throw new Error(`connection ${connectionId} is revoked`);
    this.secrets.set(connectionId, JSON.stringify(token));
    return `memory-ref-${++this.refCounter}`;
  }

  async read(connectionId: string): Promise<StoredToken> {
    const payload = this.secrets.get(connectionId);
    if (payload === undefined) throw new Error(`connection ${connectionId} has no live token`);
    return parseStoredToken(payload);
  }

  async revoke(connectionId: string): Promise<void> {
    this.secrets.delete(connectionId);
    this.revoked.add(connectionId);
  }
}

export interface SupabaseVaultConfig {
  /** e.g. https://<ref>.supabase.co */
  supabaseUrl: string;
  /** sb_secret_* service key — server-side only, never NEXT_PUBLIC anything */
  serviceKey: string;
}

/**
 * Production vault: calls the M3 migration's security-definer RPCs through
 * PostgREST with the service key. Runs through safeFetch like every other
 * outbound request; the Supabase host is the only credential-entitled host.
 */
export class SupabaseTokenVault implements TokenVault {
  private readonly host: string;

  constructor(
    private readonly config: SupabaseVaultConfig,
    private readonly unsafeTestOverrides?: UnsafeTestOverrides,
  ) {
    const url = new URL(config.supabaseUrl);
    if (url.protocol !== 'https:' && !unsafeTestOverrides?.allowHttp) {
      throw new Error('supabaseUrl must be https');
    }
    this.host = url.hostname;
  }

  private async rpc(fn: string, args: Record<string, unknown>): Promise<string> {
    const res = await safeFetch(
      `${this.config.supabaseUrl.replace(/\/$/, '')}/rest/v1/rpc/${fn}`,
      {
        method: 'POST',
        headers: {
          apikey: this.config.serviceKey,
          authorization: `Bearer ${this.config.serviceKey}`,
          'content-type': 'application/json',
        },
        body: JSON.stringify(args),
      },
      { allowedHosts: [this.host] },
      this.unsafeTestOverrides,
    );
    if (res.status >= 400) {
      // PostgREST error bodies can echo arguments; never include them here
      throw new Error(`vault rpc ${fn} failed with status ${res.status}`);
    }
    return res.text();
  }

  async store(connectionId: string, token: StoredToken): Promise<string> {
    const ref = await this.rpc('connection_token_store', {
      p_connection: connectionId,
      p_token: JSON.stringify(token),
    });
    return ref.replaceAll('"', '');
  }

  async read(connectionId: string): Promise<StoredToken> {
    const raw = await this.rpc('connection_token_read', { p_connection: connectionId });
    return parseStoredToken(JSON.parse(raw) as string);
  }

  async revoke(connectionId: string, actorUserId?: string): Promise<void> {
    await this.rpc('connection_revoke', {
      p_connection: connectionId,
      p_actor_user: actorUserId ?? null,
    });
  }
}
