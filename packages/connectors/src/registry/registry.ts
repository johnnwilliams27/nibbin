/**
 * Tier-1 connector catalog (SPEC §4.3) — the registry every other layer
 * (OAuth engine, egress proxy, webhook router, M4 scan engine + runtime)
 * reads. Adding a connector means adding a descriptor here; the registry
 * test suite enforces the §4.3 declarations and C8 invariants on every entry.
 *
 * Google providers ship behind the 100-user test allowlist until OAuth
 * verification + CASA complete (docs/STATE.md "M1 approval tracking";
 * docs/RISKS.md §1). Meta likewise pending app review.
 */
import type { ConnectorDescriptor, PlatformStatus, SendVelocityCaps } from './types';

/** Conservative defaults per RISKS §2 — protect the OAuth app, not the spammer. */
export const DEFAULT_SEND_VELOCITY: SendVelocityCaps = {
  perAccountPerHour: 20,
  perAccountPerDay: 100,
  newAccountCooldownHours: 72,
  newAccountPerDay: 10,
};

const GOOGLE_PENDING: PlatformStatus = {
  verification: 'pending',
  unverifiedUserCap: 100,
  testerAllowlistRequired: true,
  trackedIn: 'docs/STATE.md (Google OAuth verification/CASA — NOT YET FILED)',
};

const META_PENDING: PlatformStatus = {
  verification: 'pending',
  testerAllowlistRequired: true,
  trackedIn: 'docs/STATE.md (Meta App Review — NOT YET FILED)',
};

const GOOGLE_AUTH_HOSTS = ['accounts.google.com', 'oauth2.googleapis.com', 'www.googleapis.com'];

const TIER1: ConnectorDescriptor[] = [
  {
    id: 'gmail',
    label: 'Gmail',
    tier: 1,
    method: 'H',
    scopes: {
      // gmail.readonly gives full read access including message bodies,
      // required by the diagnosis data dump for rich context. Still a Google
      // *restricted* scope: verification + CASA required, 100-user cap +
      // tester allowlist until then (RISKS §1).
      read: ['https://www.googleapis.com/auth/gmail.readonly'],
      write: [
        'https://www.googleapis.com/auth/gmail.compose',
        'https://www.googleapis.com/auth/gmail.send',
      ],
    },
    webhooks: { supported: true, scheme: 'google-pubsub-oidc', replayWindowSecs: 600 },
    rateLimit: { requests: 240, perSeconds: 60 },
    scanModules: ['email.inquiry-rate', 'email.overdue-threads', 'email.newsletter-noise'],
    capabilities: ['email.read', 'email.send'],
    egressAllowlist: ['gmail.googleapis.com', ...GOOGLE_AUTH_HOSTS],
    send: { velocity: DEFAULT_SEND_VELOCITY },
    platform: {
      ...GOOGLE_PENDING,
      restrictedScopes: [
        'https://www.googleapis.com/auth/gmail.metadata',
        'https://www.googleapis.com/auth/gmail.readonly',
        'https://www.googleapis.com/auth/gmail.compose',
        'https://www.googleapis.com/auth/gmail.send',
      ],
    },
    availability: 'live',
  },
  {
    id: 'google-calendar',
    label: 'Google Calendar',
    tier: 1,
    method: 'H',
    scopes: {
      read: ['https://www.googleapis.com/auth/calendar.readonly'],
      write: ['https://www.googleapis.com/auth/calendar.events'],
    },
    webhooks: { supported: true, scheme: 'google-channel-token', replayWindowSecs: 600 },
    rateLimit: { requests: 600, perSeconds: 60 },
    scanModules: ['calendar.meeting-load', 'calendar.no-show-churn', 'calendar.confirmation-gaps'],
    capabilities: ['calendar.read', 'calendar.event-create'],
    egressAllowlist: GOOGLE_AUTH_HOSTS,
    platform: GOOGLE_PENDING,
    availability: 'live',
  },
  {
    id: 'outlook-m365',
    label: 'Outlook / Microsoft 365',
    tier: 1,
    method: 'A',
    scopes: {
      read: ['User.Read', 'Mail.Read', 'Calendars.Read', 'offline_access'],
      write: ['Mail.Send', 'Calendars.ReadWrite'],
    },
    webhooks: { supported: true, scheme: 'hmac-sha256', replayWindowSecs: 300 },
    rateLimit: { requests: 600, perSeconds: 60 },
    scanModules: [
      'email.inquiry-rate',
      'email.overdue-threads',
      'email.newsletter-noise',
      'calendar.meeting-load',
      'calendar.no-show-churn',
      'calendar.confirmation-gaps',
    ],
    capabilities: ['email.read', 'email.draft', 'email.send', 'calendar.read', 'calendar.event-create'],
    egressAllowlist: ['graph.microsoft.com', 'login.microsoftonline.com'],
    send: { velocity: DEFAULT_SEND_VELOCITY },
    availability: 'live',
  },
  {
    id: 'google-drive',
    label: 'Google Drive',
    tier: 1,
    method: 'A',
    scopes: {
      read: ['https://www.googleapis.com/auth/drive.metadata.readonly'],
      write: ['https://www.googleapis.com/auth/drive.file'],
    },
    webhooks: { supported: true, scheme: 'google-channel-token', replayWindowSecs: 600 },
    rateLimit: { requests: 600, perSeconds: 60 },
    scanModules: ['crm.delivery-latency'],
    capabilities: ['files.read'],
    egressAllowlist: GOOGLE_AUTH_HOSTS,
    platform: {
      ...GOOGLE_PENDING,
      restrictedScopes: ['https://www.googleapis.com/auth/drive.metadata.readonly'],
    },
    availability: 'live',
  },
  {
    id: 'stripe',
    label: 'Stripe',
    tier: 1,
    method: 'H',
    scopes: {
      // Stripe Connect OAuth: read_only is a real platform-level scope — C8
      // holds at the provider, not just in our code.
      read: ['read_only'],
      write: ['read_write'],
    },
    webhooks: { supported: true, scheme: 'stripe-v1', replayWindowSecs: 300 },
    rateLimit: { requests: 100, perSeconds: 1 },
    scanModules: [
      'payments.invoice-latency',
      'payments.overdue-balances',
      'payments.fee-leakage',
      'payments.recurring-revenue',
    ],
    capabilities: ['payments.read', 'invoice.nudge'],
    egressAllowlist: ['api.stripe.com', 'connect.stripe.com'],
    send: { velocity: DEFAULT_SEND_VELOCITY },
    availability: 'live',
  },
  {
    id: 'square',
    label: 'Square',
    tier: 1,
    method: 'A',
    scopes: {
      read: ['PAYMENTS_READ', 'ORDERS_READ', 'CUSTOMERS_READ', 'INVOICES_READ'],
      write: ['INVOICES_WRITE'],
    },
    webhooks: { supported: true, scheme: 'hmac-sha256', replayWindowSecs: 300 },
    rateLimit: { requests: 100, perSeconds: 10 },
    scanModules: ['payments.invoice-latency', 'payments.overdue-balances', 'payments.recurring-revenue'],
    capabilities: ['payments.read'],
    egressAllowlist: ['connect.squareup.com'],
    availability: 'live',
  },
  {
    id: 'paypal',
    label: 'PayPal',
    tier: 1,
    method: 'A',
    scopes: {
      read: ['openid', 'https://uri.paypal.com/services/reporting/search/read'],
      write: ['https://uri.paypal.com/services/invoicing'],
    },
    webhooks: { supported: true, scheme: 'hmac-sha256', replayWindowSecs: 300 },
    rateLimit: { requests: 60, perSeconds: 60 },
    scanModules: ['payments.overdue-balances', 'payments.fee-leakage'],
    capabilities: ['payments.read'],
    egressAllowlist: ['api-m.paypal.com', 'www.paypal.com'],
    availability: 'live',
  },
  {
    id: 'quickbooks',
    label: 'QuickBooks',
    tier: 1,
    method: 'A',
    scopes: {
      // Intuit offers no read-only accounting scope; C8 is enforced by this
      // package (read-only client methods until a Nibbin adoption grants
      // write capability at the runtime layer) — noted for the claims audit.
      read: ['com.intuit.quickbooks.accounting'],
      write: [],
    },
    webhooks: { supported: true, scheme: 'hmac-sha256', replayWindowSecs: 300 },
    rateLimit: { requests: 500, perSeconds: 60 },
    scanModules: ['payments.invoice-latency', 'payments.overdue-balances', 'payments.recurring-revenue'],
    capabilities: ['payments.read'],
    egressAllowlist: ['quickbooks.api.intuit.com', 'oauth.platform.intuit.com'],
    availability: 'live',
    notes: 'Platform has no read-only scope; read-only is enforced client-side until adoption.',
  },
  {
    id: 'honeybook',
    label: 'HoneyBook',
    tier: 1,
    method: 'H',
    scopes: {
      read: ['projects:read', 'contacts:read', 'payments:read'],
      write: ['messages:send'],
    },
    webhooks: { supported: true, scheme: 'hmac-sha256', replayWindowSecs: 300 },
    rateLimit: { requests: 120, perSeconds: 60 },
    scanModules: ['crm.lead-response-lag', 'crm.pipeline-stalls', 'crm.delivery-latency'],
    capabilities: ['crm.read', 'dm.reply'],
    egressAllowlist: ['api.honeybook.com'],
    send: { velocity: DEFAULT_SEND_VELOCITY },
    availability: 'live',
    notes: 'Partner API — production credentials require a HoneyBook partnership agreement.',
  },
  {
    id: 'dubsado',
    label: 'Dubsado',
    tier: 1,
    method: 'H',
    scopes: { read: ['projects:read', 'clients:read', 'invoices:read'], write: [] },
    webhooks: { supported: false },
    rateLimit: { requests: 60, perSeconds: 60 },
    scanModules: ['crm.lead-response-lag', 'crm.pipeline-stalls'],
    capabilities: ['crm.read'],
    egressAllowlist: ['api.dubsado.com'],
    availability: 'planned',
    notes: 'Tier-1 catalog entry; hand-built client lands fast-follow (M3 row names six [H] connectors).',
  },
  {
    id: 'pixieset',
    label: 'Pixieset',
    tier: 1,
    method: 'H',
    scopes: { read: ['galleries:read', 'collections:read', 'downloads:read'], write: [] },
    webhooks: { supported: true, scheme: 'hmac-sha256', replayWindowSecs: 300 },
    rateLimit: { requests: 60, perSeconds: 60 },
    scanModules: ['crm.delivery-latency'],
    capabilities: ['gallery.read'],
    egressAllowlist: ['api.pixieset.com'],
    availability: 'live',
  },
  {
    id: 'calendly',
    label: 'Calendly',
    tier: 1,
    method: 'A',
    scopes: { read: ['default'], write: [] },
    webhooks: { supported: true, scheme: 'hmac-sha256', replayWindowSecs: 300 },
    rateLimit: { requests: 120, perSeconds: 60 },
    scanModules: ['calendar.no-show-churn', 'calendar.confirmation-gaps'],
    capabilities: ['schedule.read'],
    egressAllowlist: ['api.calendly.com', 'auth.calendly.com'],
    availability: 'live',
  },
  {
    id: 'cal-com',
    label: 'Cal.com',
    tier: 1,
    method: 'A',
    scopes: { read: ['READ_BOOKING', 'READ_PROFILE'], write: ['WRITE_BOOKING'] },
    webhooks: { supported: true, scheme: 'hmac-sha256', replayWindowSecs: 300 },
    rateLimit: { requests: 120, perSeconds: 60 },
    scanModules: ['calendar.no-show-churn', 'calendar.confirmation-gaps'],
    capabilities: ['schedule.read'],
    egressAllowlist: ['api.cal.com'],
    availability: 'live',
    notes: 'Native MCP server also available — users can attach it through the generic-mcp rail.',
  },
  {
    id: 'instagram-dm',
    label: 'Instagram / Meta Business DMs',
    tier: 1,
    method: 'H',
    scopes: {
      // Meta does not split DM read from DM send: instagram_business_manage_messages
      // covers both, and reading the inbox is impossible without it. C8 is
      // therefore enforced at the runtime layer for this provider: the client
      // exposes read methods only until a Nibbin adoption unlocks dm.reply,
      // and every send passes the velocity caps. Recorded for the claims audit.
      read: ['instagram_business_basic', 'instagram_business_manage_messages'],
      write: [],
    },
    webhooks: { supported: true, scheme: 'meta-hub-sha256', replayWindowSecs: 300 },
    rateLimit: { requests: 200, perSeconds: 3600 },
    scanModules: ['dm.inquiry-rate', 'dm.overdue-threads'],
    capabilities: ['dm.read', 'dm.reply'],
    egressAllowlist: ['graph.instagram.com', 'graph.facebook.com', 'api.instagram.com', 'www.facebook.com'],
    send: { velocity: { ...DEFAULT_SEND_VELOCITY, perAccountPerHour: 10, perAccountPerDay: 50 } },
    platform: META_PENDING,
    availability: 'live',
  },
  {
    id: 'slack',
    label: 'Slack',
    tier: 1,
    method: 'A',
    scopes: {
      read: ['channels:read', 'channels:history', 'im:history', 'users:read'],
      write: ['chat:write'],
    },
    webhooks: { supported: true, scheme: 'slack-v0', replayWindowSecs: 300 },
    rateLimit: { requests: 60, perSeconds: 60 },
    scanModules: ['dm.inquiry-rate', 'dm.overdue-threads'],
    capabilities: ['chat.read', 'chat.post'],
    egressAllowlist: ['slack.com', 'api.slack.com'],
    send: { velocity: DEFAULT_SEND_VELOCITY },
    availability: 'live',
  },
  {
    id: 'notion',
    label: 'Notion',
    tier: 1,
    method: 'A',
    scopes: { read: ['read_content'], write: ['update_content', 'insert_content'] },
    webhooks: { supported: false },
    rateLimit: { requests: 3, perSeconds: 1 },
    scanModules: [],
    capabilities: ['notes.read'],
    egressAllowlist: ['api.notion.com'],
    availability: 'live',
  },
  {
    id: 'google-sheets-docs',
    label: 'Google Sheets / Docs',
    tier: 1,
    method: 'A',
    scopes: {
      read: [
        'https://www.googleapis.com/auth/spreadsheets.readonly',
        'https://www.googleapis.com/auth/documents.readonly',
      ],
      write: ['https://www.googleapis.com/auth/spreadsheets'],
    },
    webhooks: { supported: false },
    rateLimit: { requests: 300, perSeconds: 60 },
    scanModules: [],
    capabilities: ['sheets.read', 'docs.read'],
    egressAllowlist: ['sheets.googleapis.com', 'docs.googleapis.com', ...GOOGLE_AUTH_HOSTS],
    platform: GOOGLE_PENDING,
    availability: 'live',
  },
  {
    id: 'generic-mcp',
    label: 'Generic MCP server',
    tier: 1,
    method: 'G',
    scopes: { read: [], write: [] },
    webhooks: { supported: false },
    rateLimit: { requests: 60, perSeconds: 60 },
    scanModules: [],
    capabilities: ['mcp.tools'],
    egressAllowlist: [],
    availability: 'live',
    notes:
      'User-supplied MCP URL. Full deny-by-default egress proxy: public IPs only, DNS-rebinding safe, size/time limits, vault credentials are never forwarded. Tool results are quarantined.',
  },
  {
    id: 'imap-smtp',
    label: 'IMAP / SMTP',
    tier: 1,
    method: 'G',
    scopes: { read: [], write: [] },
    webhooks: { supported: false },
    rateLimit: { requests: 30, perSeconds: 60 },
    scanModules: ['email.inquiry-rate', 'email.overdue-threads', 'email.newsletter-noise'],
    capabilities: ['email.read', 'email.send'],
    egressAllowlist: [],
    send: { velocity: DEFAULT_SEND_VELOCITY },
    availability: 'live',
    notes: 'Mailbox opened with EXAMINE (read-only at the protocol layer) — C8 by construction.',
  },
  {
    id: 'caldav',
    label: 'CalDAV',
    tier: 1,
    method: 'G',
    scopes: { read: [], write: [] },
    webhooks: { supported: false },
    rateLimit: { requests: 30, perSeconds: 60 },
    scanModules: ['calendar.meeting-load', 'calendar.confirmation-gaps'],
    capabilities: ['calendar.read'],
    egressAllowlist: [],
    availability: 'live',
  },
  {
    id: 'csv-import',
    label: 'CSV import',
    tier: 1,
    method: 'G',
    scopes: { read: [], write: [] },
    webhooks: { supported: false },
    rateLimit: { requests: 10, perSeconds: 60 },
    scanModules: [],
    capabilities: ['data.import'],
    egressAllowlist: [],
    availability: 'live',
  },
  {
    id: 'webhook-rail',
    label: 'Inbound / outbound webhooks',
    tier: 1,
    method: 'G',
    scopes: { read: [], write: [] },
    webhooks: { supported: true, scheme: 'hmac-sha256', replayWindowSecs: 300 },
    rateLimit: { requests: 60, perSeconds: 60 },
    scanModules: [],
    capabilities: ['events.receive', 'events.post'],
    egressAllowlist: [],
    send: { velocity: DEFAULT_SEND_VELOCITY },
    availability: 'live',
  },
];

export const CONNECTOR_REGISTRY: ReadonlyMap<string, ConnectorDescriptor> = new Map(
  TIER1.map((d) => [d.id, d]),
);

export function getConnector(id: string): ConnectorDescriptor {
  const d = CONNECTOR_REGISTRY.get(id);
  if (!d) throw new Error(`unknown connector: ${id}`);
  return d;
}

export function listConnectors(): ConnectorDescriptor[] {
  return [...CONNECTOR_REGISTRY.values()];
}
