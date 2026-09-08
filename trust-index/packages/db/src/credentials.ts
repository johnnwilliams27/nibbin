/**
 * Storing and retrieving the credentials that unlock auth-walled subjects.
 *
 * The rule this module exists to enforce: a secret goes in encrypted and comes
 * out only when something is about to authenticate with it. Everything else —
 * listing, reporting, deciding whether a run is blocked — works on the metadata
 * beside it, so an operator can debug a credential without being handed one.
 */
import { and, eq, isNotNull, lte, or } from "drizzle-orm";
import { createCipheriv, createDecipheriv, randomBytes, createHash } from "node:crypto";
import type { Db } from "./client.js";
import { subject_credentials } from "./schema.js";

const KEY_ENV = "TRUST_INDEX_CREDENTIAL_KEY";

/**
 * The encryption key, from the environment and nowhere else.
 *
 * No default and no fallback, on purpose. A module that quietly invents a key
 * when the real one is absent produces ciphertext nobody can decrypt later, and
 * it fails at the worst moment — the next run, against a store full of secrets
 * that are now unreadable. Absent key, this throws and the caller decides.
 *
 * Any passphrase is accepted and hashed to 32 bytes rather than requiring a
 * hex-encoded key, because the alternative in practice is somebody storing a
 * shorter, more memorable string and padding it themselves.
 */
function key(env: NodeJS.ProcessEnv = process.env): Buffer {
  const raw = env[KEY_ENV];
  if (raw === undefined || raw.length < 16) {
    throw new Error(
      `${KEY_ENV} is not set (or is under 16 characters). Credentials are encrypted at rest; ` +
        `without the key they cannot be read or written.`,
    );
  }
  return createHash("sha256").update(raw).digest();
}

/** AES-256-GCM. Returns iv:tag:ciphertext, all base64. */
export function encryptSecret(plaintext: string, env?: NodeJS.ProcessEnv): string {
  const iv = randomBytes(12);
  const c = createCipheriv("aes-256-gcm", key(env), iv);
  const ct = Buffer.concat([c.update(plaintext, "utf8"), c.final()]);
  return [iv.toString("base64"), c.getAuthTag().toString("base64"), ct.toString("base64")].join(":");
}

export function decryptSecret(stored: string, env?: NodeJS.ProcessEnv): string {
  const [ivB64, tagB64, ctB64] = stored.split(":");
  if (ivB64 === undefined || tagB64 === undefined || ctB64 === undefined) {
    throw new Error("stored credential is malformed; expected iv:tag:ciphertext");
  }
  const d = createDecipheriv("aes-256-gcm", key(env), Buffer.from(ivB64, "base64"));
  d.setAuthTag(Buffer.from(tagB64, "base64"));
  // GCM authenticates: a wrong key or tampered row throws here rather than
  // returning plausible garbage that would be sent to a third party as a token.
  return Buffer.concat([d.update(Buffer.from(ctB64, "base64")), d.final()]).toString("utf8");
}

export type CredentialInput = {
  endpoint: string;
  subject_id: string;
  scheme: "header" | "bearer" | "query";
  param_name?: string | null;
  /** The secret in the clear — the value you PRESENT on a request. Encrypted before it touches the database. */
  secret: string;
  /** The value you REDEEM for a new secret, for OAuth pairs. Omit for a static key. */
  refresh?: string | null;
  /** True when redeeming invalidates the old refresh token, so callers must write the new one back. */
  refresh_rotates?: boolean;
  /** When the presented secret stops working (an access token's own lifetime). */
  secret_expires_at?: Date | null;
  /** Token endpoint / client_id needed to mint. Never a client secret — public clients only. */
  mint?: unknown;
  tier: "free" | "trial" | "paid";
  quota_note?: string | null;
  expires_at?: Date | null;
  obtained_via: string;
  account_ref?: string | null;
  notes?: string | null;
};

/** Store (or replace) the credential for one endpoint. */
export async function putCredential(db: Db, c: CredentialInput, env?: NodeJS.ProcessEnv): Promise<void> {
  const row = {
    endpoint: c.endpoint,
    subject_id: c.subject_id,
    scheme: c.scheme,
    param_name: c.param_name ?? null,
    secret_ct: encryptSecret(c.secret, env),
    refresh_ct: c.refresh === undefined || c.refresh === null ? null : encryptSecret(c.refresh, env),
    refresh_rotates: c.refresh_rotates ?? false,
    secret_expires_at: c.secret_expires_at ?? null,
    mint_json: c.mint ?? null,
    tier: c.tier,
    quota_note: c.quota_note ?? null,
    expires_at: c.expires_at ?? null,
    obtained_via: c.obtained_via,
    obtained_at: new Date(),
    account_ref: c.account_ref ?? null,
    status: "active",
    notes: c.notes ?? null,
  };
  await db
    .insert(subject_credentials)
    .values(row)
    .onConflictDoUpdate({ target: subject_credentials.endpoint, set: row });
}

/** What a caller needs to actually authenticate. The only path that decrypts. */
export type ResolvedCredential = {
  endpoint: string;
  scheme: "header" | "bearer" | "query";
  param_name: string | null;
  secret: string;
  /** Present when this is an OAuth pair. Redeem it for a fresh secret. */
  refresh: string | null;
  /** Redeeming the refresh token invalidates it — write the replacement back with `rotateCredential`. */
  refresh_rotates: boolean;
  /** When the presented secret lapses. Past this, mint a new one before calling. */
  secret_expires_at: Date | null;
  mint: unknown;
  tier: string;
  quota_note: string | null;
};

/**
 * Every usable credential, keyed by endpoint, ready to apply to a request.
 *
 * Expired and non-active rows are excluded HERE rather than by the caller, so
 * there is one place that decides what "usable" means. A run that skips a
 * subject because its trial lapsed must record a harness gap, not a finding —
 * see `staleCredentials` for the list to report.
 */
export async function loadCredentials(
  db: Db,
  env?: NodeJS.ProcessEnv,
): Promise<Map<string, ResolvedCredential>> {
  const rows = await db.select().from(subject_credentials).where(eq(subject_credentials.status, "active"));
  const now = Date.now();
  const out = new Map<string, ResolvedCredential>();
  for (const r of rows) {
    if (r.expires_at !== null && r.expires_at.getTime() <= now) continue;
    out.set(r.endpoint, {
      endpoint: r.endpoint,
      scheme: r.scheme as ResolvedCredential["scheme"],
      param_name: r.param_name,
      secret: decryptSecret(r.secret_ct, env),
      refresh: r.refresh_ct === null ? null : decryptSecret(r.refresh_ct, env),
      refresh_rotates: r.refresh_rotates,
      secret_expires_at: r.secret_expires_at,
      mint: r.mint_json,
      tier: r.tier,
      quota_note: r.quota_note,
    });
  }
  return out;
}

/**
 * Credentials that have stopped working, or are about to.
 *
 * This is a harness work queue and it is deliberately metadata-only: no secret
 * is decrypted to answer "what do I need to renew". A lapsed credential turning
 * into a low rating for the subject is the failure mode this whole project
 * keeps re-learning, so the list has to be visible before the run, not
 * reconstructed from a pile of 401s afterwards.
 */
export async function staleCredentials(
  db: Db,
  withinDays = 7,
): Promise<Array<{ endpoint: string; subject_id: string; status: string; expires_at: Date | null; quota_note: string | null }>> {
  const horizon = new Date(Date.now() + withinDays * 86_400_000);
  return db
    .select({
      endpoint: subject_credentials.endpoint,
      subject_id: subject_credentials.subject_id,
      status: subject_credentials.status,
      expires_at: subject_credentials.expires_at,
      quota_note: subject_credentials.quota_note,
    })
    .from(subject_credentials)
    .where(
      or(
        eq(subject_credentials.status, "exhausted"),
        eq(subject_credentials.status, "expired"),
        eq(subject_credentials.status, "revoked"),
        and(isNotNull(subject_credentials.expires_at), lte(subject_credentials.expires_at, horizon)),
      ),
    );
}

/** Apply a credential to a set of request headers. Query-scheme returns the pair to append. */
export class StaleSecretError extends Error {
  constructor(readonly endpoint: string, readonly detail: string) {
    super(`credential for ${endpoint} cannot be presented as-is: ${detail}`);
    this.name = "StaleSecretError";
  }
}

/**
 * Attach a credential to a request.
 *
 * THROWS rather than sending a secret that cannot work. The failure this
 * prevents is specific and was live: FrameThrower's stored secret is a refresh
 * token whose access token has lapsed. Sent as a bearer it earns a 401, and a
 * 401 is indistinguishable from the subject refusing us — so our stale token
 * would have been published as their availability failure. A loud throw the
 * caller records as a harness gap is the only correct behaviour here.
 */
export function applyCredential(
  c: ResolvedCredential,
  headers: Record<string, string>,
): { headers: Record<string, string>; query: [string, string] | null } {
  if (c.secret_expires_at !== null && c.secret_expires_at.getTime() <= Date.now()) {
    throw new StaleSecretError(
      c.endpoint,
      c.refresh === null
        ? "the secret has expired and there is no refresh token to mint a new one"
        : "the secret has expired; redeem `refresh` for a new one and write it back with rotateCredential",
    );
  }
  if (c.scheme === "bearer") {
    return { headers: { ...headers, authorization: `Bearer ${c.secret}` }, query: null };
  }
  if (c.scheme === "header") {
    return { headers: { ...headers, [c.param_name ?? "x-api-key"]: c.secret }, query: null };
  }
  return { headers, query: [c.param_name ?? "api_key", c.secret] };
}

/**
 * Write back a rotated OAuth pair, atomically.
 *
 * A rotating refresh token invalidates its predecessor the moment it is
 * redeemed, so a caller that mints and forgets to store the replacement has
 * silently destroyed the credential — and the next run reads the resulting 401
 * as the subject failing. This is the write half of that contract; nothing
 * should call a token endpoint without calling this immediately afterwards.
 */
export async function rotateCredential(
  db: Db,
  endpoint: string,
  next: { secret: string; refresh?: string | null; secret_expires_at?: Date | null },
  env?: NodeJS.ProcessEnv,
): Promise<void> {
  await db
    .update(subject_credentials)
    .set({
      secret_ct: encryptSecret(next.secret, env),
      ...(next.refresh === undefined
        ? {}
        : { refresh_ct: next.refresh === null ? null : encryptSecret(next.refresh, env) }),
      ...(next.secret_expires_at === undefined ? {} : { secret_expires_at: next.secret_expires_at }),
      last_verified_at: new Date(),
    })
    .where(eq(subject_credentials.endpoint, endpoint));
}

/** Record that a credential authenticated successfully, or that it stopped working. */
export async function markCredential(
  db: Db,
  endpoint: string,
  outcome: { status?: "active" | "exhausted" | "expired" | "revoked"; verified?: boolean; notes?: string },
): Promise<void> {
  await db
    .update(subject_credentials)
    .set({
      ...(outcome.status === undefined ? {} : { status: outcome.status }),
      ...(outcome.verified === true ? { last_verified_at: new Date() } : {}),
      ...(outcome.notes === undefined ? {} : { notes: outcome.notes }),
    })
    .where(eq(subject_credentials.endpoint, endpoint));
}
