/**
 * Registry invariants — SPEC §4.3 declarations + C8 structure, enforced on
 * every catalog entry so a future connector can't quietly ship without them.
 */
import { describe, it, expect } from 'vitest';
import {
  CONNECTOR_REGISTRY,
  listConnectors,
  getConnector,
} from '../src/registry/registry';
import { validateDescriptor, capabilityCanSend, type ConnectorDescriptor } from '../src/registry/types';
import { OAUTH_PROVIDERS } from '../src/oauth/providers';
import { hostMatchesPattern } from '../src/egress/safe-fetch';

const validNDescriptor: ConnectorDescriptor = {
  id: 'test-nango',
  label: 'Test Nango',
  tier: 1,
  method: 'N',
  scopes: { read: ['some.scope'], write: [] },
  webhooks: { supported: false },
  rateLimit: { requests: 60, perSeconds: 60 },
  scanModules: [],
  capabilities: [],
  egressAllowlist: ['api.example.com'],
  availability: 'live',
};

const TIER1_CATALOG = [
  'gmail',
  'google-calendar',
  'outlook-m365',
  'google-drive',
  'stripe',
  'square',
  'paypal',
  'quickbooks',
  'honeybook',
  'dubsado',
  'pixieset',
  'calendly',
  'cal-com',
  'instagram-dm',
  'slack',
  'notion',
  'google-sheets-docs',
  'generic-mcp',
  'imap-smtp',
  'caldav',
];

// Task 7: gmail + google-calendar moved to method 'N'; stripe/honeybook/pixieset/instagram-dm stay 'H'
const M3_HAND_BUILT_H = ['stripe', 'honeybook', 'pixieset', 'instagram-dm'];
const M3_NANGO = ['gmail', 'google-calendar'];

describe('connector registry (SPEC §4.3)', () => {
  it('every descriptor validates', () => {
    for (const d of listConnectors()) {
      expect(validateDescriptor(d), d.id).toEqual([]);
    }
  });

  it('map keys match descriptor ids', () => {
    for (const [key, d] of CONNECTOR_REGISTRY) expect(key).toBe(d.id);
  });

  it('covers every §4.3 Tier-1 catalog row', () => {
    for (const id of TIER1_CATALOG) {
      expect(CONNECTOR_REGISTRY.has(id), `missing tier-1 connector ${id}`).toBe(true);
      expect(getConnector(id).tier).toBe(1);
    }
  });

  it('the four §8-M3 remaining hand-built connectors are live [H]', () => {
    for (const id of M3_HAND_BUILT_H) {
      const d = getConnector(id);
      expect(d.method, id).toBe('H');
      expect(d.availability, id).toBe('live');
    }
  });

  // Task 7: gmail + google-calendar promoted to Nango lane
  it('gmail and google-calendar use method N (Task 7)', () => {
    for (const id of M3_NANGO) {
      const d = getConnector(id);
      expect(d.method, id).toBe('N');
      expect(d.availability, id).toBe('live');
    }
  });

  it('stripe stays method H (Nango migration deferred — no Stripe OAuth app)', () => {
    expect(getConnector('stripe').method).toBe('H');
  });

  it('12+ connectors are live (M3 DoD)', () => {
    expect(listConnectors().filter((d) => d.availability === 'live').length).toBeGreaterThanOrEqual(12);
  });

  it('C8: read and write scope sets are disjoint everywhere', () => {
    for (const d of listConnectors()) {
      const read = new Set(d.scopes.read);
      for (const w of d.scopes.write) expect(read.has(w), `${d.id} ${w}`).toBe(false);
    }
  });

  it('Google providers are gated: pending verification, 100-user cap, tester allowlist', () => {
    for (const id of ['gmail', 'google-calendar', 'google-drive', 'google-sheets-docs']) {
      const p = getConnector(id).platform;
      expect(p?.verification, id).toBe('pending');
      expect(p?.unverifiedUserCap, id).toBe(100);
      expect(p?.testerAllowlistRequired, id).toBe(true);
      expect(p?.trackedIn, id).toContain('docs/STATE.md');
    }
  });

  it('gmail first-connect read scope is gmail.readonly (rich diagnosis data dump)', () => {
    const gmail = getConnector('gmail');
    expect(gmail.scopes.read).toEqual(['https://www.googleapis.com/auth/gmail.readonly']);
  });

  it('gmail scanModules does not include email.repeated-replies (regression guard)', () => {
    expect(getConnector('gmail').scanModules).not.toContain('email.repeated-replies');
  });

  it('Instagram is gated behind Meta app review', () => {
    const ig = getConnector('instagram-dm');
    expect(ig.platform?.verification).toBe('pending');
    expect(ig.platform?.testerAllowlistRequired).toBe(true);
  });

  it('generic rails declare no fixed hosts (deny-by-default proxy only)', () => {
    for (const d of listConnectors().filter((d) => d.method === 'G')) {
      expect(d.egressAllowlist, d.id).toEqual([]);
    }
  });

  it('A/H connectors declare egress allowlists', () => {
    for (const d of listConnectors().filter((d) => d.method !== 'G')) {
      expect(d.egressAllowlist.length, d.id).toBeGreaterThan(0);
    }
  });

  it('every send-capable connector carries velocity caps (RISKS §2)', () => {
    for (const d of listConnectors()) {
      const sendCapable = d.capabilities.some(capabilityCanSend);
      expect(Boolean(d.send), `${d.id} send caps`).toBe(sendCapable);
      if (d.send) {
        expect(d.send.velocity.newAccountPerDay).toBeLessThanOrEqual(d.send.velocity.perAccountPerDay);
      }
    }
  });

  it('webhook-supporting connectors declare scheme + replay window', () => {
    for (const d of listConnectors().filter((d) => d.webhooks.supported)) {
      expect(d.webhooks.scheme, d.id).toBeTruthy();
      expect(d.webhooks.replayWindowSecs, d.id).toBeGreaterThan(0);
    }
  });

  it('OAuth endpoints sit inside their connector egress allowlist', () => {
    for (const [provider, config] of Object.entries(OAUTH_PROVIDERS)) {
      const d = getConnector(provider);
      for (const endpoint of [config.authorizationUrl, config.tokenUrl]) {
        const host = new URL(endpoint).hostname;
        expect(
          d.egressAllowlist.some((p) => hostMatchesPattern(host, p)),
          `${provider}: ${host} not allowlisted`,
        ).toBe(true);
      }
    }
  });

  it('getConnector throws on unknown ids', () => {
    expect(() => getConnector('myspace')).toThrow(/unknown connector/);
  });

  // Task 5 — egress allowlist fix: Calendar API host must be in the allowlist
  it('google-calendar egressAllowlist includes calendar.googleapis.com', () => {
    const d = getConnector('google-calendar');
    expect(d.egressAllowlist).toContain('calendar.googleapis.com');
  });

  it('gmail descriptor declares both compose and send in scopes.write', () => {
    const gmail = getConnector('gmail');
    const write = gmail.scopes.write;
    expect(write).toContain('https://www.googleapis.com/auth/gmail.compose');
    expect(write).toContain('https://www.googleapis.com/auth/gmail.send');
  });

  // Task 1 — ConnectorMethod 'N' support
  it('accepts method N with a non-empty egress allowlist', () => {
    expect(validateDescriptor(validNDescriptor)).toEqual([]);
  });

  it('rejects method N with empty egress allowlist', () => {
    const d = { ...validNDescriptor, egressAllowlist: [] };
    expect(validateDescriptor(d)).toEqual(
      expect.arrayContaining([expect.stringContaining('egress allowlist')]),
    );
  });
});
