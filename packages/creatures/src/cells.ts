/**
 * High-fidelity "ported cell" renders — the signed-off lifecycle art
 * (reference/nibbin-lifecycle.html, 200×230) brought into the engine, one
 * species at a time. Each builder owns its own namespaced <defs>, palette
 * tinting, baked grad cap, and accessory/marking overlays in its own space.
 *
 * Shared neutrals (eyes/cheeks/blur/egg/shell/board) come from cellDefs();
 * the body/cap accent is tinted from the palette `color` so a nibbin's chosen
 * colour drives its look. Gradient/filter ids are suffixed with an m-prefixed
 * uid so determinism holds and many creatures can share one page.
 */
import { shade } from './color';
import { nextUid } from './mass';
import type { Accessory, FullRender, Marking, Stage } from './types';

/** Neutral, palette-independent defs shared by every ported cell. */
function cellDefs(u: string): string {
  return `<defs>
    <filter id="bSm${u}" x="-60%" y="-60%" width="220%" height="220%"><feGaussianBlur stdDeviation="2"/></filter>
    <filter id="bMd${u}" x="-80%" y="-80%" width="260%" height="260%"><feGaussianBlur stdDeviation="4"/></filter>
    <radialGradient id="eW${u}" cx="50%" cy="34%" r="72%"><stop offset="0%" stop-color="#fff"/><stop offset="100%" stop-color="#E7EEDC"/></radialGradient>
    <radialGradient id="eP${u}" cx="42%" cy="35%" r="75%"><stop offset="0%" stop-color="#3B3930"/><stop offset="100%" stop-color="#191711"/></radialGradient>
    <radialGradient id="ck${u}" cx="50%" cy="50%" r="50%"><stop offset="0%" stop-color="#E2603A" stop-opacity=".5"/><stop offset="100%" stop-color="#E2603A" stop-opacity="0"/></radialGradient>
    <radialGradient id="eggG${u}" cx="42%" cy="32%" r="80%"><stop offset="0%" stop-color="#FDF8EA"/><stop offset="100%" stop-color="#E2D4AF"/></radialGradient>
    <radialGradient id="shellG${u}" cx="42%" cy="34%" r="75%"><stop offset="0%" stop-color="#FDF8EA"/><stop offset="100%" stop-color="#EADCBA"/></radialGradient>
    <radialGradient id="stemG${u}" cx="42%" cy="34%" r="80%"><stop offset="0%" stop-color="#FCF3E1"/><stop offset="100%" stop-color="#E4CFAA"/></radialGradient>
    <linearGradient id="boardG${u}" x1="0" y1="0" x2="0.4" y2="1"><stop offset="0%" stop-color="#3A4458"/><stop offset="100%" stop-color="#222A3A"/></linearGradient>
  </defs>`;
}

/** Star path centred at (cx,cy), radius r. */
function star(cx: number, cy: number, r: number, fill: string): string {
  const pts: string[] = [];
  for (let k = 0; k < 10; k++) {
    const rr = k % 2 ? r * 0.45 : r;
    const a = (Math.PI / 5) * k - Math.PI / 2;
    pts.push(`${(cx + Math.cos(a) * rr).toFixed(1)} ${(cy + Math.sin(a) * rr).toFixed(1)}`);
  }
  return `<path d="M${pts.join(' L')} Z" fill="${fill}" stroke="#B98F1F" stroke-width="1.2" stroke-linejoin="round"/>`;
}

/** Marking overlay on the cream stem (face area kept clear). */
function caplingMark(mark: Marking, color: string): string {
  if (mark === 'spots') {
    return `<circle cx="76" cy="176" r="3" fill="#C9A86A" opacity=".5"/><circle cx="118" cy="180" r="3.4" fill="#C9A86A" opacity=".5"/><circle cx="96" cy="190" r="2.6" fill="#C9A86A" opacity=".45"/>`;
  }
  if (mark === 'stripe') {
    return `<path d="M100 170 C97 178 97 188 100 196" stroke="${shade(color, -10)}" stroke-width="7" fill="none" stroke-linecap="round" opacity=".4"/>`;
  }
  if (mark === 'star') return star(100, 182, 8, '#F6D45F');
  return '';
}

/** Accessory overlay in 200-space, driven by the eye/cap geometry. */
function caplingAcc(acc: Accessory, ey: number, capTop: number): string {
  const exL = 85, exR = 115;
  switch (acc) {
    case 'glasses':
      return `<g fill="none" stroke="#3A3026" stroke-width="2.6"><circle cx="${exL}" cy="${ey}" r="18"/><circle cx="${exR}" cy="${ey}" r="18"/><path d="M${exL + 18} ${ey} L${exR - 18} ${ey}"/><path d="M${exL - 18} ${ey - 2} l-6 -3"/><path d="M${exR + 18} ${ey - 2} l6 -3"/></g>`;
    case 'bow':
      return `<g transform="translate(100 ${capTop - 4})"><path d="M0 0 C-14 -8 -16 8 -2 4 C-1 6 1 6 2 4 C16 8 14 -8 0 0 Z" fill="#E2603A" stroke="#A53C22" stroke-width="1.6"/><circle r="3.2" fill="#C84A2A" stroke="#A53C22" stroke-width="1.2"/></g>`;
    case 'coin':
      return `<g transform="translate(132 184)"><circle r="11" fill="#F6D45F" stroke="#B98F1F" stroke-width="2"/><circle r="11" fill="none" stroke="#FBE9A0" stroke-width="1" opacity=".7"/><text x="0" y="5" font-size="13" font-weight="700" text-anchor="middle" fill="#B98F1F" font-family="system-ui">$</text></g>`;
    case 'pencil':
      return `<g transform="rotate(34 130 176)"><rect x="125" y="150" width="10" height="40" rx="2" fill="#F0B429" stroke="#B98F1F" stroke-width="1.4"/><path d="M125 150 L135 150 L130 140 Z" fill="#F2D9A8" stroke="#B98F1F" stroke-width="1.2"/><rect x="125" y="186" width="10" height="6" fill="#E2748A"/></g>`;
    case 'quill':
      return `<g transform="rotate(20 134 168)"><path d="M134 192 C130 168 138 144 150 132 C150 152 146 178 138 192 Z" fill="#EAF0F6" stroke="#9FB0C2" stroke-width="1.4"/><path d="M138 150 L146 142 M136 162 L144 156 M135 174 L142 170" stroke="#9FB0C2" stroke-width="1" opacity=".6"/></g>`;
    case 'broom':
      return `<g transform="rotate(18 130 170)"><rect x="127" y="128" width="5" height="50" rx="2.5" fill="#9A6B3B" stroke="#6B4624" stroke-width="1.2"/><path d="M122 176 C124 190 135 190 137 176 C137 172 122 172 122 176 Z" fill="#D9A24B" stroke="#9A6B3B" stroke-width="1.2"/><path d="M125 178 L125 188 M129.5 179 L129.5 189 M134 178 L134 188" stroke="#9A6B3B" stroke-width="0.8" opacity=".6"/></g>`;
    default:
      return '';
  }
}

/** Palette-tinted mushroom cap (cap + gill underside + cream spots). */
function cap(u: string, color: string, d: string, gill: string, spots: string): string {
  const stroke = shade(color, -45);
  const light = shade(color, 26);
  const gillFill = shade(color, 56);
  return `<defs><radialGradient id="capG${u}" cx="40%" cy="30%" r="80%"><stop offset="0%" stop-color="${light}"/><stop offset="60%" stop-color="${color}"/><stop offset="100%" stop-color="${shade(color, -26)}"/></radialGradient></defs>
    <path d="${d}" fill="url(#capG${u})" stroke="${stroke}" stroke-width="2.2"/>
    <path d="${gill}" fill="${gillFill}" stroke="${stroke}" stroke-width="1.2"/>${spots}`;
}

function eyes(u: string, ey: number, big: boolean): string {
  const rx = big ? 13 : 11, ry = big ? 14.5 : 12.5, pr = big ? 7.8 : 6.7, hl = big ? 2.8 : 2.4;
  const py = ey + 3, hx = -1, hy = -2;
  return `<g><ellipse cx="85" cy="${ey}" rx="${rx}" ry="${ry}" fill="url(#eW${u})" stroke="#A8895C" stroke-width="1.7"/><ellipse cx="115" cy="${ey}" rx="${rx}" ry="${ry}" fill="url(#eW${u})" stroke="#A8895C" stroke-width="1.7"/>
    <circle cx="88" cy="${py}" r="${pr}" fill="url(#eP${u})"/><circle cx="112" cy="${py}" r="${pr}" fill="url(#eP${u})"/>
    <circle cx="${85 + hx}" cy="${ey + hy}" r="${hl}" fill="#fff"/><circle cx="${115 + hx}" cy="${ey + hy}" r="${hl}" fill="#fff"/></g>`;
}

export function caplingFull(o: { stage?: Stage; color?: string; acc?: Accessory; mark?: Marking }): FullRender {
  const u = 'm' + nextUid();
  const color = o.color ?? '#5B7C2E';
  const stage = o.stage ?? 'student';
  const vb = '0 0 200 230';
  const defs = cellDefs(u);

  if (stage === 'egg') {
    const stroke = shade(color, -45), light = shade(color, 26);
    const art = `${defs}<ellipse cx="100" cy="198" rx="30" ry="6" fill="#23291A" opacity=".12" filter="url(#bMd${u})"/><g>
      <defs><radialGradient id="capG${u}" cx="40%" cy="30%" r="80%"><stop offset="0%" stop-color="${light}"/><stop offset="100%" stop-color="${shade(color, -26)}"/></radialGradient></defs>
      <path d="M90 72 C90 64 110 64 110 72 C110 78 90 78 90 72 Z" fill="url(#capG${u})" stroke="${stroke}" stroke-width="1.4"/>
      <path d="M100 78 C81 78 68 98 68 126 C68 154 82 176 100 176 C118 176 132 154 132 126 C132 98 119 78 100 78 Z" fill="url(#eggG${u})" stroke="#9C824E" stroke-width="2"/>
      <ellipse cx="86" cy="138" rx="24" ry="28" fill="#FFFBEE" opacity=".5" filter="url(#bMd${u})"/>
      <circle cx="84" cy="118" r="4" fill="${color}" opacity=".4"/><circle cx="112" cy="140" r="5" fill="${color}" opacity=".4"/></g>`;
    return { art, viewBox: vb, cls: 'cr eggy' };
  }

  // student | senior | grad share the stem+cap+face; senior/grad are larger and footed.
  const sr = stage === 'student';
  const stem = sr
    ? `M100 108 C82 108 70 122 70 142 C70 166 80 184 100 188 C120 184 130 166 130 142 C130 122 118 108 100 108 Z`
    : `M100 100 C78 100 62 118 62 146 C62 172 74 196 100 200 C126 196 138 172 138 146 C138 118 122 100 100 100 Z`;
  const capD = sr
    ? `M64 100 C64 80 80 68 100 68 C120 68 136 80 136 100 C136 106 128 109 100 109 C72 109 64 106 64 100 Z`
    : `M50 100 C50 70 71 55 100 55 C129 55 150 70 150 100 C150 107 141 112 100 112 C59 112 50 107 50 100 Z`;
  const gill = sr
    ? `M70 102 C82 107 118 107 130 102 C130 107 120 111 100 111 C80 111 70 107 70 102 Z`
    : `M58 103 C76 109 124 109 142 103 C142 109 132 114 100 114 C68 114 58 109 58 103 Z`;
  const spots = sr
    ? `<ellipse cx="86" cy="84" rx="7.5" ry="6" fill="#FBF3E8" stroke="#E6CFD8" stroke-width="1"/><ellipse cx="112" cy="88" rx="6" ry="5" fill="#FBF3E8" stroke="#E6CFD8" stroke-width="1"/>`
    : `<ellipse cx="78" cy="76" rx="8.5" ry="7" fill="#FBF3E8" stroke="#E6CFD8" stroke-width="1"/><ellipse cx="110" cy="71" rx="9.5" ry="8" fill="#FBF3E8" stroke="#E6CFD8" stroke-width="1"/><ellipse cx="128" cy="90" rx="6.5" ry="5.5" fill="#FBF3E8" stroke="#E6CFD8" stroke-width="1"/><ellipse cx="63" cy="90" rx="6" ry="5" fill="#FBF3E8" stroke="#E6CFD8" stroke-width="1"/><ellipse cx="96" cy="91" rx="5.5" ry="4.5" fill="#FBF3E8" stroke="#E6CFD8" stroke-width="1"/>`;
  const ey = sr ? 128 : 150;
  const capTop = sr ? 68 : 55;
  const shadow = `<ellipse cx="100" cy="${sr ? 204 : 208}" rx="${sr ? 40 : 48}" ry="${sr ? 7 : 8}" fill="#23291A" opacity=".14" filter="url(#bMd${u})"/>`;
  const feet = sr ? '' : `<ellipse cx="84" cy="198" rx="13" ry="8.5" fill="#CDB488"/><ellipse cx="116" cy="198" rx="13" ry="8.5" fill="#CDB488"/>`;
  const belly = sr ? '' : `<ellipse cx="80" cy="168" rx="32" ry="38" fill="#FFFBF0" opacity=".55" filter="url(#bMd${u})"/>`;
  // student sits in its just-hatched jagged shell
  const hatch = sr
    ? `<path d="M52 156 L60 144 L70 156 L80 146 L90 158 L100 166 L110 158 L120 146 L130 156 L140 144 L148 156 C152 200 48 200 52 156 Z" fill="url(#shellG${u})" stroke="#C9B488" stroke-width="2" stroke-linejoin="round"/><path d="M60 154 C82 162 118 162 140 154" stroke="#FFFDF4" stroke-width="1.6" fill="none" opacity=".5"/><circle cx="72" cy="176" r="2.6" fill="#C9A86A" opacity=".5"/><circle cx="100" cy="186" r="3" fill="#C9A86A" opacity=".5"/><circle cx="126" cy="174" r="2.4" fill="#C9A86A" opacity=".5"/>`
    : '';
  const ckY = sr ? 140 : 164;
  const cheeks = `<ellipse cx="${sr ? 72 : 66}" cy="${ckY}" rx="${sr ? 6.5 : 7.5}" ry="${sr ? 4.5 : 5}" fill="url(#ck${u})"/><ellipse cx="${sr ? 128 : 134}" cy="${ckY}" rx="${sr ? 6.5 : 7.5}" ry="${sr ? 4.5 : 5}" fill="url(#ck${u})"/>`;
  const smile = sr
    ? `<path d="M93 140 Q100 146 107 140" stroke="#8A6E45" stroke-width="2.4" fill="none" stroke-linecap="round"/>`
    : `<path d="M91 162 Q100 170 109 162" stroke="#8A6E45" stroke-width="2.6" fill="none" stroke-linecap="round"/>`;
  const board = stage === 'grad'
    ? `<g transform="rotate(-5 100 50)"><path d="M100 47 L78 58 L78 62 C82 67 118 67 122 62 L122 58 Z" fill="#1E2532"/><path d="M71 50 L100 37 L129 50 L100 63 Z" fill="url(#boardG${u})" stroke="#161C28" stroke-width="1.4"/><circle cx="100" cy="50" r="2.8" fill="#D9A21B"/><g class="tassel" style="transform-origin:100px 50px"><path d="M100 50 L124 48 L124 68" stroke="#D9A21B" stroke-width="1.7" fill="none"/><circle cx="124" cy="70" r="3.2" fill="#F6E08A" stroke="#B98F1F" stroke-width="1"/></g></g>`
    : '';

  const art = `${defs}${shadow}<g>${feet}
    <path d="${stem}" fill="url(#stemG${u})" stroke="#A8895C" stroke-width="2.2"/>${belly}
    ${caplingMark(o.mark ?? 'none', color)}
    ${cap(u, color, capD, gill, spots)}
    ${board}
    ${eyes(u, ey, !sr)}${cheeks}${smile}
    ${caplingAcc(o.acc ?? 'none', ey, capTop)}${hatch}</g>`;
  return { art, viewBox: vb, cls: 'cr' };
}
