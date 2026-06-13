/**
 * Branded one-off (transactional) email renderer — invites, welcome, sign-in,
 * waitlist confirmation. Same brand surface as the drip beats (render.ts) but
 * STANDALONE: it does not depend on @nibbin/drip, so any app (web, admin) can
 * render it without pulling the beat/arc machinery.
 *
 * Design contract mirrors render.ts: shell #FBF6E6 page, canopy card, moss CTA,
 * Bricolage display / Archivo body / Plex-mono eyebrow, sentence case, at most
 * one celebration. Plain-text parity is structural — the same blocks build both
 * bodies. Creatures render through the engine, never hand-drawn SVG.
 */
import { buildCreature, creatureCss, type BuildOptions } from '@nibbin/creatures';
import type { OutboundEmail } from './types';

const FONT_DISPLAY = "'Bricolage Grotesque','Trebuchet MS',Arial,sans-serif";
const FONT_BODY = "Archivo,Arial,'Helvetica Neue',sans-serif";
const FONT_MONO = "'IBM Plex Mono','Courier New',monospace";

const SHELL = '#FBF6E6';
const CANOPY = '#FFFFFF';
const UNDERSTORY = '#EAEDE3';
const INK = '#23291A';
const INK_SECONDARY = '#5A6248';
const MOSS_DEEP = '#44601F';
const HONEY_DEEP = '#8A5F0C';
const HONEY_TINT = '#F7EDD6';

const KEEPER: BuildOptions = { species: 'Keeper', size: 88 };

export function esc(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export interface TransactionalCard {
  title: string;
  body: string;
}

export interface TransactionalEmail {
  subject: string;
  preheader: string;
  eyebrow: string;
  title: string;
  body: string;
  cards?: TransactionalCard[];
  celebration?: { heading: string; body: string };
  cta?: { label: string; url: string };
  /** Small print under the CTA — expiry, "ignore if unexpected", etc. */
  footnote?: string;
  /** Engine creature in the header. Defaults to the Grovekeeper. */
  creature?: BuildOptions;
}

export interface TransactionalRenderOptions {
  from: string;
  to: string;
  /** CAN-SPAM postal address. Optional for transactional mail; rendered when set. */
  postalAddress?: string;
  /** Extra headers (e.g. List-Unsubscribe for the one marketing-ish case). */
  headers?: Record<string, string>;
}

function renderHtml(email: TransactionalEmail, postalAddress?: string): string {
  const creature = buildCreature(email.creature ?? KEEPER);

  const cards = (email.cards ?? [])
    .map(
      (c) => `
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:0 0 10px;">
          <tr><td style="background:${UNDERSTORY};border-radius:10px;padding:14px 16px;">
            <p style="margin:0 0 2px;font-family:${FONT_BODY};font-size:14px;font-weight:700;color:${INK};">${esc(c.title)}</p>
            <p style="margin:0;font-family:${FONT_BODY};font-size:14px;line-height:1.5;color:${INK_SECONDARY};">${esc(c.body)}</p>
          </td></tr>
        </table>`,
    )
    .join('');

  const celebration = email.celebration
    ? `
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:0 0 10px;">
          <tr><td style="background:${HONEY_TINT};border-radius:10px;padding:14px 16px;">
            <p style="margin:0 0 2px;font-family:${FONT_DISPLAY};font-size:15px;font-weight:700;color:${HONEY_DEEP};">${esc(email.celebration.heading)}</p>
            <p style="margin:0;font-family:${FONT_BODY};font-size:14px;line-height:1.5;color:${INK};">${esc(email.celebration.body)}</p>
          </td></tr>
        </table>`
    : '';

  const cta = email.cta
    ? `
          <table role="presentation" cellpadding="0" cellspacing="0" style="margin:20px 0 0;">
            <tr><td style="background:${MOSS_DEEP};border-radius:4px;">
              <a href="${esc(email.cta.url)}" style="display:inline-block;padding:11px 20px;font-family:${FONT_BODY};font-size:14px;font-weight:700;color:#FFFFFF;text-decoration:none;">${esc(email.cta.label)}</a>
            </td></tr>
          </table>`
    : '';

  const footnote = email.footnote
    ? `<p style="margin:14px 0 0;font-family:${FONT_BODY};font-size:12.5px;line-height:1.6;color:${INK_SECONDARY};">${esc(email.footnote)}</p>`
    : '';

  const address = postalAddress?.trim()
    ? `<p style="margin:0;font-family:${FONT_BODY};font-size:12px;line-height:1.6;color:${INK_SECONDARY};">Nibbin · ${esc(postalAddress)}</p>`
    : '';

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<style>${creatureCss}</style>
</head>
<body style="margin:0;padding:0;background:${SHELL};">
  <div style="display:none;max-height:0;overflow:hidden;mso-hide:all;">${esc(email.preheader)}</div>
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${SHELL};">
    <tr><td align="center" style="padding:32px 16px;">
      <table role="presentation" cellpadding="0" cellspacing="0" style="width:100%;max-width:560px;">
        <tr><td align="center" style="padding:0 0 16px;">${creature}</td></tr>
        <tr><td style="background:${CANOPY};border:1px solid ${UNDERSTORY};border-radius:12px;padding:28px;">
          <p style="margin:0 0 10px;font-family:${FONT_MONO};font-size:11px;letter-spacing:.12em;text-transform:uppercase;color:${INK_SECONDARY};">${esc(email.eyebrow)}</p>
          <h1 style="margin:0 0 12px;font-family:${FONT_DISPLAY};font-size:24px;line-height:1.25;font-weight:800;color:${INK};">${esc(email.title)}</h1>
          <p style="margin:0 0 18px;font-family:${FONT_BODY};font-size:15px;line-height:1.6;color:${INK};">${esc(email.body)}</p>
          ${cards}
          ${celebration}
          ${cta}
          ${footnote}
        </td></tr>
        ${address ? `<tr><td style="padding:20px 8px 0;">${address}</td></tr>` : ''}
      </table>
    </td></tr>
  </table>
</body>
</html>`;
}

function renderText(email: TransactionalEmail, postalAddress?: string): string {
  const lines: string[] = [];
  lines.push(email.eyebrow);
  lines.push('');
  lines.push(email.title);
  lines.push('');
  lines.push(email.body);
  for (const c of email.cards ?? []) {
    lines.push('');
    lines.push(`${c.title} — ${c.body}`);
  }
  if (email.celebration) {
    lines.push('');
    lines.push(`${email.celebration.heading}: ${email.celebration.body}`);
  }
  if (email.cta) {
    lines.push('');
    lines.push(`${email.cta.label}: ${email.cta.url}`);
  }
  if (email.footnote) {
    lines.push('');
    lines.push(email.footnote);
  }
  if (postalAddress?.trim()) {
    lines.push('');
    lines.push(`Nibbin · ${postalAddress}`);
  }
  return lines.join('\n');
}

export function renderTransactional(email: TransactionalEmail, opts: TransactionalRenderOptions): OutboundEmail {
  return {
    from: opts.from,
    to: opts.to,
    subject: email.subject,
    html: renderHtml(email, opts.postalAddress),
    text: renderText(email, opts.postalAddress),
    headers: opts.headers ?? {},
  };
}
