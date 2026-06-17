/**
 * Beat email renderer. One content model renders BOTH bodies — the HTML and
 * the plain-text part are built from the same blocks, so parity is
 * structural, not best-effort.
 *
 * Design contract (design-system skill): shell #FBF6E6 page (ceremonial/email
 * surface), canopy #FFFFFF card, understory #EAEDE3 recessed cards, ink
 * #23291A / secondary #5A6248, deeps only for colored text (moss #44601F,
 * honey #8A5F0C), radius 12 shell / 10 cards / 4 buttons, mono uppercase
 * eyebrows, sentence case everywhere, at most ONE celebration per email
 * (enforced by the content model's single optional field). Creatures render
 * through the engine — never hand-drawn SVG.
 */
import { buildCreature, creatureCss } from '@nibbin/creatures';
import { beatDef } from '@nibbin/drip';
import type { BeatContent } from '@nibbin/drip';
import { templateFor } from './templates';
import { unsubscribeUrl } from './unsubscribe';
import type { MailerConfig, OutboundEmail } from './types';

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

export function esc(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function ctaUrl(content: BeatContent, config: MailerConfig): string {
  return `${config.siteUrl.replace(/\/$/, '')}${content.ctaPath}`;
}

function eyebrowFor(content: BeatContent): string {
  const day = beatDef(content.key).day;
  return `From the grove · day ${day}`;
}

function renderHtml(content: BeatContent, config: MailerConfig, unsubUrl: string, preheader: string): string {
  const tpl = templateFor(content);
  // The Grovekeeper header is a hosted PNG (Gmail strips inline SVG; the engine's
  // filters don't survive most clients). Species beats still draw inline for now
  // — per-species rasterization is the dense-grid phase, tracked separately.
  const base = config.siteUrl.replace(/\/$/, '');
  const creature =
    tpl.creature.species === 'Keeper'
      ? `<img src="${esc(base)}/keeper-email.png" width="104" height="124" alt="The Grovekeeper" style="display:block;margin:0 auto;border:0;outline:none;text-decoration:none;">`
      : buildCreature(tpl.creature);
  const url = ctaUrl(content, config);

  const cards = content.cards
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

  // At most one of these exists per email, by the shape of BeatContent.
  const celebration = content.celebration
    ? `
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:0 0 10px;">
          <tr><td style="background:${HONEY_TINT};border-radius:10px;padding:14px 16px;">
            <p style="margin:0 0 2px;font-family:${FONT_DISPLAY};font-size:15px;font-weight:700;color:${HONEY_DEEP};">${esc(content.celebration.heading)}</p>
            <p style="margin:0;font-family:${FONT_BODY};font-size:14px;line-height:1.5;color:${INK};">${esc(content.celebration.body)}</p>
          </td></tr>
        </table>`
    : '';

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<style>${creatureCss}</style>
</head>
<body style="margin:0;padding:0;background:${SHELL};">
  <div style="display:none;max-height:0;overflow:hidden;mso-hide:all;">${esc(preheader)}</div>
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${SHELL};">
    <tr><td align="center" style="padding:32px 16px;">
      <table role="presentation" cellpadding="0" cellspacing="0" style="width:100%;max-width:560px;">
        <tr><td align="center" style="padding:0 0 16px;">${creature}</td></tr>
        <tr><td style="background:${CANOPY};border:1px solid ${UNDERSTORY};border-radius:12px;padding:28px;">
          <p style="margin:0 0 10px;font-family:${FONT_MONO};font-size:11px;letter-spacing:.12em;text-transform:uppercase;color:${INK_SECONDARY};">${esc(eyebrowFor(content))}</p>
          <h1 style="margin:0 0 12px;font-family:${FONT_DISPLAY};font-size:24px;line-height:1.25;font-weight:800;color:${INK};">${esc(content.title)}</h1>
          <p style="margin:0 0 18px;font-family:${FONT_BODY};font-size:15px;line-height:1.6;color:${INK};">${esc(content.body)}</p>
          ${cards}
          ${celebration}
          <table role="presentation" cellpadding="0" cellspacing="0" style="margin:20px 0 0;">
            <tr><td style="background:${MOSS_DEEP};border-radius:4px;">
              <a href="${esc(url)}" style="display:inline-block;padding:11px 20px;font-family:${FONT_BODY};font-size:14px;font-weight:700;color:#FFFFFF;text-decoration:none;">${esc(content.ctaLabel)}</a>
            </td></tr>
          </table>
        </td></tr>
        <tr><td style="padding:20px 8px 0;">
          <p style="margin:0 0 6px;font-family:${FONT_BODY};font-size:12px;line-height:1.6;color:${INK_SECONDARY};">You're getting this because you hatched a grove at nibbin.com. Unsubscribing stops emails like this one — your grove keeps growing in the app either way.</p>
          <p style="margin:0 0 6px;font-family:${FONT_BODY};font-size:12px;line-height:1.6;color:${INK_SECONDARY};"><a href="${esc(unsubUrl)}" style="color:${MOSS_DEEP};">Unsubscribe</a></p>
          <p style="margin:0;font-family:${FONT_BODY};font-size:12px;line-height:1.6;color:${INK_SECONDARY};">Nibbin · ${esc(config.postalAddress)}</p>
        </td></tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`;
}

function renderText(content: BeatContent, config: MailerConfig, unsubUrl: string): string {
  const lines: string[] = [];
  lines.push(eyebrowFor(content));
  lines.push('');
  lines.push(content.title);
  lines.push('');
  lines.push(content.body);
  for (const c of content.cards) {
    lines.push('');
    lines.push(`${c.title} — ${c.body}`);
  }
  if (content.celebration) {
    lines.push('');
    lines.push(`${content.celebration.heading}: ${content.celebration.body}`);
  }
  lines.push('');
  lines.push(`${content.ctaLabel}: ${ctaUrl(content, config)}`);
  lines.push('');
  lines.push('--');
  lines.push("You're getting this because you hatched a grove at nibbin.com. Unsubscribing stops emails like this one — your grove keeps growing in the app either way.");
  lines.push(`Unsubscribe: ${unsubUrl}`);
  lines.push(`Nibbin · ${config.postalAddress}`);
  return lines.join('\n');
}

export function renderBeatEmail(content: BeatContent, to: string, config: MailerConfig): OutboundEmail {
  if (!config.postalAddress.trim()) throw new Error('postalAddress is required (CAN-SPAM)');
  const tpl = templateFor(content);
  const unsubUrl = unsubscribeUrl(to, config.unsubscribeSecret, config.siteUrl);
  return {
    from: config.from,
    to,
    subject: tpl.subject,
    html: renderHtml(content, config, unsubUrl, tpl.preheader),
    text: renderText(content, config, unsubUrl),
    headers: {
      // RFC 8058 one-click — mail clients POST here without a page visit.
      'List-Unsubscribe': `<${unsubUrl}>`,
      'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click',
    },
  };
}
