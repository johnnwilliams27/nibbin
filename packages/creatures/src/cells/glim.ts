/**
 * Glim — the hovering glow-moth. Signature: a dormant glow awakens, butterfly
 * wings grow, antennae sprout, and the creature lifts off the ground (it
 * HOVERS — no contact shadow once hatched). Ported into the procedural engine
 * from the signed-off lifecycle art (viewBox "0 0 200 230"), following the
 * Capling pilot's structure: own palette-tinted head, a glowing abdomen mass
 * with its own gradient, pale translucent wings, shared shaded eyes / blush /
 * smile / mortarboard, and accessory/marking overlays in 200-space.
 *
 * Feature-drop marker: the antennae tip dots use `shade(color, 50)` and are
 * present at student + senior but DROPPED at grad (the mortarboard takes the
 * headspace). So `shade(color, 50)` appears ONLY in the antennae.
 */
import { shade } from '../color';
import { nextUid } from '../mass';
import type { Accessory, FullRender, Marking, Stage } from '../types';
import { cellBlush, cellDefs, cellEyes, cellSmile, eggBase, hatchShell, mortarboard, star } from './shared';

/** Marking overlay on the head/abdomen body (face area kept clear). */
function glimMark(mark: Marking, color: string): string {
  if (mark === 'spots') {
    return `<circle cx="80" cy="176" r="3" fill="${shade(color, -20)}" opacity=".45"/><circle cx="120" cy="180" r="3.4" fill="${shade(color, -20)}" opacity=".45"/><circle cx="100" cy="192" r="2.6" fill="${shade(color, -20)}" opacity=".4"/>`;
  }
  if (mark === 'stripe') {
    return `<path d="M100 156 C97 168 97 186 100 198" stroke="${shade(color, -18)}" stroke-width="7" fill="none" stroke-linecap="round" opacity=".4"/>`;
  }
  if (mark === 'star') return star(100, 180, 8, '#F6D45F');
  return '';
}

/** Accessory overlay in 200-space, driven by the eye geometry. */
function glimAcc(acc: Accessory, ey: number): string {
  const exL = 88, exR = 112;
  switch (acc) {
    case 'glasses':
      return `<g fill="none" stroke="#3A3026" stroke-width="2.6"><circle cx="${exL}" cy="${ey}" r="15"/><circle cx="${exR}" cy="${ey}" r="15"/><path d="M${exL + 15} ${ey} L${exR - 15} ${ey}"/><path d="M${exL - 15} ${ey - 2} l-6 -3"/><path d="M${exR + 15} ${ey - 2} l6 -3"/></g>`;
    case 'bow':
      return `<g transform="translate(100 96)"><path d="M0 0 C-14 -8 -16 8 -2 4 C-1 6 1 6 2 4 C16 8 14 -8 0 0 Z" fill="#E2603A" stroke="#A53C22" stroke-width="1.6"/><circle r="3.2" fill="#C84A2A" stroke="#A53C22" stroke-width="1.2"/></g>`;
    case 'coin':
      return `<g transform="translate(138 188)"><circle r="11" fill="#F6D45F" stroke="#B98F1F" stroke-width="2"/><circle r="11" fill="none" stroke="#FBE9A0" stroke-width="1" opacity=".7"/><text x="0" y="5" font-size="13" font-weight="700" text-anchor="middle" fill="#B98F1F" font-family="system-ui">$</text></g>`;
    case 'pencil':
      return `<g transform="rotate(34 136 184)"><rect x="131" y="158" width="10" height="40" rx="2" fill="#F0B429" stroke="#B98F1F" stroke-width="1.4"/><path d="M131 158 L141 158 L136 148 Z" fill="#F2D9A8" stroke="#B98F1F" stroke-width="1.2"/><rect x="131" y="194" width="10" height="6" fill="#E2748A"/></g>`;
    case 'quill':
      return `<g transform="rotate(20 140 176)"><path d="M140 200 C136 176 144 152 156 140 C156 160 152 186 144 200 Z" fill="#EAF0F6" stroke="#9FB0C2" stroke-width="1.4"/><path d="M144 158 L152 150 M142 170 L150 164 M141 182 L148 178" stroke="#9FB0C2" stroke-width="1" opacity=".6"/></g>`;
    case 'broom':
      return `<g transform="rotate(18 136 178)"><rect x="133" y="136" width="5" height="50" rx="2.5" fill="#9A6B3B" stroke="#6B4624" stroke-width="1.2"/><path d="M128 184 C130 198 141 198 143 184 C143 180 128 180 128 184 Z" fill="#D9A24B" stroke="#9A6B3B" stroke-width="1.2"/><path d="M131 186 L131 196 M135.5 187 L135.5 197 M140 186 L140 196" stroke="#9A6B3B" stroke-width="0.8" opacity=".6"/></g>`;
    default:
      return '';
  }
}

/** Two pale translucent butterfly wings on each side, behind the body. */
function wings(sr: boolean): string {
  if (sr) {
    // small upper wings for the hatching student
    return `<g class="flutter" opacity=".92"><path d="M88 120 C66 108 50 116 52 134 C54 150 74 150 88 134 Z" fill="#EAF6FF" stroke="#9FC8E8" stroke-width="1.6"/><path d="M112 120 C134 108 150 116 148 134 C146 150 126 150 112 134 Z" fill="#E3F0FF" stroke="#9FC8E8" stroke-width="1.6"/></g>`;
  }
  // full four-wing spread for senior/grad
  return `<g class="flutter" opacity=".92">
    <path d="M82 150 C50 122 26 130 26 156 C26 180 54 184 82 166 Z" fill="#EAF6FF" stroke="#9FC8E8" stroke-width="1.8"/>
    <path d="M82 168 C56 168 38 184 40 204 C42 220 70 216 84 196 Z" fill="#E3F0FF" stroke="#9FC8E8" stroke-width="1.6"/>
    <path d="M118 150 C150 122 174 130 174 156 C174 180 146 184 118 166 Z" fill="#EAF6FF" stroke="#9FC8E8" stroke-width="1.8"/>
    <path d="M118 168 C144 168 162 184 160 204 C158 220 130 216 116 196 Z" fill="#E3F0FF" stroke="#9FC8E8" stroke-width="1.6"/>
  </g>`;
}

/**
 * Antennae (the signature) with glowing tips. The tip dots use shade(color,50)
 * — the feature-drop marker — and the stalks use shade(color,-32). `cx` are the
 * antenna roots on the head top; tips curve outward and up.
 */
function antennae(color: string, sr: boolean): string {
  const stalk = shade(color, -32), tip = shade(color, 50);
  if (sr) {
    return `<path d="M93 102 C90 90 88 80 84 73 M107 102 C110 90 112 80 116 73" stroke="${stalk}" stroke-width="2.4" fill="none" stroke-linecap="round"/><circle cx="84" cy="71" r="3" fill="${tip}"/><circle cx="116" cy="71" r="3" fill="${tip}"/>`;
  }
  return `<path d="M92 94 C88 80 85 68 80 60 M108 94 C112 80 115 68 120 60" stroke="${stalk}" stroke-width="2.6" fill="none" stroke-linecap="round"/><circle cx="80" cy="58" r="3.4" fill="${tip}"/><circle cx="120" cy="58" r="3.4" fill="${tip}"/>`;
}

/** Glowing abdomen mass below the head — its own gradient (52 light → glow halo). */
function abdomen(u: string, color: string): string {
  const light = shade(color, 52), glow = shade(color, 55), outline = shade(color, -30);
  return `<defs><radialGradient id="glimAbd${u}" cx="42%" cy="32%" r="82%"><stop offset="0%" stop-color="${light}"/><stop offset="100%" stop-color="${color}"/></radialGradient>
    <radialGradient id="glimGlow${u}" cx="50%" cy="50%" r="50%"><stop offset="0%" stop-color="${glow}" stop-opacity=".75"/><stop offset="100%" stop-color="${glow}" stop-opacity="0"/></radialGradient></defs>
    <circle class="glowpulse" cx="100" cy="178" r="34" fill="url(#glimGlow${u})" filter="url(#bMd${u})"/>
    <ellipse cx="100" cy="174" rx="30" ry="28" fill="url(#glimAbd${u})" stroke="${outline}" stroke-width="2.2"/>`;
}

export function glimFull(o: { stage?: Stage; color?: string; acc?: Accessory; mark?: Marking }): FullRender {
  const u = 'm' + nextUid();
  const color = o.color ?? '#5B7C2E';
  const stage = o.stage ?? 'student';
  const vb = '0 0 200 230';
  const defs = cellDefs(u);
  const stroke = shade(color, -45);

  if (stage === 'egg') {
    const tip = shade(color, 50), stalk = shade(color, -32);
    const art = `${defs}<ellipse cx="100" cy="198" rx="30" ry="6" fill="#23291A" opacity=".12" filter="url(#bMd${u})"/><g>
      <path d="M94 80 C92 68 92 58 94 50 M106 80 C108 68 108 58 106 50" stroke="${stalk}" stroke-width="2.2" fill="none" stroke-linecap="round"/>
      <circle cx="94" cy="48" r="2.4" fill="${tip}"/><circle cx="106" cy="48" r="2.4" fill="${tip}"/>
      ${eggBase(u)}
      <circle cx="100" cy="150" r="9" fill="#CFF2FF" opacity=".7" filter="url(#bSm${u})"/></g>`;
    return { art, viewBox: vb, cls: 'cr eggy' };
  }

  // student | senior | grad share head + face; senior/grad grow the glowing abdomen.
  const sr = stage === 'student';

  // Head body (palette-tinted) — small high head for student, fuller for senior/grad.
  const headD = sr
    ? `M100 100 C84 100 74 112 74 128 C74 146 86 158 100 158 C114 158 126 146 126 128 C126 112 116 100 100 100 Z`
    : `M100 96 C82 96 70 110 70 130 C70 150 84 162 100 162 C116 162 130 150 130 130 C130 110 118 96 100 96 Z`;
  const headLight = shade(color, 28), headDark = shade(color, -30);
  const headBody = `<defs><radialGradient id="glimHead${u}" cx="40%" cy="28%" r="86%"><stop offset="0%" stop-color="${headLight}"/><stop offset="60%" stop-color="${color}"/><stop offset="100%" stop-color="${headDark}"/></radialGradient></defs><path d="${headD}" fill="url(#glimHead${u})" stroke="${stroke}" stroke-width="2.2"/>`;

  const ey = sr ? 120 : stage === 'senior' ? 130 : 132;
  const exL = 88, exR = 112;
  const ckY = sr ? 136 : stage === 'senior' ? 146 : 148;
  const smileY = sr ? 136 : stage === 'senior' ? 146 : 148;

  // Hover: no contact shadow once hatched. Faint glow for the student.
  const studentGlow = sr ? `<circle cx="100" cy="146" r="14" fill="#CFF2FF" opacity=".5" filter="url(#bMd${u})"/>` : '';
  const hatch = sr ? hatchShell(u) : '';

  // senior/grad grow the bright glowing abdomen; grad keeps it too.
  const abd = !sr ? abdomen(u, color) : '';

  // antennae present at student + senior, DROPPED at grad.
  const ant = stage === 'grad' ? '' : antennae(color, sr);

  // grad: mortarboard centred ~100,98; no antennae.
  const board = stage === 'grad' ? mortarboard(u, 100, 96, { rot: -6 }) : '';

  const eyes = cellEyes(u, exL, exR, ey, stroke, { rx: 12, ry: 13.5, pr: 7.5 });
  const blush = cellBlush(u, 72, 128, ckY);
  const smile = cellSmile(100, smileY, 7, shade(color, -50));

  const art = `${defs}<g>
    ${wings(sr)}
    ${abd}
    ${glimMark(o.mark ?? 'none', color)}
    ${headBody}
    ${studentGlow}
    ${board}
    ${eyes}${blush}${smile}
    ${ant}
    ${glimAcc(o.acc ?? 'none', ey)}${hatch}</g>`;
  return { art, viewBox: vb, cls: 'cr floaty' };
}
