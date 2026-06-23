import { describe, it, expect } from 'vitest';
import { resolveLinkCode, normalizeUtm, isLikelyBot, pickFirstTouchUtm } from '../../apps/web/lib/gtm/links';

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

describe('isLikelyBot', () => {
  it('treats a missing or empty user-agent as a bot (skip the click log)', () => {
    expect(isLikelyBot(null)).toBe(true);
    expect(isLikelyBot(undefined)).toBe(true);
    expect(isLikelyBot('')).toBe(true);
    expect(isLikelyBot('   ')).toBe(true);
  });

  it('flags link-preview crawlers and scrapers', () => {
    expect(isLikelyBot('facebookexternalhit/1.1')).toBe(true);
    expect(isLikelyBot('TelegramBot (like TwitterBot)')).toBe(true);
    expect(isLikelyBot('Slackbot-LinkExpanding 1.0')).toBe(true);
    expect(isLikelyBot('WhatsApp/2.0')).toBe(true);
    expect(isLikelyBot('curl/8.4.0')).toBe(true);
    expect(isLikelyBot('Googlebot/2.1')).toBe(true);
    expect(isLikelyBot('Mozilla/5.0 (X11) HeadlessChrome/120')).toBe(true);
  });

  it('lets a real mobile/desktop browser through', () => {
    expect(isLikelyBot('Mozilla/5.0 (iPhone; CPU iPhone OS 17_0) AppleWebKit/605 Safari/604')).toBe(false);
    expect(isLikelyBot('Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/120 Safari/537')).toBe(false);
  });
});

describe('pickFirstTouchUtm', () => {
  it('reads UTM off the URL when nothing is stored, and signals it should be persisted', () => {
    const { utm, fromUrl } = pickFirstTouchUtm(null, '?utm_source=tiktok&utm_medium=bio&ref=tt');
    expect(utm.utm_source).toBe('tiktok');
    expect(utm.utm_medium).toBe('bio');
    expect(utm.ref).toBe('tt');
    expect(fromUrl).toBe(true);
  });

  it('prefers a previously-stored first-touch set over a different URL (first-touch wins)', () => {
    const { utm, fromUrl } = pickFirstTouchUtm({ utm_source: 'instagram' }, '?utm_source=tiktok');
    expect(utm.utm_source).toBe('instagram');
    expect(fromUrl).toBe(false);
  });

  it('falls back to the URL when the stored value is empty or malformed (no real UTM)', () => {
    expect(pickFirstTouchUtm({}, '?utm_source=tiktok').utm.utm_source).toBe('tiktok');
    expect(pickFirstTouchUtm({ foo: 'bar' } as never, '?utm_source=tiktok').utm.utm_source).toBe('tiktok');
    expect(pickFirstTouchUtm({ utm_source: '' }, '?utm_source=tiktok').utm.utm_source).toBe('tiktok');
  });

  it('returns all-empty and no-persist when there is no UTM anywhere', () => {
    const { utm, fromUrl } = pickFirstTouchUtm(null, '');
    expect(utm).toEqual({ utm_source: '', utm_medium: '', utm_campaign: '', ref: '' });
    expect(fromUrl).toBe(false);
  });
});
