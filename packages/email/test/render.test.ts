/**
 * Renderer rules: plain-text parity is structural, one celebration max, the
 * CAN-SPAM footer is always present with a working unsubscribe link, all
 * interpolated content is escaped, and the design contract holds (shell
 * background, no Title Case subjects).
 */
import { describe, expect, it } from 'vitest';
import type { BeatContent } from '@nibbin/drip';
import { renderBeatEmail } from '../src/render';
import { templateFor } from '../src/templates';
import { verifyUnsubscribeToken } from '../src/unsubscribe';
import type { MailerConfig } from '../src/types';

const CONFIG: MailerConfig = {
  from: 'Nibbin <keeper@mail.nibbin.com>',
  siteUrl: 'https://nibbin.com',
  postalAddress: '548 Market St PMB 00000, San Francisco, CA 94104',
  unsubscribeSecret: 'test-secret',
  warmupStart: new Date('2026-05-01T00:00:00Z'),
};

function content(over: Partial<BeatContent> = {}): BeatContent {
  return {
    key: 'half_time',
    title: 'Half-time Report',
    body: 'We’re a week in — halfway to your diagnosis.',
    cards: [
      { title: 'Scout', body: '3 nibbles done, 1 draft waiting on you' },
      { title: 'Diagnosis day', body: 'On track for 2026-06-15.' },
    ],
    celebration: { heading: 'Scout evolved', body: 'Verified accuracy, earned in the open.' },
    ctaPath: '/app',
    ctaLabel: 'See the full report',
    ...over,
  };
}

describe('renderBeatEmail', () => {
  it('renders every content block into BOTH the html and the text part', () => {
    const msg = renderBeatEmail(content(), 'casey@example.com', CONFIG);
    for (const part of [msg.html, msg.text]) {
      expect(part).toContain('Half-time Report');
      expect(part).toContain('halfway to your diagnosis');
      expect(part).toContain('Scout');
      expect(part).toContain('3 nibbles done, 1 draft waiting on you');
      expect(part).toContain('Scout evolved');
      expect(part).toContain('See the full report');
      expect(part).toContain('https://nibbin.com/app');
    }
  });

  it('carries the CAN-SPAM footer everywhere: why, postal address, unsubscribe', () => {
    const msg = renderBeatEmail(content(), 'casey@example.com', CONFIG);
    for (const part of [msg.html, msg.text]) {
      expect(part).toContain('because you hatched a grove');
      expect(part).toContain(CONFIG.postalAddress);
      expect(part).toContain('/api/email/unsubscribe?token=');
    }
    // The link verifies back to the recipient — it will actually work.
    const m = msg.text.match(/unsubscribe\?token=([^\s]+)/);
    expect(m).not.toBeNull();
    const token = decodeURIComponent(m![1]);
    expect(verifyUnsubscribeToken(token, CONFIG.unsubscribeSecret)).toBe('casey@example.com');
  });

  it('sets RFC 8058 one-click headers', () => {
    const msg = renderBeatEmail(content(), 'casey@example.com', CONFIG);
    expect(msg.headers['List-Unsubscribe']).toMatch(/^<https:\/\/nibbin\.com\/api\/email\/unsubscribe\?token=/);
    expect(msg.headers['List-Unsubscribe-Post']).toBe('List-Unsubscribe=One-Click');
  });

  it('renders at most one celebration block', () => {
    const msg = renderBeatEmail(content(), 'casey@example.com', CONFIG);
    expect(msg.html.match(/Scout evolved/g)).toHaveLength(1);
    const none = renderBeatEmail(content({ celebration: null }), 'casey@example.com', CONFIG);
    expect(none.html).not.toContain('Scout evolved');
  });

  it('escapes hostile names in every interpolation', () => {
    const hostile = content({
      title: '<script>alert(1)</script>',
      cards: [{ title: 'a"b', body: "<img src=x onerror=alert(1)>" }],
    });
    const msg = renderBeatEmail(hostile, 'casey@example.com', CONFIG);
    expect(msg.html).not.toContain('<script>');
    expect(msg.html).not.toContain('<img src=x');
    expect(msg.html).toContain('&lt;script&gt;');
  });

  it('uses the shell background and a sentence-case subject', () => {
    const msg = renderBeatEmail(content(), 'casey@example.com', CONFIG);
    expect(msg.html).toContain('#FBF6E6');
    expect(msg.subject).toBe('Your Half-time Report');
    expect(msg.from).toContain('mail.nibbin.com');
  });

  it('refuses to render without a postal address (CAN-SPAM)', () => {
    expect(() => renderBeatEmail(content(), 'c@example.com', { ...CONFIG, postalAddress: '  ' })).toThrow();
  });

  it('renders the header creature as a hosted PNG, never inline SVG', () => {
    // Keeper beat → root PNG.
    const keeperBeat = renderBeatEmail(content({ key: 'half_time' }), 'c@example.com', CONFIG);
    expect(keeperBeat.html).toContain('https://nibbin.com/keeper-email.png');
    expect(keeperBeat.html).not.toContain('<svg');
    // Species beat → per-creature PNG under /creatures/, still no inline SVG.
    const speciesBeat = renderBeatEmail(content({ key: 'species', celebration: null, cards: [] }), 'c@example.com', CONFIG);
    expect(speciesBeat.html).toContain('https://nibbin.com/creatures/sprout-student.png');
    expect(speciesBeat.html).not.toContain('<svg');
  });

  it('diagnosis reveal subject follows the variant title', () => {
    const reveal = content({ key: 'diagnosis_reveal', title: 'Your grove, one fortnight in', celebration: null, cards: [] });
    expect(templateFor(reveal).subject).toBe('Your grove, one fortnight in');
  });
});
