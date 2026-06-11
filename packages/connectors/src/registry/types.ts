/**
 * Connector registry schema — what every connector must declare.
 *
 * SPEC §4.3: "Every connector declares: scopes (read/write split), webhook
 * support, rate limits, and which scan modules (§4.4) and Nibbin capabilities
 * it powers." Plus the egress allowlist (§6.5/§6.9) and send-velocity caps
 * (docs/RISKS.md §2) this package enforces.
 */

export type ConnectorMethod = 'A' | 'H' | 'G';

/** How an inbound webhook from this provider is authenticated (§6.5). */
export type SignatureScheme =
  | 'hmac-sha256' // generic: hex HMAC of the raw body, optional timestamped variant
  | 'stripe-v1' // Stripe-Signature: t=...,v1=... over `${t}.${body}`
  | 'meta-hub-sha256' // X-Hub-Signature-256: sha256=<hex> over the raw body
  | 'slack-v0' // X-Slack-Signature: v0=<hex> over `v0:${ts}:${body}`
  | 'google-pubsub-oidc' // Pub/Sub push: RS256 OIDC JWT in Authorization, audience-checked
  | 'google-channel-token'; // Calendar/Drive push: shared channel token, timing-safe compare

export interface ScopeSet {
  /** Day One scopes — everything a connection gets at first consent (C8). */
  read: string[];
  /**
   * Requested per-Nibbin at adoption time, never at first connect, always with
   * a plain-language explanation (C8, §6.5 incremental consent).
   */
  write: string[];
}

export interface WebhookSupport {
  supported: boolean;
  scheme?: SignatureScheme;
  /** Events older than this are rejected even with a valid signature. */
  replayWindowSecs?: number;
}

export interface RateLimit {
  requests: number;
  perSeconds: number;
}

/** Per-account caps on anything that can send (docs/RISKS.md §2). */
export interface SendVelocityCaps {
  perAccountPerHour: number;
  perAccountPerDay: number;
  /** Accounts younger than this get the stricter new-account budget. */
  newAccountCooldownHours: number;
  newAccountPerDay: number;
}

export interface PlatformStatus {
  /** 'pending' = our OAuth app is not yet verified by the platform. */
  verification: 'approved' | 'pending' | 'not-required';
  /** Scopes that trigger heavyweight platform review (Google restricted, etc.). */
  restrictedScopes?: string[];
  /** Hard platform cap while unverified (Google: 100 test users). */
  unverifiedUserCap?: number;
  /** Connects must be gated to an explicit tester allowlist while pending. */
  testerAllowlistRequired?: boolean;
  /** Where the approval process is tracked. */
  trackedIn?: string;
}

export interface ConnectorDescriptor {
  /** Stable kebab-case provider id; the `connections.provider` value. */
  id: string;
  label: string;
  tier: 1 | 2 | 3;
  method: ConnectorMethod;
  scopes: ScopeSet;
  webhooks: WebhookSupport;
  rateLimit: RateLimit;
  /** §4.4 scan module ids this connection powers. */
  scanModules: string[];
  /** Nibbin capability ids this connection powers. */
  capabilities: string[];
  /**
   * Hosts this connector is allowed to reach, enforced by the egress proxy.
   * Exact hostnames or `*.suffix` patterns. MUST be empty for method G —
   * generic rails have no fixed hosts and run under the full deny-by-default
   * proxy (public IPs only, no credential forwarding).
   */
  egressAllowlist: string[];
  /** Required iff any capability can emit outbound content. */
  send?: { velocity: SendVelocityCaps };
  platform?: PlatformStatus;
  /** 'live' = code path exists in this package; 'planned' = catalog-only. */
  availability: 'live' | 'planned';
  notes?: string;
}

/** Capability suffixes that count as outbound sends and so require caps. */
const SEND_CAPABILITY_PATTERN = /\.(send|reply|nudge|post)$/;

export function capabilityCanSend(capability: string): boolean {
  return SEND_CAPABILITY_PATTERN.test(capability);
}

const KEBAB = /^[a-z0-9]+(-[a-z0-9]+)*$/;
const HOST_PATTERN = /^(\*\.)?[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$/i;

/**
 * Runtime validation — returns a list of problems (empty = valid). Run for
 * every entry by the registry test suite, and on any descriptor loaded from
 * outside this package.
 */
export function validateDescriptor(d: ConnectorDescriptor): string[] {
  const problems: string[] = [];
  const at = (msg: string) => problems.push(`${d.id || '<missing id>'}: ${msg}`);

  if (!KEBAB.test(d.id)) at('id must be kebab-case');
  if (!d.label.trim()) at('label required');
  if (!['A', 'H', 'G'].includes(d.method)) at(`unknown method ${d.method}`);

  // C8: the read/write split is structural. A scope may never be in both sets.
  const read = new Set(d.scopes.read);
  for (const w of d.scopes.write) {
    if (read.has(w)) at(`scope "${w}" appears in both read and write sets`);
  }
  if (d.scopes.read.length === 0 && d.method !== 'G') at('read scopes required for OAuth methods');

  if (d.webhooks.supported) {
    if (!d.webhooks.scheme) at('webhook scheme required when webhooks are supported');
    if (!d.webhooks.replayWindowSecs || d.webhooks.replayWindowSecs <= 0)
      at('positive replayWindowSecs required when webhooks are supported');
  } else if (d.webhooks.scheme) {
    at('webhook scheme declared but webhooks not supported');
  }

  if (d.rateLimit.requests <= 0 || d.rateLimit.perSeconds <= 0) at('rateLimit must be positive');

  if (d.method === 'G') {
    if (d.egressAllowlist.length > 0)
      at('generic rails must declare an empty egress allowlist (deny-by-default proxy only)');
  } else {
    if (d.egressAllowlist.length === 0) at('A/H connectors must declare an egress allowlist');
    for (const h of d.egressAllowlist) {
      if (!HOST_PATTERN.test(h)) at(`egress allowlist entry "${h}" is not a host pattern`);
    }
  }

  const sendCapable = d.capabilities.some(capabilityCanSend);
  if (sendCapable && !d.send) at('send-capable connector must declare velocity caps (RISKS §2)');
  if (!sendCapable && d.send) at('velocity caps declared but no send capability');
  if (d.send) {
    const v = d.send.velocity;
    if (v.perAccountPerHour <= 0 || v.perAccountPerDay <= 0 || v.newAccountPerDay <= 0)
      at('velocity caps must be positive');
    if (v.newAccountPerDay > v.perAccountPerDay) at('new-account cap must not exceed the standard cap');
  }

  if (d.platform?.verification === 'pending') {
    if (!d.platform.testerAllowlistRequired)
      at('pending platform verification requires testerAllowlistRequired');
    if (!d.platform.trackedIn) at('pending platform verification must reference where it is tracked');
  }

  return problems;
}
