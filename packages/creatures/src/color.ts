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

export function shade(hex: string, pct: number): string {
  const n = parseInt(hex.slice(1), 16);
  const r = (n >> 16) & 255;
  const g = (n >> 8) & 255;
  const b = n & 255;
  const f = (c: number) => Math.max(0, Math.min(255, Math.round(c + (pct / 100) * (pct > 0 ? 255 - c : c))));
  return '#' + [f(r), f(g), f(b)].map((v) => v.toString(16).padStart(2, '0')).join('');
}
