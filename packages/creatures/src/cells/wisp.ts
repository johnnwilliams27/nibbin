/**
 * Wisp — the hovering flame nibbin. Ported from its signed-off lifecycle art
 * (egg / student / senior / grad) into the procedural engine, following the
 * Capling pilot's structure. Signature: a palette-derived flame that brightens
 * as the creature grows — and is DROPPED at graduation when the mortarboard
 * takes the headspace. Wisp hovers, so student/senior/grad return `cr floaty`
 * and draw no ground contact-shadow; only the dormant egg sits ('cr eggy').
 *
 * Feature-drop marker: the flame is the only place `shade(color, 45)` appears,
 * so it is present at student+senior and absent at grad (engine invariant).
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

/** Marking overlay on the wisp body (face area kept clear). */
function wispMark(mark: Marking, color: string): string {
  if (mark === 'spots') {
    return `<circle cx="78" cy="168" r="3" fill="${shade(color, 30)}" opacity=".5"/><circle cx="120" cy="172" r="3.4" fill="${shade(color, 30)}" opacity=".5"/><circle cx="98" cy="182" r="2.6" fill="${shade(color, 30)}" opacity=".45"/>`;
  }
  if (mark === 'stripe') {
    return `<path d="M100 160 C97 170 97 182 100 192" stroke="${shade(color, -10)}" stroke-width="7" fill="none" stroke-linecap="round" opacity=".4"/>`;
  }
  if (mark === 'star') return star(100, 174, 8, '#F6D45F');
  return '';
}

/** Accessory overlay in 200-space, driven by the eye/head geometry. */
function wispAcc(acc: Accessory, ey: number, headTop: number): string {
  const exL = 87, exR = 115;
  switch (acc) {
    case 'glasses':
      return `<g fill="none" stroke="#3A3026" stroke-width="2.6"><circle cx="${exL}" cy="${ey}" r="17"/><circle cx="${exR}" cy="${ey}" r="17"/><path d="M${exL + 17} ${ey} L${exR - 17} ${ey}"/><path d="M${exL - 17} ${ey - 2} l-6 -3"/><path d="M${exR + 17} ${ey - 2} l6 -3"/></g>`;
    case 'bow':
      return `<g transform="translate(100 ${headTop})"><path d="M0 0 C-14 -8 -16 8 -2 4 C-1 6 1 6 2 4 C16 8 14 -8 0 0 Z" fill="#E2603A" stroke="#A53C22" stroke-width="1.6"/><circle r="3.2" fill="#C84A2A" stroke="#A53C22" stroke-width="1.2"/></g>`;
    case 'coin':
      return `<g transform="translate(132 186)"><circle r="11" fill="#F6D45F" stroke="#B98F1F" stroke-width="2"/><circle r="11" fill="none" stroke="#FBE9A0" stroke-width="1" opacity=".7"/><text x="0" y="5" font-size="13" font-weight="700" text-anchor="middle" fill="#B98F1F" font-family="system-ui">$</text></g>`;
    case 'pencil':
      return `<g transform="rotate(34 130 178)"><rect x="125" y="152" width="10" height="40" rx="2" fill="#F0B429" stroke="#B98F1F" stroke-width="1.4"/><path d="M125 152 L135 152 L130 142 Z" fill="#F2D9A8" stroke="#B98F1F" stroke-width="1.2"/><rect x="125" y="188" width="10" height="6" fill="#E2748A"/></g>`;
    case 'quill':
      return `<g transform="rotate(20 134 170)"><path d="M134 194 C130 170 138 146 150 134 C150 154 146 180 138 194 Z" fill="#EAF0F6" stroke="#9FB0C2" stroke-width="1.4"/><path d="M138 152 L146 144 M136 164 L144 158 M135 176 L142 172" stroke="#9FB0C2" stroke-width="1" opacity=".6"/></g>`;
    case 'broom':
      return `<g transform="rotate(18 130 172)"><rect x="127" y="130" width="5" height="50" rx="2.5" fill="#9A6B3B" stroke="#6B4624" stroke-width="1.2"/><path d="M122 178 C124 192 135 192 137 178 C137 174 122 174 122 178 Z" fill="#D9A24B" stroke="#9A6B3B" stroke-width="1.2"/><path d="M125 180 L125 190 M129.5 181 L129.5 191 M134 180 L134 190" stroke="#9A6B3B" stroke-width="0.8" opacity=".6"/></g>`;
    default:
      return '';
  }
}

/**
 * Palette-derived flame + soft glow halo. The flame fill carries
 * `shade(color, 45)` (the feature-drop marker) with a darker core
 * `shade(color, 22)` and outline `shade(color, -32)`. The glow uses
 * `shade(color, 55)` at low opacity. `flameD` is the flame silhouette;
 * `gx,gy,gr` position the glow.
 */
function flame(u: string, color: string, flameD: string, coreD: string, gx: number, gy: number, gr: number): string {
  const light = shade(color, 45);
  const core = shade(color, 22);
  const stroke = shade(color, -32);
  const glow = shade(color, 55);
  return `<ellipse cx="${gx}" cy="${gy}" rx="${gr}" ry="${gr * 1.15}" fill="${glow}" opacity=".35" filter="url(#bMd${u})"/>
    <path d="${flameD}" fill="${light}" stroke="${stroke}" stroke-width="2"/>
    <path d="${coreD}" fill="${core}"/>`;
}

export function wispFull(o: { stage?: Stage; color?: string; acc?: Accessory; mark?: Marking }): FullRender {
  const u = 'm' + nextUid();
  const color = o.color ?? '#5B7C2E';
  const stage = o.stage ?? 'student';
  const vb = '0 0 200 230';
  const defs = cellDefs(u);
  const stroke = shade(color, -45);

  if (stage === 'egg') {
    // dormant ovoid + a tiny tinted flame hint on the egg top + contact shadow
    const eggFlameD = `M100 78 C96 70 99 66 97 58 C100 62 103 68 102 74 Z`;
    const eggCoreD = `M100 76 C98 71 100 68 99 62 C100 65 101 70 101 74 Z`;
    const art = `${defs}<ellipse cx="100" cy="198" rx="30" ry="6" fill="#3B3326" opacity=".12" filter="url(#bMd${u})"/><g>
      ${eggBase(u)}
      <ellipse cx="98" cy="60" rx="9" ry="11" fill="${shade(color, 55)}" opacity=".3" filter="url(#bSm${u})"/>
      <path d="${eggFlameD}" fill="${shade(color, 45)}" stroke="${stroke}" stroke-width="1.2"/>
      <path d="${eggCoreD}" fill="${shade(color, 22)}"/>
      <circle cx="84" cy="120" r="4" fill="${shade(color, 30)}" opacity=".4"/><circle cx="112" cy="142" r="5" fill="${shade(color, 30)}" opacity=".4"/></g>`;
    return { art, viewBox: vb, cls: 'cr eggy' };
  }

  const sr = stage === 'student';
  const isGrad = stage === 'grad';

  // Body: rounded ghost/wisp with a scalloped/flickering hem along the bottom.
  // Student: small, sits in shell. Senior/grad: larger, wavier (flickering) hem.
  const bodyD = sr
    ? `M100 92 C82 92 70 108 70 128 C70 140 73 150 78 158 L82 152 L88 160 L94 152 L100 162 L106 152 L112 160 L118 152 L122 158 C127 150 130 140 130 128 C130 108 118 92 100 92 Z`
    : `M100 80 C76 80 60 100 60 126 C60 142 64 156 72 168 L77 160 L83 170 L89 159 L95 170 L100 161 L105 170 L111 159 L117 170 L123 160 L128 168 C136 156 140 142 140 126 C140 100 124 80 100 80 Z`;

  // Flame: present at student + senior (signature), bigger at senior. NONE at grad.
  // Scaled to 70% about its base (where it meets the head) so it stays attached.
  const flameSvg = isGrad
    ? ''
    : sr
      ? `<g transform="translate(100 94) scale(0.7) translate(-100 -94)">${flame(
          u,
          color,
          `M100 94 C91 84 96 80 93 70 C91 65 96 61 100 56 C104 61 109 65 107 70 C106 80 109 84 100 94 Z`,
          `M100 90 C95 83 98 79 96 72 C100 76 101 82 100 88 Z`,
          100, 74, 16,
        )}</g>`
      : `<g transform="translate(100 84) scale(0.7) translate(-100 -84)">${flame(
          u,
          color,
          `M100 84 C86 68 94 60 89 46 C86 38 94 32 100 24 C106 32 114 38 111 46 C106 60 114 68 100 84 Z`,
          `M100 78 C92 68 96 60 94 50 C100 58 102 68 100 74 Z`,
          100, 54, 24,
        )}</g>`;

  const ey = sr ? 110 : isGrad ? 134 : 132;
  const ckY = sr ? 128 : isGrad ? 152 : 150;
  const ckXL = sr ? 68 : 64;
  const ckXR = sr ? 132 : 136;
  const headTop = sr ? 92 : 80;

  // grad mortarboard centred ~100,72 with a slight tilt
  const board = isGrad ? mortarboard(u, 100, 72, { rot: -6 }) : '';

  // student sits in its just-hatched jagged shell (no feet — it hovers)
  const hatch = sr ? hatchShell(u) : '';

  const art = `${defs}<g>
    ${flameSvg}
    ${tintedBody(u, 'body', bodyD, color)}
    ${wispMark(o.mark ?? 'none', color)}
    ${board}
    ${cellEyes(u, 87, 115, ey, stroke, { rx: 13, ry: 15, pr: 8 })}
    ${cellBlush(u, ckXL, ckXR, ckY)}
    ${cellSmile(101, ey + 20, 8, shade(color, -50))}
    ${wispAcc(o.acc ?? 'none', ey, headTop)}${hatch}</g>`;
  return { art, viewBox: vb, cls: 'cr floaty' };
}
