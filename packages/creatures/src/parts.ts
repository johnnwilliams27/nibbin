import { shade } from './color';

export interface EyeOpts {
  happy?: boolean;
  lidPct?: number;
}

export function eyesRound(exL: number, exR: number, ey: number, r: number, color: string, opts?: EyeOpts): string {
  const o = opts ?? {};
  const dk = shade(color, -32);
  const happy = o.happy
    ? `<path d="M${exL - r} ${ey + r + 1.5} Q${exL} ${ey + r - 1} ${exL + r} ${ey + r + 1.5}" stroke="${dk}" stroke-width="1.2" fill="none" opacity=".45"/><path d="M${exR - r} ${ey + r + 1.5} Q${exR} ${ey + r - 1} ${exR + r} ${ey + r + 1.5}" stroke="${dk}" stroke-width="1.2" fill="none" opacity=".45"/>`
    : '';
  return `<circle cx="${exL}" cy="${ey}" r="${r}" fill="#fff" stroke="${dk}" stroke-width="1"/>
  <circle cx="${exR}" cy="${ey}" r="${r}" fill="#fff" stroke="${dk}" stroke-width="1"/>
  <circle cx="${exL + r * 0.16}" cy="${ey + r * 0.14}" r="${r * 0.52}" fill="#23291A"/>
  <circle cx="${exR + r * 0.16}" cy="${ey + r * 0.14}" r="${r * 0.52}" fill="#23291A"/>
  <circle cx="${exL + r * 0.34}" cy="${ey - r * 0.18}" r="${r * 0.22}" fill="#fff"/>
  <circle cx="${exR + r * 0.34}" cy="${ey - r * 0.18}" r="${r * 0.22}" fill="#fff"/>
  <circle cx="${exL - r * 0.1}" cy="${ey + r * 0.34}" r="${r * 0.1}" fill="#fff" opacity=".8"/>
  <circle cx="${exR - r * 0.1}" cy="${ey + r * 0.34}" r="${r * 0.1}" fill="#fff" opacity=".8"/>
  ${o.lidPct ? `<path d="M${exL - r} ${ey} A${r} ${r} 0 0 1 ${exL + r} ${ey} L${exL + r} ${ey - r * o.lidPct} A${r} ${r * o.lidPct} 0 0 0 ${exL - r} ${ey - r * o.lidPct} Z" fill="${color}" stroke="${dk}" stroke-width="1" transform="translate(0 ${-r * (1 - o.lidPct)})"/><path d="M${exR - r} ${ey} A${r} ${r} 0 0 1 ${exR + r} ${ey} L${exR + r} ${ey - r * o.lidPct} A${r} ${r * o.lidPct} 0 0 0 ${exR - r} ${ey - r * o.lidPct} Z" fill="${color}" stroke="${dk}" stroke-width="1" transform="translate(0 ${-r * (1 - o.lidPct)})"/>` : ''}
  ${happy}
  <ellipse class="lid" cx="${exL}" cy="${ey}" rx="${r + 0.5}" ry="${r + 0.5}" fill="${color}"/>
  <ellipse class="lid" cx="${exR}" cy="${ey}" rx="${r + 0.5}" ry="${r + 0.5}" fill="${color}"/>`;
}

export function eyesOval(exL: number, exR: number, ey: number, r: number, color: string, tall?: number): string {
  const dk = shade(color, -32);
  const rx = r * 0.74;
  const ry = r * (tall ?? 1.16);
  return `<ellipse cx="${exL}" cy="${ey}" rx="${rx}" ry="${ry}" fill="#fff" stroke="${dk}" stroke-width="1"/>
  <ellipse cx="${exR}" cy="${ey}" rx="${rx}" ry="${ry}" fill="#fff" stroke="${dk}" stroke-width="1"/>
  <ellipse cx="${exL + 0.6}" cy="${ey + 0.8}" rx="${rx * 0.55}" ry="${ry * 0.55}" fill="#23291A"/>
  <ellipse cx="${exR + 0.6}" cy="${ey + 0.8}" rx="${rx * 0.55}" ry="${ry * 0.55}" fill="#23291A"/>
  <circle cx="${exL + rx * 0.34}" cy="${ey - ry * 0.25}" r="${rx * 0.26}" fill="#fff"/>
  <circle cx="${exR + rx * 0.34}" cy="${ey - ry * 0.25}" r="${rx * 0.26}" fill="#fff"/>
  <ellipse class="lid" cx="${exL}" cy="${ey}" rx="${rx + 0.5}" ry="${ry + 0.5}" fill="${color}"/>
  <ellipse class="lid" cx="${exR}" cy="${ey}" rx="${rx + 0.5}" ry="${ry + 0.5}" fill="${color}"/>`;
}

export function eyesBead(exL: number, exR: number, ey: number, r: number, color: string): string {
  const dk = shade(color, -32);
  return `<circle cx="${exL}" cy="${ey}" r="${r * 0.62}" fill="#23291A"/>
  <circle cx="${exR}" cy="${ey}" r="${r * 0.62}" fill="#23291A"/>
  <circle cx="${exL + r * 0.2}" cy="${ey - r * 0.22}" r="${r * 0.26}" fill="#fff"/>
  <circle cx="${exR + r * 0.2}" cy="${ey - r * 0.22}" r="${r * 0.26}" fill="#fff"/>
  <path d="M${exL - r * 0.7} ${ey - r * 0.9} q${r * 0.5} -${r * 0.45} ${r * 1.1} -${r * 0.15}" stroke="${dk}" stroke-width="1.1" fill="none" opacity=".55"/>
  <path d="M${exR - r * 0.4} ${ey - r * 1.05} q${r * 0.55} -${r * 0.3} ${r * 1.05} ${r * 0.05}" stroke="${dk}" stroke-width="1.1" fill="none" opacity=".55"/>
  <ellipse class="lid" cx="${exL}" cy="${ey}" rx="${r * 0.72}" ry="${r * 0.72}" fill="${color}"/>
  <ellipse class="lid" cx="${exR}" cy="${ey}" rx="${r * 0.72}" ry="${r * 0.72}" fill="${color}"/>`;
}

/** Blush is always coral #E2603A by design, on every species. */
export function blush(exL: number, exR: number, ey: number, r: number): string {
  return `<ellipse cx="${exL - r - 2.5}" cy="${ey + r + 1}" rx="2.6" ry="1.7" fill="#E2603A" opacity=".25"/>
  <ellipse cx="${exR + r + 2.5}" cy="${ey + r + 1}" rx="2.6" ry="1.7" fill="#E2603A" opacity=".25"/>`;
}

export function smileOpen(mx: number, my: number, w: number): string {
  return `<path d="M${mx - w} ${my} Q${mx} ${my + w * 1.1} ${mx + w} ${my} Q${mx} ${my + w * 0.45} ${mx - w} ${my} Z" fill="#3A2E26" opacity=".85"/>
  <path d="M${mx - w * 0.45} ${my + w * 0.42} Q${mx} ${my + w * 0.78} ${mx + w * 0.45} ${my + w * 0.42}" fill="#E2603A" opacity=".7"/>`;
}

export function smileTiny(mx: number, my: number, w: number): string {
  return `<path d="M${mx - w} ${my} Q${mx} ${my + w * 0.9} ${mx + w} ${my}" stroke="#23291A" stroke-width="1.6" fill="none" stroke-linecap="round"/>`;
}

export function feet(cx: number, y: number, color: string, spread: number, fwd?: number): string {
  const dk = shade(color, -32);
  const s = spread;
  const f = fwd ?? 1.5;
  const foot = (x: number, dy: number) =>
    `<path d="M${x - 4.2} ${y + dy} C${x - 4.6} ${y + dy + 3.6} ${x + 4.6} ${y + dy + 3.6} ${x + 4.2} ${y + dy} C${x + 3.2} ${y + dy - 2.2} ${x - 3.2} ${y + dy - 2.2} ${x - 4.2} ${y + dy} Z" fill="${shade(color, -10)}" stroke="${dk}" stroke-width="1.2"/>`;
  return foot(cx - s, f) + foot(cx + s, 0);
}
