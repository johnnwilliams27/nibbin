/**
 * Longear — the lop-eared Nibbin. Its signature is the ears: a half-flopped
 * student grows into a both-ears-up senior/graduate. Ported into the procedural
 * engine off the signed-off lifecycle art, copying Capling's structure exactly:
 * palette-tinted body + ears (the accent), shared shaded eyes/blush/smile, a
 * baked grad mortarboard drawn ON TOP of the upright ears, and
 * accessory/marking overlays in 200-space. Shared neutrals come from
 * `cellDefs`/`mortarboard`/`eggBase`/`hatchShell`/`star`.
 */
import { shade } from '../color';
import { nextUid } from '../mass';
import type { Accessory, FullRender, Marking, Stage } from '../types';
import {
  cellBlush,
  cellDefs,
  cellEyes,
  eggBase,
  hatchShell,
  mortarboard,
  star,
  tintedBody,
} from './shared';

/** Marking overlay on the body (face area kept clear). */
function longearMark(mark: Marking, color: string): string {
  if (mark === 'spots') {
    return `<circle cx="78" cy="176" r="3" fill="${shade(color, -22)}" opacity=".5"/><circle cx="120" cy="180" r="3.4" fill="${shade(color, -22)}" opacity=".5"/><circle cx="98" cy="190" r="2.6" fill="${shade(color, -22)}" opacity=".45"/>`;
  }
  if (mark === 'stripe') {
    return `<path d="M100 158 C97 170 97 182 100 194" stroke="${shade(color, -22)}" stroke-width="7" fill="none" stroke-linecap="round" opacity=".4"/>`;
  }
  if (mark === 'star') return star(100, 180, 8, '#F6D45F');
  return '';
}

/** Accessory overlay in 200-space, driven by the eye/head geometry. */
function longearAcc(acc: Accessory, ey: number, headTop: number): string {
  const exL = 86, exR = 114;
  switch (acc) {
    case 'glasses':
      return `<g fill="none" stroke="#3A3026" stroke-width="2.6"><circle cx="${exL}" cy="${ey}" r="17"/><circle cx="${exR}" cy="${ey}" r="17"/><path d="M${exL + 17} ${ey} L${exR - 17} ${ey}"/><path d="M${exL - 17} ${ey - 2} l-6 -3"/><path d="M${exR + 17} ${ey - 2} l6 -3"/></g>`;
    case 'bow':
      return `<g transform="translate(100 ${headTop})"><path d="M0 0 C-14 -8 -16 8 -2 4 C-1 6 1 6 2 4 C16 8 14 -8 0 0 Z" fill="#E2603A" stroke="#A53C22" stroke-width="1.6"/><circle r="3.2" fill="#C84A2A" stroke="#A53C22" stroke-width="1.2"/></g>`;
    case 'coin':
      return `<g transform="translate(132 186)"><circle r="11" fill="#F6D45F" stroke="#B98F1F" stroke-width="2"/><circle r="11" fill="none" stroke="#FBE9A0" stroke-width="1" opacity=".7"/><text x="0" y="5" font-size="13" font-weight="700" text-anchor="middle" fill="#B98F1F" font-family="system-ui">$</text></g>`;
    case 'pencil':
      return `<g transform="rotate(34 132 178)"><rect x="127" y="152" width="10" height="40" rx="2" fill="#F0B429" stroke="#B98F1F" stroke-width="1.4"/><path d="M127 152 L137 152 L132 142 Z" fill="#F2D9A8" stroke="#B98F1F" stroke-width="1.2"/><rect x="127" y="188" width="10" height="6" fill="#E2748A"/></g>`;
    case 'quill':
      return `<g transform="rotate(20 136 170)"><path d="M136 194 C132 170 140 146 152 134 C152 154 148 180 140 194 Z" fill="#EAF0F6" stroke="#9FB0C2" stroke-width="1.4"/><path d="M140 152 L148 144 M138 164 L146 158 M137 176 L144 172" stroke="#9FB0C2" stroke-width="1" opacity=".6"/></g>`;
    case 'broom':
      return `<g transform="rotate(18 132 172)"><rect x="129" y="130" width="5" height="50" rx="2.5" fill="#9A6B3B" stroke="#6B4624" stroke-width="1.2"/><path d="M124 178 C126 192 137 192 139 178 C139 174 124 174 124 178 Z" fill="#D9A24B" stroke="#9A6B3B" stroke-width="1.2"/><path d="M127 180 L127 190 M131.5 181 L131.5 191 M136 180 L136 190" stroke="#9A6B3B" stroke-width="0.8" opacity=".6"/></g>`;
    default:
      return '';
  }
}

/**
 * A single tinted ear. `cx` is the base anchor on the head; `rot` rotates the
 * whole ear; `flop` folds the tip over (used for the student's right ear).
 * Drawn in the accent `color` with a dark outline and a soft inner highlight,
 * plus the reference's pink inner-ear stroke.
 */
function ear(u: string, key: string, color: string, cx: number, cy: number, rot: number, flop: boolean): string {
  const stroke = shade(color, -45);
  const light = shade(color, 42);
  const id = `ear${key}${u}`;
  // Upright ear: a tall rounded blade rising from the base.
  const upright = `M${cx - 7} ${cy} C${cx - 11} ${cy - 34} ${cx - 7} ${cy - 64} ${cx} ${cy - 66} C${cx + 7} ${cy - 64} ${cx + 11} ${cy - 34} ${cx + 7} ${cy} C${cx + 4} ${cy + 6} ${cx - 4} ${cy + 6} ${cx - 7} ${cy} Z`;
  // Flopped ear: rises a little then folds down over itself to one side.
  const flopped = `M${cx - 7} ${cy} C${cx - 10} ${cy - 22} ${cx - 4} ${cy - 38} ${cx + 10} ${cy - 40} C${cx + 26} ${cy - 42} ${cx + 30} ${cy - 24} ${cx + 22} ${cy - 14} C${cx + 16} ${cy - 7} ${cx + 6} ${cy - 6} ${cx + 4} ${cy} C${cx + 1} ${cy + 6} ${cx - 4} ${cy + 6} ${cx - 7} ${cy} Z`;
  const d = flop ? flopped : upright;
  // Inner highlight + pink centre line follow the blade.
  const innerLight = flop
    ? `<path d="M${cx} ${cy - 4} C${cx + 6} ${cy - 18} ${cx + 16} ${cy - 24} ${cx + 20} ${cy - 20}" stroke="${light}" stroke-width="4" fill="none" stroke-linecap="round" opacity=".55"/>`
    : `<path d="M${cx} ${cy - 6} C${cx - 2} ${cy - 30} ${cx} ${cy - 52} ${cx} ${cy - 58}" stroke="${light}" stroke-width="4.5" fill="none" stroke-linecap="round" opacity=".55"/>`;
  const pink = flop
    ? `<path d="M${cx + 2} ${cy - 6} C${cx + 8} ${cy - 18} ${cx + 16} ${cy - 24} ${cx + 19} ${cy - 21}" stroke="#E7A9B0" stroke-width="2.4" fill="none" stroke-linecap="round" opacity=".7"/>`
    : `<path d="M${cx} ${cy - 8} C${cx - 1} ${cy - 30} ${cx} ${cy - 50} ${cx} ${cy - 56}" stroke="#E7A9B0" stroke-width="2.6" fill="none" stroke-linecap="round" opacity=".7"/>`;
  return `<g transform="rotate(${rot} ${cx} ${cy})"><defs><radialGradient id="${id}" cx="40%" cy="24%" r="86%"><stop offset="0%" stop-color="${shade(color, 28)}"/><stop offset="60%" stop-color="${color}"/><stop offset="100%" stop-color="${shade(color, -30)}"/></radialGradient></defs><path d="${d}" fill="url(#${id})" stroke="${stroke}" stroke-width="2.2" stroke-linejoin="round"/>${pink}${innerLight}</g>`;
}

export function longearFull(o: { stage?: Stage; color?: string; acc?: Accessory; mark?: Marking }): FullRender {
  const u = 'm' + nextUid();
  const color = o.color ?? '#5B7C2E';
  const stage = o.stage ?? 'student';
  const stroke = shade(color, -45);
  const vb = '0 0 200 230';
  const defs = cellDefs(u);

  if (stage === 'egg') {
    const eshade = shade(color, -45);
    const eg = `ear-egg${u}`;
    const eargrad = `<defs><radialGradient id="${eg}" cx="40%" cy="24%" r="86%"><stop offset="0%" stop-color="${shade(color, 28)}"/><stop offset="100%" stop-color="${shade(color, -30)}"/></radialGradient></defs>`;
    const art = `${defs}<ellipse cx="100" cy="198" rx="30" ry="6" fill="#23291A" opacity=".12" filter="url(#bMd${u})"/><g>
      ${eargrad}
      <ellipse cx="92" cy="72" rx="3.5" ry="10" fill="url(#${eg})" stroke="${eshade}" stroke-width="1.4" transform="rotate(-12 92 72)"/>
      <ellipse cx="108" cy="72" rx="3.5" ry="10" fill="url(#${eg})" stroke="${eshade}" stroke-width="1.4" transform="rotate(12 108 72)"/>
      ${eggBase(u)}
      <circle cx="84" cy="118" r="4" fill="#E0B24A" opacity=".5"/><circle cx="112" cy="140" r="5" fill="#E0B24A" opacity=".5"/></g>`;
    return { art, viewBox: vb, cls: 'cr eggy' };
  }

  // student | senior | grad share body+ears+face; senior/grad are larger and footed.
  const sr = stage === 'student';
  const bodyD = sr
    ? `M100 112 C80 112 66 128 66 150 C66 174 80 190 100 192 C120 190 134 174 134 150 C134 128 120 112 100 112 Z`
    : `M100 104 C76 104 60 122 60 150 C60 178 76 198 100 200 C124 198 140 178 140 150 C140 122 124 104 100 104 Z`;
  const ey = sr ? 128 : (stage === 'grad' ? 150 : 146);
  const ckY = sr ? 146 : (stage === 'grad' ? 167 : 164);
  // Ear base anchors sit on the head crown.
  const earBaseY = sr ? 116 : 110;
  const earLX = sr ? 84 : 82;
  const earRX = sr ? 116 : 118;
  const headTop = sr ? 56 : 48;

  // Ears: student = left up, right flopped. senior/grad = both up.
  const ears = sr
    ? `${ear(u, 'L', color, earLX, earBaseY, -8, false)}${ear(u, 'R', color, earRX, earBaseY, 10, true)}`
    : `${ear(u, 'L', color, earLX, earBaseY, -10, false)}${ear(u, 'R', color, earRX, earBaseY, 10, false)}`;

  const shadow = `<ellipse cx="100" cy="${sr ? 204 : 208}" rx="${sr ? 40 : 48}" ry="${sr ? 7 : 8}" fill="#23291A" opacity=".14" filter="url(#bMd${u})"/>`;
  const feet = sr ? '' : `<ellipse cx="84" cy="200" rx="13" ry="8.5" fill="${shade(color, -30)}"/><ellipse cx="116" cy="200" rx="13" ry="8.5" fill="${shade(color, -30)}"/>`;
  const belly = sr ? '' : `<ellipse cx="100" cy="166" rx="30" ry="36" fill="#FFFBF0" opacity=".5" filter="url(#bMd${u})"/>`;
  const hatch = sr ? hatchShell(u) : '';

  // Triangle nose + mouth, authored from the reference geometry.
  const noseY = sr ? ckY - 0 : ckY - 2;
  const nose = `<path d="M${100 - 3} ${noseY} L${100 + 3} ${noseY} L100 ${noseY + 4} Z" fill="#B0766E" stroke="${shade('#B0766E', -20)}" stroke-width="0.8" stroke-linejoin="round"/>`;
  const mouth = `<path d="M${100 - 6} ${noseY + 7} Q100 ${noseY + 12} ${100 + 6} ${noseY + 7}" stroke="#8A6E45" stroke-width="2.4" fill="none" stroke-linecap="round"/>`;

  const eyes = cellEyes(u, 86, 114, ey, stroke, { rx: 12.5, ry: 14, pr: 7.5 });
  const blush = cellBlush(u, sr ? 70 : 66, sr ? 130 : 134, ckY);
  const board = stage === 'grad' ? mortarboard(u, 100, 86, { rot: -6 }) : '';

  const art = `${defs}${shadow}<g>${feet}
    ${ears}
    ${tintedBody(u, 'body', bodyD, color)}${belly}
    ${longearMark(o.mark ?? 'none', color)}
    ${board}
    ${eyes}${blush}${nose}${mouth}
    ${longearAcc(o.acc ?? 'none', ey, headTop)}${hatch}</g>`;
  return { art, viewBox: vb, cls: 'cr' };
}
