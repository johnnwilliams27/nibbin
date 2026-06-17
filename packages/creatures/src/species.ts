import { shade } from './color';
import { mass, pear, bean } from './mass';
import { eyesRound, eyesOval, eyesBead, blush, smileOpen, smileTiny, feet } from './parts';
import type { BodyParts, EggParts, SpeciesDef, SpeciesName, Stage } from './types';

function i0(stage?: Stage): 'student' | 'senior' | 'grad' {
  return stage === 'egg' || stage === undefined ? 'student' : stage;
}

const STAGE_INDEX = { student: 0, senior: 1, grad: 2 } as const;

export const SPECIES: Record<SpeciesName, SpeciesDef> = {
  Sprout: {
    trait: 'head-sprout blooms',
    tilt: -2,
    egg(color: string): EggParts {
      return {
        art: `<ellipse cx="36" cy="62" rx="15" ry="3" fill="#23291A" opacity=".08"/>
        <path d="M28 61 q1.5 -5 0 -8 M32 61.5 q2 -4 1 -7" stroke="#7FAF45" stroke-width="1.4" fill="none" stroke-linecap="round"/>
        ${mass('M36 14 C47.5 14 52 30 52 42 C52 54 45 61 36 61 C27 61 20 54 20 42 C20 30 24.5 14 36 14 Z', '#FBF6E6', { sw: 1.6 })}
        <circle cx="29" cy="34" r="2.4" fill="${color}" opacity=".5"/><circle cx="42" cy="44" r="2.9" fill="${color}" opacity=".5"/><circle cx="37" cy="26" r="1.8" fill="${color}" opacity=".45"/>
        <path d="M36 14 C35.5 10 37.5 7 41 5.5" stroke="#44601F" stroke-width="2" fill="none" stroke-linecap="round"/>
        <ellipse cx="43" cy="5" rx="3.4" ry="2" fill="#9CC25B" stroke="#5F8F33" stroke-width="0.8" transform="rotate(-24 43 5)"/>`,
      };
    },
    body(stage?: Stage, color = '#5B7C2E'): BodyParts {
      const i = STAGE_INDEX[i0(stage)];
      const top = [30, 28, 26][i], bot = [58, 58.5, 59][i], ht = [7.5, 8.5, 9.5][i], hb = [14, 15.5, 17][i];
      const cx = 36, d = pear(cx, top, bot, ht, hb);
      const ey = top + [13, 14, 15][i], er = [4.8, 5.1, 5.4][i], exL = cx - 6.5, exR = cx + 6.5;
      const leaf = (x: number, y: number, rot: number, fill: string) =>
        `<ellipse cx="${x}" cy="${y}" rx="4.6" ry="2.6" fill="${fill}" stroke="#5F8F33" stroke-width="0.9" transform="rotate(${rot} ${x} ${y})"/><line x1="${x - 3}" y1="${y + 1}" x2="${x + 3}" y2="${y - 1}" stroke="#5F8F33" stroke-width="0.7" transform="rotate(${rot} ${x} ${y})" opacity=".6"/>`;
      const sprout = [
        `<path d="M${cx} ${top} C${cx + 1} ${top - 5} ${cx + 3} ${top - 7} ${cx + 5.5} ${top - 9.5}" stroke="#44601F" stroke-width="2.2" fill="none" stroke-linecap="round"/>${leaf(cx + 8, top - 11, -28, '#9CC25B')}`,
        `<path d="M${cx} ${top} C${cx + 0.5} ${top - 6} ${cx + 1} ${top - 8} ${cx + 1} ${top - 11}" stroke="#44601F" stroke-width="2.2" fill="none" stroke-linecap="round"/>${leaf(cx - 4.5, top - 11.5, 30, '#9CC25B')}${leaf(cx + 6.5, top - 12.5, -26, '#7FAF45')}`,
        `<path d="M${cx} ${top} C${cx + 0.5} ${top - 6} ${cx + 1} ${top - 9} ${cx + 1} ${top - 12}" stroke="#44601F" stroke-width="2.2" fill="none" stroke-linecap="round"/>${leaf(cx - 5.5, top - 12, 32, '#9CC25B')}${leaf(cx + 7, top - 13, -26, '#7FAF45')}<circle cx="${cx + 0.8}" cy="${top - 14.5}" r="3" fill="#B5D87A" stroke="#7FAF45" stroke-width="0.9"/><circle cx="${cx + 0.8}" cy="${top - 14.5}" r="1.1" fill="#E8C44A"/>`,
      ][i];
      return {
        pre: `<ellipse cx="${cx}" cy="${bot + 4}" rx="${hb * 0.85}" ry="2.8" fill="#23291A" opacity=".08"/>${feet(cx, bot - 1, color, hb * 0.5, 1.6)}${stage !== 'grad' ? sprout : ''}`,
        body: mass(d, color) + `<ellipse cx="${cx}" cy="${bot - hb * 0.42}" rx="${hb * 0.55}" ry="${hb * 0.4}" fill="#FFFFFF" opacity=".5"/>`,
        post: eyesRound(exL, exR, ey, er, color, { happy: i === 2 }) + blush(exL, exR, ey, er) + (i === 0 ? smileTiny(cx, ey + er + 2.5, 3.4) : smileOpen(cx, ey + er + 2, [0, 3.6, 4.2][i])),
        face: { exL, exR, ey, er },
        anchors: { cx, cy: (top + bot) / 2 + 3, rx: hb, ry: (bot - top) / 2, capX: cx, capY: top - 4, acc: { neckX: cx, neckY: ey + er + 7.5, neckW: hb * 0.62, beltX: cx + hb * 0.42, beltY: bot - 7.5, sideX: cx + hb + 0.5, sideY: (top + bot) / 2 + 4, handX: cx + hb * 0.3, handY: bot - 2.5, headX: cx - 7, headY: top + 2, strapX: cx - hb * 0.55, strapY: top + 9 } },
      };
    },
  },

  Wisp: {
    trait: 'flame brightens',
    tilt: 3,
    egg(color: string): EggParts {
      const dk = shade(color, -28);
      return {
        floaty: true,
        art: `<ellipse cx="36" cy="63" rx="10" ry="2.4" fill="#23291A" opacity=".06"/>
        ${mass('M36 16 C47 16 50 30 50 41 C50 52 44 59 36 59 C28 59 22 52 22 41 C22 30 25 16 36 16 Z', '#F4F2FB', { sw: 1.6 })}
        <path d="M30 40 q3 -3 6 0 q3 3 6 0" stroke="${color}" stroke-width="1.4" fill="none" opacity=".5"/>
        <path d="M36 16 C34.5 11 37 8 35.5 4 C39 8 39.5 12 38 15.5" fill="${shade(color, 18)}" stroke="${dk}" stroke-width="0.9" opacity=".9"/>`,
      };
    },
    body(stage?: Stage, color = '#5B7C2E'): BodyParts {
      const i = STAGE_INDEX[i0(stage)];
      const rx = [12.5, 14.5, 16.5][i], cy = [42, 41, 40][i], cx = 36, ry = [13, 15, 16.5][i];
      const dk = shade(color, -32), top = cy - ry;
      // asymmetric hem: small scallop left, big mid, trailing curl right
      const hemY = cy + ry * 0.5;
      const hem = i === 0
        ? `C${cx - rx * 0.55} ${hemY + 4} ${cx - rx * 0.2} ${hemY - 1} ${cx} ${hemY + 2.5} C${cx + rx * 0.35} ${hemY + 5.5} ${cx + rx * 0.7} ${hemY - 0.5} ${cx + rx} ${hemY + 1} C${cx + rx + 3} ${hemY + 2} ${cx + rx + 3.5} ${hemY - 1} ${cx + rx + 2} ${hemY - 3}`
        : `C${cx - rx * 0.6} ${hemY + 5.5} ${cx - rx * 0.28} ${hemY - 1.5} ${cx - rx * 0.05} ${hemY + 3} C${cx + rx * 0.25} ${hemY + 7} ${cx + rx * 0.55} ${hemY - 1} ${cx + rx * 0.8} ${hemY + 2} C${cx + rx} ${hemY + 4.5} ${cx + rx + 4} ${hemY + 3} ${cx + rx + 5} ${hemY - 1} C${cx + rx + 5.5} ${hemY - 3.5} ${cx + rx + 3} ${hemY - 4} ${cx + rx + 1.5} ${hemY - 4.5}`;
      const full = `M${cx - rx} ${hemY - 1} C${cx - rx} ${top + 3} ${cx - rx * 0.62} ${top} ${cx} ${top} C${cx + rx * 0.62} ${top} ${cx + rx} ${top + 3} ${cx + rx} ${hemY - 2} ${hem} L${cx - rx} ${hemY - 1} Z`;
      const ey = cy - 4, er = [4.6, 5, 5.2][i], exL = cx - 6, exR = cx + 6;
      const flame = [
        `<path d="M${cx - 1} ${top + 1} C${cx - 3} ${top - 4} ${cx - 1.5} ${top - 6} ${cx - 3} ${top - 9.5} C${cx + 2} ${top - 6} ${cx + 2} ${top - 2.5} ${cx + 0.5} ${top}" fill="${shade(color, 22)}" stroke="${dk}" stroke-width="0.9"/>`,
        `<path d="M${cx - 1} ${top + 1} C${cx - 3.5} ${top - 5} ${cx - 1.5} ${top - 7} ${cx - 3.5} ${top - 12} C${cx + 2.5} ${top - 7.5} ${cx + 3} ${top - 3} ${cx + 1} ${top}" fill="${shade(color, 22)}" stroke="${dk}" stroke-width="0.9"/><path d="M${cx - 5.5} ${top + 1.5} C${cx - 7} ${top - 1.5} ${cx - 6} ${top - 3} ${cx - 7} ${top - 5.5} C${cx - 4} ${top - 3} ${cx - 4} ${top - 0.5} ${cx - 4.5} ${top + 1.5}" fill="${shade(color, 45)}"/>`,
        `<path d="M${cx - 1} ${top + 1} C${cx - 4} ${top - 6} ${cx - 1.5} ${top - 8} ${cx - 4} ${top - 14} C${cx + 3} ${top - 8.5} ${cx + 3.5} ${top - 3} ${cx + 1} ${top}" fill="${shade(color, 22)}" stroke="${dk}" stroke-width="0.9"/><path d="M${cx - 6} ${top + 1.5} C${cx - 7.5} ${top - 2} ${cx - 6.5} ${top - 4} ${cx - 7.5} ${top - 7} C${cx - 4.5} ${top - 4} ${cx - 4.5} ${top - 1} ${cx - 5} ${top + 1.5}" fill="${shade(color, 45)}"/><path d="M${cx + 4.5} ${top + 1.5} C${cx + 6} ${top - 1} ${cx + 5.5} ${top - 2.5} ${cx + 6.5} ${top - 4.5} C${cx + 4} ${top - 2.5} ${cx + 3.8} ${top - 0.5} ${cx + 4} ${top + 1.5}" fill="${shade(color, 45)}"/>`,
      ][i];
      const flameOut = i === 2 ? '' : flame;
      const arms = i >= 1
        ? `<path d="M${cx - rx + 1} ${cy - 2} C${cx - rx - 4.5} ${cy - 4.5} ${cx - rx - 6} ${cy - 6} ${cx - rx - 6.5} ${cy - 9}" stroke="${color}" stroke-width="4.4" fill="none" stroke-linecap="round"/><path d="M${cx - rx + 1} ${cy - 2} C${cx - rx - 4.5} ${cy - 4.5} ${cx - rx - 6} ${cy - 6} ${cx - rx - 6.5} ${cy - 9}" stroke="${dk}" stroke-width="0.9" fill="none" opacity=".4"/>
           <path d="M${cx + rx - 1} ${cy} C${cx + rx + 4} ${cy + 1.5} ${cx + rx + 5} ${cy + 3.5} ${cx + rx + 4.5} ${cy + 6.5}" stroke="${color}" stroke-width="4.4" fill="none" stroke-linecap="round"/>`
        : '';
      return {
        floaty: true,
        pre: `<ellipse cx="${cx}" cy="64" rx="${rx * 0.65}" ry="2.2" fill="#23291A" opacity=".06"/>
             ${i === 2 ? `<circle class="glowpulse" cx="${cx}" cy="${cy}" r="${rx + 9}" fill="${shade(color, 55)}"/>` : ''}`,
        body: mass(full, color, { shx: 3, shy: 4 }) + `<ellipse cx="${cx - 1}" cy="${cy + ry * 0.14}" rx="${rx * 0.46}" ry="${ry * 0.3}" fill="#fff" opacity=".4"/>`,
        post: flameOut + arms + eyesOval(exL, exR, ey, er, color) + blush(exL, exR, ey, er * 0.9) + smileTiny(cx, ey + er + 2, 2.8),
        face: { exL, exR, ey, er },
        anchors: { cx, cy, rx, ry, capX: cx, capY: top - 3, acc: { neckX: cx, neckY: cy + 2.5, neckW: rx * 0.6, beltX: cx + rx * 0.45, beltY: cy + ry * 0.32, sideX: cx - rx - 3, sideY: cy - 1, handX: cx + rx * 0.25, handY: cy + ry * 0.5, headX: cx - 7.5, headY: top + 1.5, strapX: cx - rx * 0.6, strapY: cy - ry * 0.5 } },
      };
    },
  },

  Capling: {
    trait: 'shell gains rings',
    tilt: 0,
    egg(color: string): EggParts {
      return {
        art: `<ellipse cx="36" cy="61" rx="16" ry="3" fill="#23291A" opacity=".08"/>
        ${mass('M36 18 C47 18 51 31 51 42 C51 53 44 60 36 60 C28 60 21 53 21 42 C21 31 25 18 36 18 Z', '#F2F6EC', { sw: 1.6 })}
        <path d="M27 38 l5 -4 l4 4 l4 -4 l5 4" stroke="${color}" stroke-width="1.6" fill="none" opacity=".55"/>
        <path d="M27 47 l5 -4 l4 4 l4 -4 l5 4" stroke="${color}" stroke-width="1.6" fill="none" opacity=".4"/>`,
      };
    },
    body(stage?: Stage, color = '#5B7C2E'): BodyParts {
      const i = STAGE_INDEX[i0(stage)];
      const dk = shade(color, -32), sh = shade(color, -10);
      const shellW = [15, 17, 19][i], shellH = [14, 17, 19][i];
      const scx = 40, base = 53, shTop = base - shellH - 6;
      const shellD = `M${scx - shellW} ${base} C${scx - shellW} ${shTop + 3} ${scx - shellW * 0.5} ${shTop} ${scx} ${shTop} C${scx + shellW * 0.5} ${shTop} ${scx + shellW} ${shTop + 3} ${scx + shellW} ${base} Z`;
      // head pokes out front-left
      const hx = 20.5, hy = 47, hw = 8.5, hh = 7.5;
      const headD = `M${hx - hw} ${hy} C${hx - hw} ${hy - hh} ${hx - hw * 0.3} ${hy - hh - 1.5} ${hx + 1} ${hy - hh - 1} C${hx + hw} ${hy - hh + 0.5} ${hx + hw + 1} ${hy - 2} ${hx + hw} ${hy + 2} C${hx + hw - 1} ${hy + hh - 2} ${hx - hw * 0.4} ${hy + hh - 1} ${hx - hw + 1} ${hy + 3} Z`;
      const ey = hy - 2.5, er = 3.4, exL = hx - 3.6, exR = hx + 3.6;
      const rim = `<path d="M${scx - shellW} ${base - 4.5} L${scx + shellW} ${base - 4.5}" stroke="${dk}" stroke-width="1.4" opacity=".55"/>`;
      const scutes = i >= 1 ? `<rect x="${scx - 9}" y="${shTop + 5}" width="7.5" height="6" rx="2" fill="${shade(color, -2)}" stroke="${dk}" stroke-width="0.9" opacity=".8"/><rect x="${scx + 1.5}" y="${shTop + 5}" width="7.5" height="6" rx="2" fill="${shade(color, -2)}" stroke="${dk}" stroke-width="0.9" opacity=".8"/><rect x="${scx - 3.8}" y="${shTop + 13}" width="7.5" height="6" rx="2" fill="${shade(color, -2)}" stroke="${dk}" stroke-width="0.9" opacity=".8"/>` : '';
      const ring1 = i >= 1 ? `<path d="M${scx - shellW * 0.72} ${base - 7} Q${scx} ${shTop + 8} ${scx + shellW * 0.72} ${base - 7}" stroke="${dk}" stroke-width="1.1" fill="none" opacity=".45"/>` : '';
      const ring2 = i >= 2 ? `<path d="M${scx - shellW * 0.45} ${base - 11} Q${scx} ${shTop + 4} ${scx + shellW * 0.45} ${base - 11}" stroke="${dk}" stroke-width="1" fill="none" opacity=".4"/>` : '';
      const tail = i >= 1 ? `<path d="M${scx + shellW - 1} ${base - 3} C${scx + shellW + 4.5} ${base - 3.5} ${scx + shellW + 5.5} ${base - 1} ${scx + shellW + 3.5} ${base + 1.5}" stroke="${color}" stroke-width="4" fill="none" stroke-linecap="round"/><path d="M${scx + shellW - 1} ${base - 3} C${scx + shellW + 4.5} ${base - 3.5} ${scx + shellW + 5.5} ${base - 1} ${scx + shellW + 3.5} ${base + 1.5}" stroke="${dk}" stroke-width="0.9" fill="none" opacity=".4"/>` : '';
      const leg = (x: number) => `<path d="M${x - 3.2} ${base} L${x - 3.6} ${base + 6} C${x - 3.6} ${base + 7.5} ${x + 3.6} ${base + 7.5} ${x + 3.6} ${base + 6} L${x + 3.2} ${base} Z" fill="${shade(color, -8)}" stroke="${dk}" stroke-width="1.1"/>`;
      return {
        pre: `<ellipse cx="${scx - 2}" cy="${base + 8.5}" rx="${shellW + 4}" ry="2.8" fill="#23291A" opacity=".08"/>${leg(scx - shellW * 0.55)}${leg(scx + shellW * 0.55)}${tail}`,
        body: mass(headD, color, { sw: 1.8, shx: 2, shy: 3 }) + mass(shellD, sh, { shx: 3.5, shy: 4 }) + rim + scutes + ring1 + ring2,
        post: eyesRound(exL, exR, ey, er, color, { lidPct: 0 }) +
          `<path d="M${exL - er - 0.5} ${ey - er - 1} q${er * 0.8} -1.4 ${er * 1.7} -0.4 M${exR - er - 0.5} ${ey - er - 1.2} q${er * 0.8} -1.2 ${er * 1.7} -0.2" stroke="${dk}" stroke-width="1" fill="none" opacity=".5"/>` +
          blush(exL, exR, ey, er * 0.9) + smileTiny(hx, ey + er + 2.4, 2.6),
        face: { exL, exR, ey, er },
        anchors: { cx: scx - 4, cy: 46, rx: shellW, ry: 12, capX: hx, capY: hy - 9.5, capRot: -14, capS: 0.7, acc: { neckX: hx + 1.5, neckY: hy + 4.5, neckW: 6.5, beltX: scx - shellW * 0.45, beltY: base - 5.5, sideX: hx - hw - 2.5, sideY: hy - 2, handX: hx + 1, handY: hy + hh + 2, headX: hx - 4, headY: hy - hh - 1, strapX: scx - shellW * 0.7, strapY: shTop + 6 } },
      };
    },
  },

  Longear: {
    trait: 'ears rise & perk',
    tilt: 2,
    egg(color: string): EggParts {
      const dk = shade(color, -28);
      return {
        art: `<ellipse cx="36" cy="62" rx="14" ry="2.8" fill="#23291A" opacity=".08"/>
        <ellipse cx="29.5" cy="13.5" rx="3" ry="6" fill="${color}" stroke="${dk}" stroke-width="1" transform="rotate(-16 29.5 13.5)"/>
        <ellipse cx="42" cy="14.5" rx="3" ry="5.4" fill="${color}" stroke="${dk}" stroke-width="1" transform="rotate(22 42 14.5)"/>
        ${mass('M36 16 C47 16 51 30 51 42 C51 53 44 60 36 60 C28 60 21 53 21 42 C21 30 25 16 36 16 Z', '#F7F1EA', { sw: 1.6 })}
        <circle cx="31" cy="36" r="2.1" fill="${color}" opacity=".45"/><circle cx="41" cy="45" r="2.5" fill="${color}" opacity=".45"/>`,
      };
    },
    body(stage?: Stage, color = '#5B7C2E'): BodyParts {
      const i = STAGE_INDEX[i0(stage)];
      const h = [11.5, 13, 14.5][i], top = [33, 31.5, 30][i], bot = [58, 58.5, 59][i];
      const dk = shade(color, -32), cx = 36, inner = shade(color, 42);
      const d = bean(cx, top, bot, h, 1.5);
      const ey = top + 11, er = [4.4, 4.7, 5][i], exL = cx - 5.8, exR = cx + 5.8;
      // ears: always asymmetric; left grows upright, right starts flopped and rises
      const earUp = (x: number, len: number, ang: number, bend: number) => {
        const tipx = x + Math.sin((ang * Math.PI) / 180) * len, tipy = top - Math.cos((ang * Math.PI) / 180) * len;
        return `<path d="M${x - 3.4} ${top + 2} C${x - 4.2} ${top - len * 0.55} ${tipx - 3 + bend} ${tipy + 3} ${tipx + bend} ${tipy} C${tipx + 3 + bend} ${tipy + 3} ${x + 4.2} ${top - len * 0.55} ${x + 3.4} ${top + 2} Z" fill="${color}" stroke="${dk}" stroke-width="1.6" stroke-linejoin="round"/>
        <path d="M${x - 1.4} ${top} C${x - 1.8} ${top - len * 0.5} ${tipx - 1 + bend * 0.8} ${tipy + 4.5} ${tipx + bend * 0.8} ${tipy + 3.5} C${tipx + 1 + bend * 0.8} ${tipy + 4.5} ${x + 1.8} ${top - len * 0.5} ${x + 1.4} ${top} Z" fill="${inner}" opacity=".9"/>`;
      };
      const earFlop = (x: number) => `<path d="M${x - 3.2} ${top + 2} C${x - 4} ${top - 7} ${x + 2} ${top - 10} ${x + 7} ${top - 8} C${x + 11} ${top - 6.5} ${x + 12} ${top - 2} ${x + 10.5} ${top + 1} C${x + 8} ${top - 3} ${x + 3} ${top - 4.5} ${x + 2.6} ${top + 2.5} Z" fill="${color}" stroke="${dk}" stroke-width="1.6" stroke-linejoin="round"/>`;
      const ears = [
        earUp(cx - 5.5, 15, -10, 0) + earFlop(cx + 3.5),
        earUp(cx - 5.5, 18, -9, 0) + earUp(cx + 5.5, 14, 16, 2),
        earUp(cx - 5.5, 20, -7, 0) + earUp(cx + 5.5, 19, 13, 1.5),
      ][i];
      const fluff = `<path d="M${cx - 4.5} ${bot - 13} l1.6 1.8 l1.8 -1.8 l1.8 1.8 l1.8 -1.8" stroke="${shade(color, -12)}" stroke-width="1" fill="none" opacity=".45"/>`;
      const tail = `<circle cx="${cx - h - 1.5}" cy="${bot - 9}" r="3.4" fill="${shade(color, 20)}" stroke="${dk}" stroke-width="1.2"/>`;
      const nose = `<path d="M${cx - 1.6} ${ey + er + 1.4} L${cx + 1.6} ${ey + er + 1.4} L${cx} ${ey + er + 3.4} Z" fill="#B0766E"/>
        <path d="M${cx} ${ey + er + 3.4} L${cx} ${ey + er + 4.6} M${cx} ${ey + er + 4.6} q-2 1.6 -3.6 0.6 M${cx} ${ey + er + 4.6} q2 1.6 3.6 0.6" stroke="#23291A" stroke-width="1.3" fill="none" stroke-linecap="round"/>
        <circle cx="${cx - 7.5}" cy="${ey + er + 2.5}" r=".55" fill="${dk}" opacity=".5"/><circle cx="${cx - 9}" cy="${ey + er + 4}" r=".55" fill="${dk}" opacity=".5"/>
        <circle cx="${cx + 7.5}" cy="${ey + er + 2.5}" r=".55" fill="${dk}" opacity=".5"/><circle cx="${cx + 9}" cy="${ey + er + 4}" r=".55" fill="${dk}" opacity=".5"/>`;
      return {
        pre: `<ellipse cx="${cx}" cy="${bot + 4}" rx="${h * 0.95}" ry="2.8" fill="#23291A" opacity=".08"/>${tail}${feet(cx, bot - 1, color, h * 0.52, 2)}${ears}`,
        body: mass(d, color) + `<ellipse cx="${cx}" cy="${bot - 9}" rx="${h * 0.55}" ry="${h * 0.6}" fill="#FFF" opacity=".5"/>${fluff}`,
        post: eyesOval(exL, exR, ey, er, color, 1.22) + blush(exL, exR, ey, er) + nose,
        face: { exL, exR, ey, er },
        anchors: { cx, cy: (top + bot) / 2 + 2, rx: h, ry: (bot - top) / 2, capX: cx - 1, capY: top - 5, capS: 0.92, acc: { neckX: cx, neckY: ey + er + 8, neckW: h * 0.58, beltX: cx + h * 0.42, beltY: bot - 7, sideX: cx + h + 1, sideY: (top + bot) / 2 + 2, handX: cx + h * 0.3, handY: bot - 3, headX: cx - 7, headY: top + 1, strapX: cx - h * 0.55, strapY: top + 8 } },
      };
    },
  },

  Puff: {
    trait: 'wings fledge',
    tilt: -3,
    egg(color: string): EggParts {
      return {
        art: `<ellipse cx="36" cy="62" rx="14" ry="2.8" fill="#23291A" opacity=".08"/>
        ${mass('M36 15 C47 15 51 29 51 41 C51 53 44 60 36 60 C28 60 21 53 21 41 C21 29 25 15 36 15 Z', '#FDF4EC', { sw: 1.6 })}
        <path d="M36 15 C35 11 36 9 34 6 M36 15 C37 11 38.5 9 40.5 7" stroke="${color}" stroke-width="1.6" fill="none" stroke-linecap="round"/>
        <circle cx="30" cy="36" r="2.1" fill="${color}" opacity=".45"/><circle cx="42" cy="44" r="2.4" fill="${color}" opacity=".45"/>`,
      };
    },
    body(stage?: Stage, color = '#5B7C2E'): BodyParts {
      const i = STAGE_INDEX[i0(stage)];
      const r = [13, 14.5, 16][i], cy = [45, 44, 43][i], cx = 36;
      const dk = shade(color, -32), top = cy - r, lt = shade(color, 30);
      // round body with cheek-fluff bumps breaking the outline
      const d = `M${cx} ${top} C${cx - r * 0.62} ${top} ${cx - r} ${cy - r * 0.55} ${cx - r} ${cy - 2}
        C${cx - r - 2.2} ${cy - 0.5} ${cx - r - 2.2} ${cy + 2} ${cx - r} ${cy + 3}
        C${cx - r - 1.8} ${cy + 4.5} ${cx - r - 1.5} ${cy + 6.5} ${cx - r + 1} ${cy + 7.5}
        C${cx - r + 2} ${cy + r * 0.92} ${cx - r * 0.5} ${cy + r} ${cx} ${cy + r}
        C${cx + r * 0.5} ${cy + r} ${cx + r - 2} ${cy + r * 0.92} ${cx + r - 1} ${cy + 7.5}
        C${cx + r + 1.5} ${cy + 6.5} ${cx + r + 1.8} ${cy + 4.5} ${cx + r} ${cy + 3}
        C${cx + r + 2.2} ${cy + 2} ${cx + r + 2.2} ${cy - 0.5} ${cx + r} ${cy - 2}
        C${cx + r} ${cy - r * 0.55} ${cx + r * 0.62} ${top} ${cx} ${top} Z`;
      const ey = cy - 4, er = [4.4, 4.7, 5][i], exL = cx - 5.6, exR = cx + 5.6;
      const crest = [
        `<path d="M${cx - 1} ${top + 1} C${cx - 2} ${top - 4} ${cx - 0.5} ${top - 5.5} ${cx - 2.5} ${top - 8.5}" stroke="${dk}" stroke-width="1.6" fill="none" stroke-linecap="round"/><circle cx="${cx - 2.7}" cy="${top - 9}" r="1.7" fill="${lt}" stroke="${dk}" stroke-width="0.8"/>`,
        `<path d="M${cx - 2} ${top + 1} C${cx - 3} ${top - 4.5} ${cx - 1.5} ${top - 6} ${cx - 3.8} ${top - 9.5}" stroke="${dk}" stroke-width="1.6" fill="none" stroke-linecap="round"/><circle cx="${cx - 4}" cy="${top - 10}" r="1.7" fill="${lt}" stroke="${dk}" stroke-width="0.8"/><path d="M${cx + 1.5} ${top + 0.5} C${cx + 1.5} ${top - 3.5} ${cx + 3} ${top - 4.5} ${cx + 2.5} ${top - 7.5}" stroke="${dk}" stroke-width="1.4" fill="none" stroke-linecap="round"/><circle cx="${cx + 2.5}" cy="${top - 8}" r="1.4" fill="${lt}" stroke="${dk}" stroke-width="0.8"/>`,
        `<path d="M${cx - 2.5} ${top + 1} C${cx - 3.5} ${top - 5} ${cx - 2} ${top - 6.5} ${cx - 4.5} ${top - 10}" stroke="${dk}" stroke-width="1.6" fill="none" stroke-linecap="round"/><circle cx="${cx - 4.7}" cy="${top - 10.5}" r="1.7" fill="${lt}" stroke="${dk}" stroke-width="0.8"/><path d="M${cx + 1} ${top + 0.5} C${cx + 1} ${top - 4.5} ${cx + 2.5} ${top - 5.5} ${cx + 2} ${top - 9}" stroke="${dk}" stroke-width="1.5" fill="none" stroke-linecap="round"/><circle cx="${cx + 2}" cy="${top - 9.5}" r="1.5" fill="${lt}" stroke="${dk}" stroke-width="0.8"/><path d="M${cx + 4.5} ${top + 1.5} C${cx + 5.5} ${top - 2} ${cx + 7} ${top - 3} ${cx + 7.5} ${top - 5.5}" stroke="${dk}" stroke-width="1.3" fill="none" stroke-linecap="round"/><circle cx="${cx + 7.7}" cy="${top - 6}" r="1.3" fill="${lt}" stroke="${dk}" stroke-width="0.8"/>`,
      ][i];
      const wing = (s: number) => {
        const wx = cx + s * (r - 2), wy = cy + 1;
        if (i === 0) return `<path d="M${wx} ${wy - 6} C${wx + 5.5 * s} ${wy - 5} ${wx + 6 * s} ${wy + 2} ${wx + 2.5 * s} ${wy + 6} C${wx - 0.5 * s} ${wy + 4} ${wx - 1 * s} ${wy - 2} ${wx} ${wy - 6} Z" fill="${shade(color, -8)}" stroke="${dk}" stroke-width="1.3"/>`;
        if (i === 1) return `<path d="M${wx} ${wy - 8} C${wx + 8 * s} ${wy - 7} ${wx + 9 * s} ${wy + 2} ${wx + 4 * s} ${wy + 8} C${wx + 0.5 * s} ${wy + 6} ${wx - 1 * s} ${wy - 2} ${wx} ${wy - 8} Z" fill="${shade(color, -8)}" stroke="${dk}" stroke-width="1.3"/><path d="M${wx + 2 * s} ${wy - 2} C${wx + 5 * s} ${wy - 1} ${wx + 5.5 * s} ${wy + 2} ${wx + 4 * s} ${wy + 5} M${wx + 1 * s} ${wy + 1.5} C${wx + 3 * s} ${wy + 2.5} ${wx + 3.4 * s} ${wy + 4.5} ${wx + 2.6 * s} ${wy + 6.5}" stroke="${dk}" stroke-width="0.9" fill="none" opacity=".55"/>`;
        return `<path d="M${wx} ${wy - 9} C${wx + 11 * s} ${wy - 10} ${wx + 13 * s} ${wy - 1} ${wx + 9 * s} ${wy + 5} C${wx + 11 * s} ${wy + 5.5} ${wx + 11.5 * s} ${wy + 8} ${wx + 8 * s} ${wy + 9.5} C${wx + 4 * s} ${wy + 10} ${wx + 0.5 * s} ${wy + 5} ${wx} ${wy - 9} Z" fill="${shade(color, -8)}" stroke="${dk}" stroke-width="1.3"/><path d="M${wx + 3 * s} ${wy - 3} C${wx + 7 * s} ${wy - 3} ${wx + 8 * s} ${wy + 1} ${wx + 6.5 * s} ${wy + 5} M${wx + 2 * s} ${wy + 1} C${wx + 4.5 * s} ${wy + 1.5} ${wx + 5 * s} ${wy + 4} ${wx + 4 * s} ${wy + 7.5}" stroke="${dk}" stroke-width="0.9" fill="none" opacity=".55"/>`;
      };
      const tail = `<g transform="rotate(8 ${cx - r} ${cy + 4})">
        <path d="M${cx - r + 1} ${cy + 3} C${cx - r - 6} ${cy} ${cx - r - 8} ${cy + 1} ${cx - r - 9.5} ${cy + 3.5} L${cx - r + 0.5} ${cy + 5.5} Z" fill="${shade(color, -6)}" stroke="${dk}" stroke-width="1.1"/>
        <path d="M${cx - r + 1} ${cy + 5} C${cx - r - 6.5} ${cy + 4} ${cx - r - 8.5} ${cy + 5.5} ${cx - r - 9} ${cy + 8} L${cx - r + 0.5} ${cy + 7.5} Z" fill="${shade(color, 4)}" stroke="${dk}" stroke-width="1.1"/></g>`;
      const beak = `<path d="M${cx - 3.2} ${ey + er + 0.8} L${cx + 3.2} ${ey + er + 0.8} L${cx} ${ey + er + 4.2} Z" fill="#E8A33D" stroke="#B97F1B" stroke-width="1"/>
        <path d="M${cx - 1.8} ${ey + er + 4} L${cx + 1.8} ${ey + er + 4} L${cx} ${ey + er + 5.8} Z" fill="#D9952F" stroke="#B97F1B" stroke-width="0.8"/>`;
      const bellyFluff = `<path d="M${cx - 6.5} ${cy + 5} l1.5 1.6 l1.7 -1.6 l1.7 1.6 l1.6 -1.6 l1.7 1.6 l1.5 -1.6 C${cx + 7.5} ${cy + r * 0.8} ${cx - 7} ${cy + r * 0.8} ${cx - 6.5} ${cy + 5} Z" fill="#FFF" opacity=".55"/>`;
      const birdFeet = (x: number, dy: number) => `<path d="M${x} ${cy + r - 1} L${x} ${cy + r + 4 + dy} M${x - 3} ${cy + r + 4 + dy} L${x} ${cy + r + 2.5 + dy} M${x + 3} ${cy + r + 4 + dy} L${x} ${cy + r + 2.5 + dy} M${x} ${cy + r + 4 + dy} L${x} ${cy + r + 5.5 + dy}" stroke="#C9871F" stroke-width="1.6" fill="none" stroke-linecap="round"/>`;
      return {
        pre: `<ellipse cx="${cx}" cy="${cy + r + 6}" rx="${r * 0.8}" ry="2.6" fill="#23291A" opacity=".08"/>${tail}${birdFeet(cx - 4.5, 1)}${birdFeet(cx + 4.5, 0)}`,
        body: mass(d, color) + bellyFluff + wing(-1) + wing(1),
        post: (i === 2 ? '' : crest) + eyesBead(exL, exR, ey, er, color) + blush(exL, exR, ey, er * 0.95) + beak,
        face: { exL, exR, ey, er },
        anchors: { cx, cy, rx: r, ry: r, capX: cx, capY: top - 2, acc: { neckX: cx, neckY: ey + er + 6.5, neckW: r * 0.55, beltX: cx - 2, beltY: cy + r * 0.55, sideX: cx + r + 4, sideY: cy - 3, handX: cx, handY: cy + r - 3, headX: cx + 6, headY: top, strapX: cx - r * 0.6, strapY: cy - r * 0.55 } },
      };
    },
  },

  Glim: {
    trait: 'glow awakens',
    tilt: 2,
    egg(color: string): EggParts {
      const dk = shade(color, -28);
      return {
        art: `<ellipse cx="36" cy="62" rx="13" ry="2.6" fill="#23291A" opacity=".07"/>
        <path d="M31.5 14 C30 11.5 29.3 10 29 8 M40.5 14 C42 11.5 42.7 10 43 8.5" stroke="${dk}" stroke-width="1.2" fill="none" stroke-linecap="round"/>
        <circle cx="28.8" cy="7.2" r="1.7" fill="${shade(color, 42)}" stroke="${dk}" stroke-width="0.7"/><circle cx="43.2" cy="7.7" r="1.5" fill="${shade(color, 42)}" stroke="${dk}" stroke-width="0.7"/>
        ${mass('M36 14 C47 14 51 29 51 41 C51 53 44 60 36 60 C28 60 21 53 21 41 C21 29 25 14 36 14 Z', '#F1F5F8', { sw: 1.6 })}
        <circle cx="36" cy="42" r="5.5" fill="${shade(color, 52)}" opacity=".6"/>`,
      };
    },
    body(stage?: Stage, color = '#5B7C2E'): BodyParts {
      const i = STAGE_INDEX[i0(stage)];
      const dk = shade(color, -32);
      const hr = [10, 11, 12][i], hx = 33, hy = [37, 36, 35][i]; // head
      const ar = [8, 9, 10][i], ax = 42.5, ay = hy + 13.5; // abdomen
      const headD = `M${hx} ${hy - hr} C${hx - hr * 0.62} ${hy - hr} ${hx - hr} ${hy - hr * 0.5} ${hx - hr} ${hy} C${hx - hr} ${hy + hr * 0.6} ${hx - hr * 0.55} ${hy + hr} ${hx} ${hy + hr} C${hx + hr * 0.55} ${hy + hr} ${hx + hr} ${hy + hr * 0.6} ${hx + hr} ${hy} C${hx + hr} ${hy - hr * 0.5} ${hx + hr * 0.62} ${hy - hr} ${hx} ${hy - hr} Z`;
      const abdD = `M${ax - ar * 0.8} ${ay - ar * 0.9} C${ax + ar * 0.4} ${ay - ar * 1.25} ${ax + ar + 1.5} ${ay - ar * 0.3} ${ax + ar} ${ay + ar * 0.45} C${ax + ar - 1} ${ay + ar * 1.05} ${ax - ar * 0.1} ${ay + ar * 1.2} ${ax - ar * 0.7} ${ay + ar * 0.65} C${ax - ar * 1.15} ${ay + ar * 0.15} ${ax - ar * 1.1} ${ay - ar * 0.45} ${ax - ar * 0.8} ${ay - ar * 0.9} Z`;
      const glowTipX = ax + ar * 0.65, glowTipY = ay + ar * 0.75;
      const ey = hy - 1, er = [4.4, 4.7, 5][i], exL = hx - 4.8, exR = hx + 4.8;
      const top = hy - hr;
      const ant = (x1: number, curve: number, len: number, tipR: number, glow: boolean) =>
        `<path d="M${x1} ${top + 2} C${x1 + curve * 0.4} ${top - len * 0.45} ${x1 + curve} ${top - len * 0.75} ${x1 + curve * 0.7} ${top - len}" stroke="${dk}" stroke-width="1.4" fill="none" stroke-linecap="round"/>
        <circle cx="${x1 + curve * 0.7}" cy="${top - len - 1}" r="${tipR}" fill="${shade(color, 50)}" stroke="${dk}" stroke-width="0.7"/>
        ${glow ? `<circle class="glowpulse" cx="${x1 + curve * 0.7}" cy="${top - len - 1}" r="${tipR + 3.2}" fill="${shade(color, 55)}"/>` : ''}`;
      const ants = [
        ant(hx + 2, -4, 10, 1.9, false),
        ant(hx - 3, -5, 12, 2.1, false) + ant(hx + 4, 4.5, 9, 1.8, false),
        '',
      ][i];
      const wings = i === 0
        ? `<ellipse cx="${hx + hr + 2}" cy="${hy - 3}" rx="3.2" ry="5.5" fill="#fff" opacity=".55" stroke="${dk}" stroke-width="0.8" transform="rotate(28 ${hx + hr + 2} ${hy - 3})"/>`
        : `<g transform="rotate(${24 + i * 4} ${ax - 2} ${ay - ar})">
             <ellipse cx="${ax - 2}" cy="${ay - ar - 6}" rx="${4 + i}" ry="${8.5 + i * 2}" fill="#fff" opacity=".55" stroke="${dk}" stroke-width="0.9"/>
             <line x1="${ax - 2}" y1="${ay - ar - 1}" x2="${ax - 2}" y2="${ay - ar - 12 - i * 2}" stroke="${dk}" stroke-width="0.7" opacity=".4"/>
           </g>
           <g transform="rotate(${40 + i * 4} ${ax + 1} ${ay - ar})">
             <ellipse cx="${ax + 1}" cy="${ay - ar - 5}" rx="${3.2 + i}" ry="${7 + i * 1.6}" fill="#fff" opacity=".4" stroke="${dk}" stroke-width="0.8"/>
           </g>`;
      const armL = `<path d="M${hx - hr + 1} ${hy + 4} C${hx - hr - 3} ${hy + 6} ${hx - hr - 3.5} ${hy + 8} ${hx - hr - 3} ${hy + 10}" stroke="${color}" stroke-width="3.6" fill="none" stroke-linecap="round"/>`;
      return {
        pre: `<ellipse cx="36" cy="63" rx="11" ry="2.4" fill="#23291A" opacity=".08"/>
             ${i === 2 ? `<circle class="glowpulse" cx="${glowTipX}" cy="${glowTipY}" r="${ar * 0.9}" fill="${shade(color, 55)}"/>` : ''}
             ${feet(34, 58, color, 5, 1.5)}
             ${wings}
             ${mass(abdD, shade(color, -6), { shx: 2.5, shy: 3 })}
             <circle cx="${glowTipX}" cy="${glowTipY}" r="${ar * 0.42}" fill="${shade(color, 52)}" opacity=".9"/>
             <path d="M${ax - ar * 0.5} ${ay - ar * 0.35} C${ax} ${ay - ar * 0.05} ${ax + ar * 0.3} ${ay + ar * 0.15} ${ax + ar * 0.55} ${ay + ar * 0.5}" stroke="${dk}" stroke-width="0.9" fill="none" opacity=".35"/>`,
        body: mass(headD, color, { shx: 2.5, shy: 3 }) + armL,
        post: ants + eyesRound(exL, exR, ey, er, color, {}) + `<circle cx="${exL - er * 0.25}" cy="${ey - er * 0.3}" r="${er * 0.14}" fill="#fff" opacity=".9"/><circle cx="${exR - er * 0.25}" cy="${ey - er * 0.3}" r="${er * 0.14}" fill="#fff" opacity=".9"/>` + blush(exL, exR, ey, er * 0.9) + smileTiny(hx, ey + er + 2, 2.6),
        face: { exL, exR, ey, er },
        anchors: { cx: hx, cy: hy + 6, rx: hr + 3, ry: hr + 8, capX: hx, capY: top - 3, capS: 0.85, acc: { neckX: hx, neckY: hy + hr - 0.5, neckW: hr * 0.62, beltX: hx + 5, beltY: hy + hr + 5, sideX: hx - hr - 3.5, sideY: hy + 3, handX: hx - 1, handY: hy + hr + 7, headX: hx - 6.5, headY: hy - hr + 1, strapX: hx - hr * 0.7, strapY: hy - 2 } },
      };
    },
  },

  Keeper: {
    trait: 'canonical — one form',
    tilt: 1.5,
    canonical: true,
    egg(): BodyParts {
      return this.body();
    },
    body(): BodyParts {
      const color = '#5B7C2E', dk = shade(color, -32), cx = 34;
      const top = 20, bot = 60, d = pear(cx, top, bot, 10.5, 18);
      const ey = top + 13.5, er = 4.9, exL = cx - 6.2, exR = cx + 6.2;
      // leaf mantle collar
      const mantleLeaf = (x: number, y: number, rot: number, fill: string) =>
        `<path d="M${x} ${y} C${x - 3.5} ${y + 1.5} ${x - 4} ${y + 6} ${x} ${y + 8.5} C${x + 4} ${y + 6} ${x + 3.5} ${y + 1.5} ${x} ${y} Z" fill="${fill}" stroke="#44601F" stroke-width="1" transform="rotate(${rot} ${x} ${y + 4})"/>`;
      const mantle = mantleLeaf(cx - 13, 33, 28, '#7FAF45') + mantleLeaf(cx - 7, 35.5, 12, '#9CC25B') + mantleLeaf(cx, 36.5, 0, '#7FAF45') + mantleLeaf(cx + 7, 35.5, -12, '#9CC25B') + mantleLeaf(cx + 13, 33, -28, '#7FAF45');
      // head branch: stem + two leaves + honey bloom
      const branch = `<path d="M${cx + 1} ${top} C${cx + 1.5} ${top - 5} ${cx + 3} ${top - 7} ${cx + 3} ${top - 10}" stroke="#44601F" stroke-width="2.2" fill="none" stroke-linecap="round"/>
        <ellipse cx="${cx - 2.5}" cy="${top - 9}" rx="4.2" ry="2.4" fill="#9CC25B" stroke="#5F8F33" stroke-width="0.9" transform="rotate(28 ${cx - 2.5} ${top - 9})"/>
        <ellipse cx="${cx + 8}" cy="${top - 10.5}" rx="3.8" ry="2.2" fill="#7FAF45" stroke="#5F8F33" stroke-width="0.9" transform="rotate(-24 ${cx + 8} ${top - 10.5})"/>
        <circle cx="${cx + 3.2}" cy="${top - 12.5}" r="2.6" fill="#E8C44A" stroke="#B98F1F" stroke-width="0.9"/>`;
      // moss chin tuft
      const tuft = `<path d="M${cx - 4.5} ${ey + er + 6.5} C${cx - 5.5} ${ey + er + 10} ${cx - 2} ${ey + er + 11.5} ${cx} ${ey + er + 10} C${cx + 2} ${ey + er + 11.5} ${cx + 5.5} ${ey + er + 10} ${cx + 4.5} ${ey + er + 6.5}" fill="#7FAF45" stroke="#5F8F33" stroke-width="1" opacity=".95"/>`;
      // staff + lantern (right side)
      const staff = `<path d="M${cx + 22} ${bot + 1} C${cx + 22.5} ${48} ${cx + 22} ${34} ${cx + 23} ${24} C${cx + 23.3} ${20.5} ${cx + 26.5} ${19} ${cx + 28.5} ${21}" stroke="#7A5230" stroke-width="2.6" fill="none" stroke-linecap="round"/>
        <path d="M${cx + 22} ${bot + 1} C${cx + 22.5} ${48} ${cx + 22} ${34} ${cx + 23} ${24}" stroke="#5C3D22" stroke-width="0.9" fill="none" opacity=".5"/>
        <line x1="${cx + 28.5}" y1="21" x2="${cx + 28.5}" y2="25" stroke="#5C3D22" stroke-width="1.4"/>
        <circle class="glowpulse" cx="${cx + 28.5}" cy="31" r="9" fill="#E8C44A"/>
        <rect x="${cx + 24.5}" y="25.5" width="8" height="10.5" rx="2.4" fill="#FBF6E6" stroke="#8A5F0C" stroke-width="1.4"/>
        <line x1="${cx + 28.5}" y1="25.5" x2="${cx + 28.5}" y2="36" stroke="#8A5F0C" stroke-width="0.9" opacity=".5"/>
        <circle cx="${cx + 28.5}" cy="30.8" r="2.3" fill="#E8C44A"/>
        <rect x="${cx + 26}" y="24" width="5" height="2" rx="1" fill="#8A5F0C"/>`;
      // arm holding staff
      const arm = `<path d="M${cx + 15} ${44} C${cx + 19} ${44.5} ${cx + 20.5} ${46} ${cx + 21.5} ${48.5}" stroke="${color}" stroke-width="5" fill="none" stroke-linecap="round"/>
        <path d="M${cx + 15} ${44} C${cx + 19} ${44.5} ${cx + 20.5} ${46} ${cx + 21.5} ${48.5}" stroke="${dk}" stroke-width="1" fill="none" opacity=".4"/>`;
      // satchel with seed-star (bespoke body art — not an accessory)
      const satchel = `<path d="M${cx - 15} ${38} L${cx + 8} ${54}" stroke="#7A5230" stroke-width="2.6" stroke-linecap="round" opacity=".95"/>
        <rect x="${cx + 2}" y="50" width="12.5" height="9.5" rx="2.6" fill="#8B5E33" stroke="#6B4624" stroke-width="1.1"/>
        <rect x="${cx + 2}" y="50" width="12.5" height="3.6" rx="1.7" fill="#A9763F"/>
        <path d="M${cx + 8.2} ${54.4} l0.9 2.2 2.3 0.3 -1.7 1.6 0.4 2.3 -1.9 -1.2 -1.9 1.2 0.4 -2.3 -1.7 -1.6 2.3 -0.3 Z" fill="#E8C44A"/>`;
      // gentle elder eyes: heavier upper lid + small brows
      const brows = `<path d="M${exL - er} ${ey - er - 2.6} q${er} -2 ${er * 2} -0.6 M${exR - er} ${ey - er - 3} q${er} -1.6 ${er * 2} -0.2" stroke="#7FAF45" stroke-width="2" fill="none" stroke-linecap="round" opacity=".95"/>`;
      return {
        pre: `<ellipse cx="${cx + 2}" cy="${bot + 4.5}" rx="20" ry="3" fill="#23291A" opacity=".09"/>${feet(cx, bot - 1, color, 9, 1.8)}${branch}${staff}`,
        body: mass(d, color) + `<ellipse cx="${cx}" cy="${bot - 12}" rx="9.5" ry="9" fill="#FFF" opacity=".45"/>` + mantle,
        post: arm + satchel + brows + eyesRound(exL, exR, ey, er, '#5B7C2E', { lidPct: 0, happy: true }) + blush(exL, exR, ey, er) + smileTiny(cx, ey + er + 3, 3.6) + tuft,
        face: { exL, exR, ey, er },
        anchors: { cx, cy: 44, rx: 18, ry: 20, capX: cx, capY: top - 7 },
      };
    },
  },
};

export const SPECIES_NAMES = Object.keys(SPECIES) as SpeciesName[];
export const USER_SPECIES = SPECIES_NAMES.filter((s) => !SPECIES[s].canonical);
