import { describe, it, expect } from 'vitest';
import { resolveLinkCode, normalizeUtm } from '../../apps/web/lib/gtm/links';

describe('resolveLinkCode', () => {
  it('maps the tiktok bio code to a tiktok bio redirect', () => {
    const r = resolveLinkCode('tt');
    expect(r).not.toBeNull();
    expect(r!.source).toBe('tiktok');
    expect(r!.medium).toBe('bio');
    expect(r!.campaign).toBe('launch');
    expect(r!.ref).toBe('tt');
    expect(r!.redirectPath).toBe('/?utm_source=tiktok&utm_medium=bio&utm_campaign=launch&ref=tt');
  });

  it('maps the ig and x bio codes to their platforms', () => {
    expect(resolveLinkCode('ig')!.source).toBe('instagram');
    expect(resolveLinkCode('x')!.source).toBe('x');
  });

  it('lowercases the incoming code', () => {
    expect(resolveLinkCode('TT')!.source).toBe('tiktok');
    expect(resolveLinkCode('TT')!.ref).toBe('tt');
  });

  it('treats an unknown but valid code as a video ref', () => {
    const r = resolveLinkCode('photographer-01');
    expect(r!.source).toBe('photographer-01');
    expect(r!.medium).toBe('video');
    expect(r!.ref).toBe('photographer-01');
  });

  it('always produces a same-origin relative redirect path for valid codes (open-redirect guard)', () => {
    for (const code of ['tt', 'ig', 'x', 'abc-123']) {
      expect(resolveLinkCode(code)!.redirectPath.startsWith('/?')).toBe(true);
    }
  });

  it('rejects codes with path or host characters', () => {
    expect(resolveLinkCode('../evil')).toBeNull();
    expect(resolveLinkCode('http://evil.com')).toBeNull();
    expect(resolveLinkCode('a/b')).toBeNull();
    expect(resolveLinkCode('a.b')).toBeNull();
    expect(resolveLinkCode('a b')).toBeNull();
  });

  it('rejects empty and over-long codes', () => {
    expect(resolveLinkCode('')).toBeNull();
    expect(resolveLinkCode('a'.repeat(65))).toBeNull();
  });
});

describe('normalizeUtm', () => {
  it('passes a clean value through', () => {
    expect(normalizeUtm('tiktok')).toBe('tiktok');
  });

  it('trims surrounding whitespace', () => {
    expect(normalizeUtm('  bio  ')).toBe('bio');
  });

  it('allows the url-safe punctuation utm values use', () => {
    expect(normalizeUtm('launch-2026')).toBe('launch-2026');
    expect(normalizeUtm('a_b.c-d')).toBe('a_b.c-d');
  });

  it('returns null for empty, non-string, over-long, or unsafe values', () => {
    expect(normalizeUtm('')).toBeNull();
    expect(normalizeUtm('   ')).toBeNull();
    expect(normalizeUtm(null)).toBeNull();
    expect(normalizeUtm(undefined)).toBeNull();
    expect(normalizeUtm(123)).toBeNull();
    expect(normalizeUtm('a'.repeat(65))).toBeNull();
    expect(normalizeUtm('has space')).toBeNull();
    expect(normalizeUtm('<script>')).toBeNull();
  });
});
