/**
 * Puff — the bird species ported into the high-fidelity creature engine.
 * Signature trait: the wings fledge (budding at student → big spread wings at
 * senior/grad) and a head crest of feather tufts. The crest is the
 * feature-drop marker: present at student + senior (tip dots use the light
 * `shade(color, 30)` tint), dropped at grad where the mortarboard takes the
 * headspace. Copies the structure of the signed-off `capling` pilot — owns its
 * palette-tinted body, shaded eyes, baked grad mortarboard, and
 * accessory/marking overlays in 200-space; shared neutrals come from
 * `cellDefs`/`mortarboard`/`hatchShell`/`eggBase`/`star`.
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

/** Marking overlay on the white belly fluff (face area kept clear). */
function puffMark(mark: Marking, color: string): string {
  if (mark === 'spots') {
    return `<circle cx="84" cy="176" r="3" fill="${shade(color, -10)}" opacity=".5"/><circle cx="116" cy="180" r="3.4" fill="${shade(color, -10)}" opacity=".5"/><circle cx="100" cy="190" r="2.6" fill="${shade(color, -10)}" opacity=".45"/>`;
  }
  if (mark === 'stripe') {
    return `<path d="M100 168 C97 178 97 190 100 198" stroke="${shade(color, -10)}" stroke-width="7" fill="none" stroke-linecap="round" opacity=".4"/>`;
  }
  if (mark === 'star') return star(100, 182, 8, '#F6D45F');
  return '';
}

/** Accessory overlay in 200-space, driven by the eye/head geometry. */
function puffAcc(acc: Accessory, ey: number, headTop: number): string {
  const exL = 87, exR = 113;
  switch (acc) {
    case 'glasses':
      return `<g fill="none" stroke="#3A3026" stroke-width="2.6"><circle cx="${exL}" cy="${ey}" r="17"/><circle cx="${exR}" cy="${ey}" r="17"/><path d="M${exL + 17} ${ey} L${exR - 17} ${ey}"/><path d="M${exL - 17} ${ey - 2} l-6 -3"/><path d="M${exR + 17} ${ey - 2} l6 -3"/></g>`;
    case 'bow':
      return `<g transform="translate(100 ${headTop})"><path d="M0 0 C-14 -8 -16 8 -2 4 C-1 6 1 6 2 4 C16 8 14 -8 0 0 Z" fill="#E2603A" stroke="#A53C22" stroke-width="1.6"/><circle r="3.2" fill="#C84A2A" stroke="#A53C22" stroke-width="1.2"/></g>`;
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

/** Orange beak (downward triangle) centred at (cx, top). */
function beak(cx: number, top: number, w: number, h: number): string {
  const hw = w / 2;
  return `<path d="M${cx - hw} ${top} L${cx + hw} ${top} L${cx} ${top + h} Z" fill="#E8A33D" stroke="#B97F1B" stroke-width="1.4" stroke-linejoin="round"/>`;
}

/**
 * Head crest — the feature-drop marker. `n` tufts (2 at student, 3 at senior)
 * fan from (cx, baseY) upward; stalks use shade(color,-32), tip dots use the
 * light tint shade(color, 30). DROPPED at grad. shade(color,30) must appear
 * ONLY here.
 */
function crest(cx: number, baseY: number, color: string, big: boolean): string {
  const stalk = shade(color, -32);
  const dot = shade(color, 30);
  if (big) {
    return `<g fill="none" stroke="${stalk}" stroke-width="3" stroke-linecap="round">
      <path d="M${cx} ${baseY} C${cx - 8} ${baseY - 14} ${cx - 12} ${baseY - 22} ${cx - 13} ${baseY - 30}"/>
      <path d="M${cx} ${baseY} C${cx} ${baseY - 16} ${cx} ${baseY - 26} ${cx} ${baseY - 34}"/>
      <path d="M${cx} ${baseY} C${cx + 8} ${baseY - 14} ${cx + 12} ${baseY - 22} ${cx + 13} ${baseY - 30}"/>
    </g>
    <circle cx="${cx - 13}" cy="${baseY - 32}" r="3.4" fill="${dot}"/><circle cx="${cx}" cy="${baseY - 36}" r="3.6" fill="${dot}"/><circle cx="${cx + 13}" cy="${baseY - 32}" r="3.4" fill="${dot}"/>`;
  }
  return `<g fill="none" stroke="${stalk}" stroke-width="2.6" stroke-linecap="round">
      <path d="M${cx} ${baseY} C${cx - 6} ${baseY - 10} ${cx - 8} ${baseY - 16} ${cx - 9} ${baseY - 22}"/>
      <path d="M${cx} ${baseY} C${cx + 6} ${baseY - 10} ${cx + 8} ${baseY - 16} ${cx + 9} ${baseY - 22}"/>
    </g>
    <circle cx="${cx - 9}" cy="${baseY - 24}" r="2.8" fill="${dot}"/><circle cx="${cx + 9}" cy="${baseY - 24}" r="2.8" fill="${dot}"/>`;
}

/** Spread/budding wings tinted to the palette, flanking the body. */
function wings(color: string, big: boolean): string {
  const fill = shade(color, -8);
  const stroke = shade(color, -45);
  if (big) {
    // big spread wings extend well beyond the body edges (body ~x58..142)
    return `<g class="flutter"><path d="M66 124 C40 116 18 130 22 158 C26 178 48 178 62 162 C50 168 36 164 34 152 C44 160 58 158 60 146 C50 152 40 148 40 138 C50 144 62 140 66 130 Z" fill="${fill}" stroke="${stroke}" stroke-width="2" stroke-linejoin="round"/>
      <path d="M134 124 C160 116 182 130 178 158 C174 178 152 178 138 162 C150 168 164 164 166 152 C156 160 142 158 140 146 C150 152 160 148 160 138 C150 144 138 140 134 130 Z" fill="${fill}" stroke="${stroke}" stroke-width="2" stroke-linejoin="round"/></g>`;
  }
  // budding wings: small stubs peeking out from the body sides (body ~x64..136)
  return `<g class="flutter"><path d="M68 138 C52 134 44 148 52 162 C60 170 70 164 70 152 C66 158 58 156 56 150 C62 154 70 150 68 142 Z" fill="${fill}" stroke="${stroke}" stroke-width="1.8" stroke-linejoin="round"/>
      <path d="M132 138 C148 134 156 148 148 162 C140 170 130 164 130 152 C134 158 142 156 144 150 C138 154 130 150 132 142 Z" fill="${fill}" stroke="${stroke}" stroke-width="1.8" stroke-linejoin="round"/></g>`;
}

/** Bird feet (two pronged toes). */
function feet(): string {
  return `<path d="M86 198 l0 9 M82 207 l8 0 M114 198 l0 9 M110 207 l8 0" stroke="#C9871F" stroke-width="3" stroke-linecap="round" fill="none"/>`;
}

export function puffFull(o: { stage?: Stage; color?: string; acc?: Accessory; mark?: Marking }): FullRender {
  const u = 'm' + nextUid();
  const color = o.color ?? '#5B7C2E';
  const stage = o.stage ?? 'student';
  const vb = '0 0 200 230';
  const defs = cellDefs(u);
  const stroke = shade(color, -45);

  if (stage === 'egg') {
    // dormant ovoid + tiny down-feather tufts on the egg top
    const tuft = `<path d="M98 80 C96 68 98 58 95 54 M104 80 C106 68 108 58 111 55" stroke="${shade(color, -32)}" stroke-width="2" fill="none" stroke-linecap="round"/>`;
    const dots = `<circle cx="84" cy="118" r="4" fill="#E2704A" opacity=".45"/><circle cx="112" cy="140" r="5" fill="#E2704A" opacity=".45"/>`;
    const art = `${defs}<ellipse cx="100" cy="198" rx="30" ry="6" fill="#23291A" opacity=".12" filter="url(#bMd${u})"/><g>
      ${tuft}
      ${eggBase(u)}
      ${dots}</g>`;
    return { art, viewBox: vb, cls: 'cr eggy' };
  }

  // student | senior | grad share the round body + face. senior/grad fledge.
  const sr = stage === 'student';
  const bodyD = sr
    ? `M100 108 C78 108 64 124 64 146 C64 170 80 188 100 188 C120 188 136 170 136 146 C136 124 122 108 100 108 Z`
    : `M100 100 C74 100 58 120 58 150 C58 178 76 200 100 200 C124 200 142 178 142 150 C142 120 126 100 100 100 Z`;
  const ey = sr ? 122 : stage === 'grad' ? 130 : 126;
  const ckY = sr ? 140 : stage === 'grad' ? 152 : 150;
  const ckL = sr ? 70 : 66;
  const ckR = sr ? 130 : 134;
  const headTop = sr ? 100 : 92;
  const beakTop = sr ? 134 : stage === 'grad' ? 142 : 138;
  const crestBase = sr ? 110 : 102;

  const shadow = `<ellipse cx="100" cy="${sr ? 204 : 210}" rx="${sr ? 38 : 46}" ry="${sr ? 7 : 8}" fill="#23291A" opacity=".14" filter="url(#bMd${u})"/>`;
  const belly = `<ellipse cx="100" cy="${sr ? 162 : 170}" rx="${sr ? 26 : 30}" ry="${sr ? 30 : 36}" fill="#FFFBF0" opacity=".6" filter="url(#bMd${u})"/>`;

  // wings: budding at student, big spread at senior/grad
  const wing = wings(color, !sr);
  // feet: none at student (sits in shell), bird feet at senior/grad
  const foot = sr ? '' : feet();
  // student sits in its just-hatched jagged shell
  const shell = sr ? hatchShell(u) : '';

  // crest present at student + senior; DROPPED at grad (mortarboard takes headspace)
  const crestArt = stage === 'grad' ? '' : crest(100, crestBase, color, !sr);
  // mortarboard ONLY at grad
  const board = stage === 'grad' ? mortarboard(u, 100, 96) : '';

  const art = `${defs}${shadow}<g>
    ${wing}${foot}
    ${tintedBody(u, 'body', bodyD, color)}${belly}
    ${puffMark(o.mark ?? 'none', color)}
    ${crestArt}${board}
    ${beak(100, beakTop, 16, 11)}
    ${cellEyes(u, 87, 113, ey, stroke, { rx: 13.5, ry: 15, pr: 8 })}
    ${cellBlush(u, ckL, ckR, ckY)}
    ${puffAcc(o.acc ?? 'none', ey, headTop)}${shell}</g>`;
  return { art, viewBox: vb, cls: 'cr' };
}
