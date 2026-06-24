/**
 * Task 8 — `buildNangoConnectUrl` TDD suite.
 *
 * Covers:
 *  - Tester-allowlist gate on the [N] path (same invariant as [H])
 *  - Nango hosted connect URL construction
 *  - providerToNangoKey mapping
 *  - Non-N provider rejection
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { buildNangoConnectUrl, providerToNangoKey } from '../lib/connections/nango-connect';
import type { TesterAllowlist } from '@nibbin/connectors';

const allowAll: TesterAllowlist = { isAllowed: () => true, count: () => 0 };
const blockAll: TesterAllowlist = { isAllowed: () => false, count: () => 0 };
const fullCap: TesterAllowlist = { isAllowed: () => true, count: () => 100 };

describe('buildNangoConnectUrl', () => {
  beforeEach(() => {
    process.env.NANGO_PUBLIC_KEY = 'test-pub-key';
    process.env.NANGO_HOST = 'https://api.nango.dev';
  });

  it('builds Nango connect URL for gmail with correct providerConfigKey', () => {
    const result = buildNangoConnectUrl({
      provider: 'gmail',
      accountId: 'acc-123',
      userEmail: 'test@example.com',
      testerAllowlist: allowAll,
    });
    expect(result.url).toContain('/oauth/connect/google-mail');
    expect(result.url).toContain('connection_id=nibbin-acc-123-gmail');
    expect(result.url).toContain('public_key=test-pub-key');
    expect(result.nangoConnectionId).toBe('nibbin-acc-123-gmail');
  });

  it('builds Nango connect URL for google-calendar', () => {
    const result = buildNangoConnectUrl({
      provider: 'google-calendar',
      accountId: 'acc-456',
      userEmail: 'user@example.com',
      testerAllowlist: allowAll,
    });
    expect(result.url).toContain('/oauth/connect/google-calendar');
    expect(result.url).toContain('connection_id=nibbin-acc-456-google-calendar');
    expect(result.nangoConnectionId).toBe('nibbin-acc-456-google-calendar');
  });

  it('includes returnTo in state param when provided', () => {
    const result = buildNangoConnectUrl({
      provider: 'gmail',
      accountId: 'acc-1',
      userEmail: 'x@y.com',
      testerAllowlist: allowAll,
      returnTo: '/app/nibbins/123',
    });
    expect(result.url).toContain('state=');
  });

  // ===== TESTER-GATE ON [N] PATH — must NOT be lost =====

  it('throws tester-required when userEmail is null for pending provider', () => {
    expect(() =>
      buildNangoConnectUrl({
        provider: 'gmail',
        accountId: 'acc-1',
        userEmail: null,
        testerAllowlist: allowAll,
      }),
    ).toThrow('tester-required');
  });

  it('throws tester-not-allowed when email is not on allowlist', () => {
    expect(() =>
      buildNangoConnectUrl({
        provider: 'gmail',
        accountId: 'acc-1',
        userEmail: 'evil@example.com',
        testerAllowlist: blockAll,
      }),
    ).toThrow('tester-not-allowed');
  });

  it('throws tester-cap-reached when allowlist count >= 100 (gmail cap)', () => {
    expect(() =>
      buildNangoConnectUrl({
        provider: 'gmail',
        accountId: 'acc-1',
        userEmail: 'x@y.com',
        testerAllowlist: fullCap,
      }),
    ).toThrow('tester-cap-reached');
  });

  it('throws for non-N provider (honeybook is [H])', () => {
    expect(() =>
      buildNangoConnectUrl({
        provider: 'honeybook',
        accountId: 'a',
        userEmail: 'x@y.com',
        testerAllowlist: allowAll,
      }),
    ).toThrow('is not a Nango connector');
  });
});

describe('providerToNangoKey', () => {
  it('maps gmail to google-mail', () => {
    expect(providerToNangoKey('gmail')).toBe('google-mail');
  });

  it('maps google-calendar to google-calendar', () => {
    expect(providerToNangoKey('google-calendar')).toBe('google-calendar');
  });

  it('throws for unknown provider', () => {
    expect(() => providerToNangoKey('honeybook')).toThrow();
  });
});
