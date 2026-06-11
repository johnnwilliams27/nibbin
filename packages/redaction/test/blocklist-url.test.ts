import { describe, expect, it } from 'vitest';
import { blockedCategoryFor, EMPTY_EXCLUSIONS } from '../src/blocklist.js';
import { scrubUrl } from '../src/url.js';

const app = { bundleId: 'com.google.Chrome', name: 'Chrome' };

describe('category blocklist (C5)', () => {
  it('blocks by host suffix including subdomains', () => {
    expect(blockedCategoryFor({ title: 'Home' }, app, 'secure.chase.com')).toBe('banking');
    expect(blockedCategoryFor({ title: 'Home' }, app, 'mychart.org')).toBe('health');
  });

  it('does not block lookalike hosts', () => {
    expect(blockedCategoryFor({ title: 'Home' }, app, 'notchase.com')).toBeNull();
    expect(blockedCategoryFor({ title: 'Home' }, app, 'chase.com.evil.example')).toBeNull();
  });

  it('blocks by bundle id exact or prefix', () => {
    expect(blockedCategoryFor({ title: 'x' }, { bundleId: 'com.paypal', name: 'PayPal' }, null)).toBe('banking');
    expect(blockedCategoryFor({ title: 'x' }, { bundleId: 'com.paypal.mobile', name: 'PayPal' }, null)).toBe('banking');
  });

  it('blocks by title term, case-insensitively', () => {
    expect(blockedCategoryFor({ title: 'My Checking Account — Overview' }, app, null)).toBe('banking');
    expect(blockedCategoryFor({ title: 'Patient Portal — Lab Results' }, app, null)).toBe('health');
  });

  it('honors an explicit blocked category from the capture categorizer', () => {
    expect(blockedCategoryFor({ title: 'anything', category: 'banking' }, app, null)).toBe('banking');
  });

  it('user exclusions extend the blocklist at runtime', () => {
    const exclusions = { ...EMPTY_EXCLUSIONS, hosts: ['internal.example.com'] };
    expect(blockedCategoryFor({ title: 'x' }, app, 'internal.example.com', exclusions)).toBe('user_exclusion');
    expect(blockedCategoryFor({ title: 'x' }, app, 'internal.example.com')).toBeNull();
  });
});

describe('url scrubbing', () => {
  it('drops query strings and fragments entirely', () => {
    const r = scrubUrl('https://app.honeybook.com/invoices/9931?token=abc123&email=a@b.co#section');
    expect(r).toEqual({ host: 'app.honeybook.com', path_template: '/invoices/{id}' });
  });

  it('templates id-like segments but keeps workflow words', () => {
    const r = scrubUrl('https://example.com/clients/550e8400-e29b-41d4-a716-446655440000/edit');
    expect(r).toEqual({ host: 'example.com', path_template: '/clients/{id}/edit' });
  });

  it('returns null for non-http schemes and garbage', () => {
    expect(scrubUrl('file:///Users/me/secret.txt')).toBeNull();
    expect(scrubUrl('not a url')).toBeNull();
  });
});
