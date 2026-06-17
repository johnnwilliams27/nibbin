/**
 * Sprout — the head-sprout species (leaf → flower). Ported from the signed-off
 * lifecycle art into the procedural engine, copying the Capling pilot's
 * structure: a dormant egg with a sprout hint, a hatching student in its jagged
 * shell, a footed senior whose head leaf opens into a five-petal flower, and a
 * graduate wearing the baked mortarboard with a honey bloom tucked beside it.
 * The body is palette-tinted via `tintedBody`; shared neutrals come from
 * `cellDefs`/`mortarboard`/`eggBase`/`hatchShell`/`star`.
 */
import { shade } from '../color';
import { nextUid } from '../mass';
import type { Accessory, FullRender, Marking, Stage } from '../types';
import {
  cellBlush,
  cellDefs,
  cellEyes,
  cellSmile,
  eggBase,
  hatchShell,
  mortarboard,
  star,
  tintedBody,
} from './shared';

/** Marking overlay on the body (face area kept clear). */
function sproutMark(mark: Marking, color: string): string {
  if (mark === 'spots') {
    return `<circle cx="74" cy="166" r="3.4" fill="${shade(color, 30)}" opacity=".5"/><circle cx="122" cy="172" r="3" fill="${shade(color, 30)}" opacity=".5"/><circle cx="98" cy="184" r="2.8" fill="${shade(color, 30)}" opacity=".45"/>`;
  }
  if (mark === 'stripe') {
    return `<path d="M100 158 C97 168 97 180 100 192" stroke="${shade(color, -10)}" stroke-width="7" fill="none" stroke-linecap="round" opacity=".4"/>`;
  }
  if (mark === 'star') return star(100, 176, 8, '#F6D45F');
  return '';
}

/** Accessory overlay in 200-space, driven by the eye geometry. */
function sproutAcc(acc: Accessory, ey: number): string {
  const exL = 86, exR = 116;
  switch (acc) {
    case 'glasses':
      return `<g fill="none" stroke="#3A3026" stroke-width="2.6"><circle cx="${exL}" cy="${ey}" r="17"/><circle cx="${exR}" cy="${ey}" r="17"/><path d="M${exL + 17} ${ey} L${exR - 17} ${ey}"/><path d="M${exL - 17} ${ey - 2} l-6 -3"/><path d="M${exR + 17} ${ey - 2} l6 -3"/></g>`;
    case 'bow':
      return `<g transform="translate(100 64)"><path d="M0 0 C-14 -8 -16 8 -2 4 C-1 6 1 6 2 4 C16 8 14 -8 0 0 Z" fill="#E2603A" stroke="#A53C22" stroke-width="1.6"/><circle r="3.2" fill="#C84A2A" stroke="#A53C22" stroke-width="1.2"/></g>`;
    case 'coin':
      return `<g transform="translate(134 184)"><circle r="11" fill="#F6D45F" stroke="#B98F1F" stroke-width="2"/><circle r="11" fill="none" stroke="#FBE9A0" stroke-width="1" opacity=".7"/><text x="0" y="5" font-size="13" font-weight="700" text-anchor="middle" fill="#B98F1F" font-family="system-ui">$</text></g>`;
    case 'pencil':
      return `<g transform="rotate(34 132 176)"><rect x="127" y="150" width="10" height="40" rx="2" fill="#F0B429" stroke="#B98F1F" stroke-width="1.4"/><path d="M127 150 L137 150 L132 140 Z" fill="#F2D9A8" stroke="#B98F1F" stroke-width="1.2"/><rect x="127" y="186" width="10" height="6" fill="#E2748A"/></g>`;
    case 'quill':
      return `<g transform="rotate(20 136 168)"><path d="M136 192 C132 168 140 144 152 132 C152 152 148 178 140 192 Z" fill="#EAF0F6" stroke="#9FB0C2" stroke-width="1.4"/><path d="M140 150 L148 142 M138 162 L146 156 M137 174 L144 170" stroke="#9FB0C2" stroke-width="1" opacity=".6"/></g>`;
    case 'broom':
      return `<g transform="rotate(18 132 170)"><rect x="129" y="128" width="5" height="50" rx="2.5" fill="#9A6B3B" stroke="#6B4624" stroke-width="1.2"/><path d="M124 176 C126 190 137 190 139 176 C139 172 124 172 124 176 Z" fill="#D9A24B" stroke="#9A6B3B" stroke-width="1.2"/><path d="M127 178 L127 188 M131.5 179 L131.5 189 M136 178 L136 188" stroke="#9A6B3B" stroke-width="0.8" opacity=".6"/></g>`;
    default:
      return '';
  }
}

/** The head sprout — stem + one or two juvenile leaves, palette-tinted. */
function sprig(color: string, twin: boolean): string {
  const stemStroke = shade(color, -20);
  const leaf = shade(color, 30);
  const leafStroke = shade(color, -25);
  const second = twin
    ? `<path d="M100 58 C93 52 86 54 82 48 C87 42 96 44 100 54 Z" fill="${leaf}" stroke="${leafStroke}" stroke-width="1"/>`
    : '';
  return `<path d="M100 76 C101 64 104 58 104 50" stroke="${stemStroke}" stroke-width="2.8" fill="none" stroke-linecap="round"/>
    <path d="M104 52 C112 46 119 48 122 42 C117 36 108 39 104 49 Z" fill="${leaf}" stroke="${leafStroke}" stroke-width="1"/>${second}`;
}

/** The five-petal flower that the senior's head leaf opens into. */
function flower(color: string): string {
  const stemStroke = shade(color, -20);
  const petal = '#FBF3E8', petalStroke = '#E2B6CC';
  const bloom = '#F2C76B';
  return `<path d="M100 78 C101 66 102 58 102 48" stroke="${stemStroke}" stroke-width="2.6" fill="none" stroke-linecap="round"/>
    <circle cx="102" cy="35" r="6" fill="${petal}" stroke="${petalStroke}" stroke-width="1"/>
    <circle cx="113" cy="42" r="6" fill="${petal}" stroke="${petalStroke}" stroke-width="1"/>
    <circle cx="109" cy="54" r="6" fill="${petal}" stroke="${petalStroke}" stroke-width="1"/>
    <circle cx="95" cy="54" r="6" fill="${petal}" stroke="${petalStroke}" stroke-width="1"/>
    <circle cx="91" cy="42" r="6" fill="${petal}" stroke="${petalStroke}" stroke-width="1"/>
    <circle cx="102" cy="46" r="4.5" fill="${bloom}" stroke="#D9A21B" stroke-width="1"/>`;
}

export function sproutFull(o: { stage?: Stage; color?: string; acc?: Accessory; mark?: Marking }): FullRender {
  const u = 'm' + nextUid();
  const color = o.color ?? '#5B7C2E';
  const stage = o.stage ?? 'student';
  const vb = '0 0 200 230';
  const defs = cellDefs(u);
  const stroke = shade(color, -45);

  if (stage === 'egg') {
    const stemStroke = shade(color, -20);
    const leaf = shade(color, 30);
    const leafStroke = shade(color, -25);
    const art = `${defs}<ellipse cx="100" cy="198" rx="30" ry="6" fill="#23291A" opacity=".12" filter="url(#bMd${u})"/><g>
      <path d="M100 80 C103 70 106 66 106 58" stroke="${stemStroke}" stroke-width="2.4" fill="none" stroke-linecap="round"/>
      <path d="M106 60 C113 56 118 58 121 53 C116 48 109 50 106 57 Z" fill="${leaf}" stroke="${leafStroke}" stroke-width="1"/>
      ${eggBase(u)}
      <circle cx="84" cy="118" r="4" fill="${color}" opacity=".4"/><circle cx="112" cy="140" r="5" fill="${color}" opacity=".4"/></g>`;
    return { art, viewBox: vb, cls: 'cr eggy' };
  }

  // student | senior | grad share the body + face; senior/grad are larger and footed.
  const sr = stage === 'student';
  const bodyD = sr
    ? `M100 74 C76 74 60 96 59 126 C58 152 64 184 100 188 C136 184 142 152 141 126 C140 96 124 74 100 74 Z`
    : `M100 78 C76 78 60 100 59 130 C58 158 64 192 100 196 C136 192 142 158 141 130 C140 100 124 78 100 78 Z`;
  const ey = sr ? 120 : 132;
  const ckY = sr ? 138 : 150;
  const smileY = sr ? 152 : 152;
  const shadow = `<ellipse cx="100" cy="${sr ? 204 : 210}" rx="${sr ? 40 : 46}" ry="${sr ? 7 : 8}" fill="#23291A" opacity=".14" filter="url(#bMd${u})"/>`;
  const feet = sr
    ? ''
    : `<ellipse cx="84" cy="200" rx="13" ry="8.5" fill="${shade(color, -28)}"/><ellipse cx="116" cy="200" rx="13" ry="8.5" fill="${shade(color, -28)}"/>`;
  const belly = sr
    ? ''
    : `<ellipse cx="82" cy="158" rx="32" ry="38" fill="#FFFBF0" opacity=".4" filter="url(#bMd${u})"/>`;
  const hatch = sr ? hatchShell(u) : '';

  // Head feature per stage: student keeps juvenile twin-leaf sprig; senior blooms;
  // grad tucks a small honey bloom beside the mortarboard so nothing clashes.
  let head: string;
  if (sr) head = sprig(color, true);
  else if (stage === 'senior') head = flower(color);
  else {
    // grad: small flower/bloom beside the cap (the honey bloom MUST be #B5D87A)
    head = `<circle cx="122" cy="74" r="5" fill="#FBF3E8" stroke="#E2B6CC" stroke-width="1"/><circle cx="122" cy="74" r="2.4" fill="#B5D87A" stroke="#8FB94E" stroke-width="0.8"/>`;
  }

  const board = stage === 'grad' ? mortarboard(u, 100, 64, { rot: -6 }) : '';

  const art = `${defs}${shadow}<g>${feet}
    ${head}
    ${tintedBody(u, 'body', bodyD, color)}${belly}
    ${sproutMark(o.mark ?? 'none', color)}
    ${board}
    ${cellEyes(u, 86, 116, ey, stroke, { rx: 13.5, ry: 15, pr: 8, hl: 2.9 })}
    ${cellBlush(u, 66, 134, ckY)}
    ${cellSmile(100, smileY, 8, shade(color, -40))}
    ${sproutAcc(o.acc ?? 'none', ey)}${hatch}</g>`;
  return { art, viewBox: vb, cls: 'cr' };
}
