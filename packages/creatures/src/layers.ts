import { shade } from './color';
import type { Accessory, Anchors, Marking } from './types';

export function gradCap(x: number, y: number, rot?: number, adorn?: string, scl?: number): string {
  const S = scl ?? 1;
  const bloom = adorn === 'bloom'
    ? `<g transform="rotate(14 ${x - 9} ${y - 5})"><ellipse cx="${x - 11}" cy="${y - 5.5}" rx="3.4" ry="1.9" fill="#9CC25B" stroke="#5F8F33" stroke-width="0.8"/><circle cx="${x - 8}" cy="${y - 7}" r="2.1" fill="#B5D87A" stroke="#7FAF45" stroke-width="0.8"/><circle cx="${x - 8}" cy="${y - 7}" r="0.9" fill="#E8C44A"/></g>`
    : '';
  return `<g transform="rotate(${rot ?? -8} ${x} ${y}) translate(${x} ${y}) scale(${S}) translate(${-x} ${-y})">
    <path d="M${x - 8.5} ${y + 3} A8.5 5.5 0 0 0 ${x + 8.5} ${y + 3} L${x + 8.5} ${y - 1} L${x - 8.5} ${y - 1} Z" fill="#2B3320"/>
    <polygon points="${x},${y - 8.5} ${x + 14},${y - 2} ${x},${y + 4.5} ${x - 14},${y - 2}" fill="#39422B" stroke="#23291A" stroke-width="1"/>
    <g class="tassel"><line x1="${x + 12}" y1="${y - 2}" x2="${x + 14}" y2="${y + 7.5}" stroke="#D9A21B" stroke-width="1.5"/><circle cx="${x + 14.2}" cy="${y + 9}" r="2" fill="#D9A21B"/></g>
    ${bloom}
  </g>`;
}

export function marking(mark: Marking, a: Anchors, color: string): string {
  const dk = shade(color, -30);
  if (mark === 'spots') return `<circle cx="${a.cx - a.rx * 0.45}" cy="${a.cy + a.ry * 0.3}" r="2.1" fill="${dk}" opacity=".45"/><circle cx="${a.cx - a.rx * 0.15}" cy="${a.cy + a.ry * 0.55}" r="1.6" fill="${dk}" opacity=".45"/><circle cx="${a.cx - a.rx * 0.62}" cy="${a.cy - a.ry * 0.05}" r="1.4" fill="${dk}" opacity=".45"/>`;
  if (mark === 'stripe') return `<path d="M${a.cx - a.rx} ${a.cy - 2} Q${a.cx} ${a.cy - a.ry * 0.55} ${a.cx + a.rx} ${a.cy - 2}" stroke="${dk}" stroke-width="3.4" fill="none" opacity=".35"/>`;
  if (mark === 'star') {
    const sx = a.cx + a.rx * 0.42, sy = a.cy + a.ry * 0.18;
    return `<path d="M${sx} ${sy - 4.6} L${sx + 1.4} ${sy - 1.5} L${sx + 4.6} ${sy - 1.2} L${sx + 2.2} ${sy + 1} L${sx + 2.9} ${sy + 4.2} L${sx} ${sy + 2.5} L${sx - 2.9} ${sy + 4.2} L${sx - 2.2} ${sy + 1} L${sx - 4.6} ${sy - 1.2} L${sx - 1.4} ${sy - 1.5} Z" fill="#FFFFFF" stroke="${dk}" stroke-width="0.9" stroke-linejoin="round" opacity=".95"/>`;
  }
  return '';
}

export function accessory(acc: Accessory, a: Anchors): string {
  const face = a.face;
  if (!face) return '';
  const ey = face.ey, exL = face.exL, exR = face.exR, er = face.er;
  const A = a.acc ?? {
    neckX: a.cx, neckY: a.cy + a.ry * 0.6, neckW: a.rx * 0.6,
    beltX: a.cx, beltY: a.cy + a.ry * 0.5,
    sideX: a.cx + a.rx + 2, sideY: a.cy,
    handX: a.cx, handY: a.cy + a.ry * 0.7,
    headX: a.cx - 6, headY: a.cy - a.ry,
    strapX: a.cx - a.rx * 0.5, strapY: a.cy - a.ry * 0.4,
  };
  switch (acc) {
    case 'glasses':
      return `<circle cx="${exL}" cy="${ey}" r="${er + 2}" fill="none" stroke="#39422B" stroke-width="1.4"/>
      <circle cx="${exR}" cy="${ey}" r="${er + 2}" fill="none" stroke="#39422B" stroke-width="1.4"/>
      <line x1="${exL + er + 1.7}" y1="${ey}" x2="${exR - er - 1.7}" y2="${ey}" stroke="#39422B" stroke-width="1.4"/>`;
    case 'bow':
      return `<g transform="rotate(-16 ${A.headX} ${A.headY})"><polygon points="${A.headX},${A.headY} ${A.headX - 5.5},${A.headY - 3.8} ${A.headX - 5.5},${A.headY + 3.8}" fill="#C75A85" stroke="#A8456B" stroke-width="0.7"/>
      <polygon points="${A.headX},${A.headY} ${A.headX + 5.5},${A.headY - 3.8} ${A.headX + 5.5},${A.headY + 3.8}" fill="#C75A85" stroke="#A8456B" stroke-width="0.7"/>
      <circle cx="${A.headX}" cy="${A.headY}" r="2" fill="#A8456B"/></g>`;
    case 'pencil':
      return `<g transform="rotate(24 ${A.sideX} ${A.sideY})"><rect x="${A.sideX - 1.5}" y="${A.sideY - 8.5}" width="3.2" height="13.5" rx="0.9" fill="#E8B23D" stroke="#C9962A" stroke-width="0.8"/>
      <polygon points="${A.sideX - 1.5},${A.sideY + 5} ${A.sideX + 1.7},${A.sideY + 5} ${A.sideX + 0.1},${A.sideY + 8.6}" fill="#E8DFC8" stroke="#C9B98F" stroke-width="0.5"/>
      <circle cx="${A.sideX + 0.1}" cy="${A.sideY + 8.2}" r="0.9" fill="#39422B"/>
      <rect x="${A.sideX - 1.5}" y="${A.sideY - 8.5}" width="3.2" height="2.4" rx="0.9" fill="#D87BA0"/></g>`;
    case 'broom':
      return `<g transform="rotate(16 ${A.sideX} ${A.sideY})"><line x1="${A.sideX}" y1="${A.sideY - 11}" x2="${A.sideX}" y2="${A.sideY + 5}" stroke="#8B5E33" stroke-width="1.9" stroke-linecap="round"/>
      <path d="M${A.sideX - 3.4} ${A.sideY + 5} L${A.sideX + 3.4} ${A.sideY + 5} L${A.sideX + 2.2} ${A.sideY + 11.5} L${A.sideX - 2.2} ${A.sideY + 11.5} Z" fill="#D9B66A" stroke="#B6913F" stroke-width="0.9"/>
      <line x1="${A.sideX - 1.2}" y1="${A.sideY + 6}" x2="${A.sideX - 0.9}" y2="${A.sideY + 10.5}" stroke="#B6913F" stroke-width="0.6" opacity=".6"/>
      <line x1="${A.sideX + 1.2}" y1="${A.sideY + 6}" x2="${A.sideX + 0.9}" y2="${A.sideY + 10.5}" stroke="#B6913F" stroke-width="0.6" opacity=".6"/></g>`;
    case 'quill':
      return `<g transform="rotate(-18 ${A.sideX} ${A.sideY})"><path d="M${A.sideX} ${A.sideY + 6} L${A.sideX + 3} ${A.sideY - 7}" stroke="#6B4624" stroke-width="1.2"/>
      <path d="M${A.sideX + 3} ${A.sideY - 7} C${A.sideX + 7} ${A.sideY - 11.5} ${A.sideX + 7.8} ${A.sideY - 13.5} ${A.sideX + 6.2} ${A.sideY - 15} C${A.sideX + 3} ${A.sideY - 13.5} ${A.sideX + 1.5} ${A.sideY - 10} ${A.sideX + 3} ${A.sideY - 7} Z" fill="#E8DFC8" stroke="#B6A87E" stroke-width="0.9"/>
      <line x1="${A.sideX + 3.2}" y1="${A.sideY - 7.5}" x2="${A.sideX + 5.8}" y2="${A.sideY - 13.5}" stroke="#B6A87E" stroke-width="0.6" opacity=".7"/></g>`;
    case 'coin':
      return `<circle cx="${A.handX}" cy="${A.handY}" r="3.6" fill="#F0C75E" stroke="#C99A24" stroke-width="1"/>
      <path d="M${A.handX} ${A.handY - 1.8} L${A.handX} ${A.handY + 1.8} M${A.handX - 1.4} ${A.handY - 0.6} q1.4 -1 2.8 0 M${A.handX - 1.4} ${A.handY + 0.9} q1.4 1 2.8 0" stroke="#C99A24" stroke-width="0.8" fill="none"/>`;
    default:
      return '';
  }
}
