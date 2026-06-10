import type { Palette } from './types';

export const PALETTES: readonly Palette[] = [
  { n: 'Moss', c: '#5B7C2E' },
  { n: 'Teal', c: '#3E7C74' },
  { n: 'Honey', c: '#D9A21B' },
  { n: 'Coral', c: '#E2603A' },
  { n: 'Plum', c: '#7B5BD6' },
  { n: 'Sky', c: '#5B8BD6' },
  { n: 'Rose', c: '#C75A85' },
  { n: 'Slate', c: '#6B7261' },
];

/**
 * Lighten (pct > 0) or darken (pct < 0) a 6-digit hex color. Throws on
 * malformed input rather than silently emitting `#nannannan` — callers pass
 * either a literal brand hex or a value already validated by `safeColor`, so a
 * non-hex here is a programming error that should fail loudly, not a render to
 * paper over.
 */
export function shade(hex: string, pct: number): string {
  if (!/^#[0-9a-fA-F]{6}$/.test(hex)) {
    throw new Error(`shade(): expected a 6-digit hex color, got ${JSON.stringify(hex)}`);
  }
  const n = parseInt(hex.slice(1), 16);
  const r = (n >> 16) & 255;
  const g = (n >> 8) & 255;
  const b = n & 255;
  const f = (c: number) => Math.max(0, Math.min(255, Math.round(c + (pct / 100) * (pct > 0 ? 255 - c : c))));
  return '#' + [f(r), f(g), f(b)].map((v) => v.toString(16).padStart(2, '0')).join('');
}
