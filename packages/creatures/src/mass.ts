import { shade } from './color';

let _uid = 0;

export function nextUid(): number {
  return _uid++;
}

export interface MassOpts {
  sw?: number;
  shx?: number;
  shy?: number;
  hlx?: number;
  hly?: number;
}

/** mass(): a body shape with cel shading — gradient base, clipped shadow + highlight, outlined. */
export function mass(d: string, color: string, opts?: MassOpts): string {
  const u = 'm' + nextUid();
  const o = opts ?? {};
  const dk = shade(color, -32);
  const grad = 'g' + u;
  const sw = o.sw ?? 2;
  const shx = o.shx ?? 4;
  const shy = o.shy ?? 5;
  const hlx = o.hlx ?? -4;
  const hly = o.hly ?? -5;
  return `<defs>
    <clipPath id="cp${u}"><path d="${d}"/></clipPath>
    <radialGradient id="${grad}" cx="38%" cy="28%" r="85%"><stop offset="0%" stop-color="${shade(color, 22)}"/><stop offset="100%" stop-color="${color}"/></radialGradient>
  </defs>
  <path d="${d}" fill="url(#${grad})"/>
  <g clip-path="url(#cp${u})">
    <path d="${d}" transform="translate(${shx} ${shy})" fill="${shade(color, -16)}" opacity=".5"/>
    <path d="${d}" transform="translate(${hlx} ${hly}) scale(.96)" transform-origin="36 40" fill="${shade(color, 40)}" opacity=".35"/>
  </g>
  <path d="${d}" fill="none" stroke="${dk}" stroke-width="${sw}" stroke-linejoin="round"/>`;
}

export function pear(cx: number, top: number, bot: number, ht: number, hb: number): string {
  const mid = (top + bot) / 2;
  return `M${cx} ${top} C${cx - ht * 1.5} ${top} ${cx - hb - 1.5} ${mid - 4} ${cx - hb} ${bot - 7} C${cx - hb + 0.5} ${bot - 1.5} ${cx - hb * 0.45} ${bot} ${cx} ${bot} C${cx + hb * 0.45} ${bot} ${cx + hb - 0.5} ${bot - 1.5} ${cx + hb} ${bot - 7} C${cx + hb + 1.5} ${mid - 4} ${cx + ht * 1.5} ${top} ${cx} ${top} Z`;
}

export function bean(cx: number, top: number, bot: number, h: number, lean?: number): string {
  const L = lean ?? 0;
  const mid = (top + bot) / 2;
  return `M${cx + L} ${top} C${cx - h * 1.35 + L} ${top} ${cx - h - 1} ${mid} ${cx - h} ${bot - 6} C${cx - h + 1} ${bot - 1} ${cx - h * 0.4} ${bot} ${cx} ${bot} C${cx + h * 0.4} ${bot} ${cx + h - 1} ${bot - 1} ${cx + h} ${bot - 6} C${cx + h + 1} ${mid} ${cx + h * 1.35 + L} ${top} ${cx + L} ${top} Z`;
}
