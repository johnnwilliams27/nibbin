/**
 * @nibbin/connectors — connector platform (M3).
 *
 * Registry (SPEC §4.3 declarations), OAuth engine (C8 read-only defaults,
 * PKCE/state, per-Nibbin write upgrades), token vault client (C9),
 * webhook signature verification + idempotency (§6.5), deny-by-default
 * egress proxy (§6.9 SSRF), quarantine markers (data, never instructions),
 * send-velocity caps (RISKS §2), Tier-1 hand-built clients, the aggregator
 * adapter, and the generic rails.
 *
 * M4 consumes: ConnectorClient, ScanModule/ScanContext/Finding (src/types.ts)
 * — defined exactly per SPEC §4.4 so scan modules and the runtime plug in
 * unchanged. See .claude/skills/connector-builder before adding a connector.
 */

// registry
export * from './registry/types';
export * from './registry/registry';

// interface consumed by M4
export * from './types';

// OAuth engine
export * from './oauth/pkce';
export * from './oauth/providers';
export * from './oauth/flow';

// vault (C9)
export * from './vault';

// webhooks
export * from './webhooks/verify';
export * from './webhooks/idempotency';

// egress proxy
export * from './egress/ip';
export * from './egress/safe-fetch';

// cross-cutting controls
export * from './quarantine';
export * from './send-velocity';

// hand-built Tier-1 clients
export * from './connectors/base';
export * from './connectors/gmail';
export * from './connectors/google-calendar';
export * from './connectors/calendar-delta';
export * from './connectors/stripe';
export * from './connectors/honeybook';
export * from './connectors/pixieset';
export * from './connectors/instagram';

// aggregator (method A)
export * from './aggregator';

// generic rails (method G)
export * from './rails/safe-socket';
export * from './rails/mcp';
export * from './rails/imap';
export * from './rails/smtp';
export * from './rails/caldav';
export * from './rails/csv';
export * from './rails/outbound-webhook';
