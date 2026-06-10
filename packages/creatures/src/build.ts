import { nextUid } from './mass';
import { SPECIES } from './species';
import { gradCap, marking, accessory } from './layers';
import type { BodyParts, BuildOptions, EggParts } from './types';

/**
 * Render a creature as a single self-contained `<svg>` element string.
 * Animation classes (cr / eggy / floaty / lid / tassel / glowpulse) are
 * styled by `creatureCss` — include it once per surface.
 *
 * The Keeper is canonical: stage, color, acc, and mark are ignored by
 * construction — passing them must not change the render.
 */
export function buildCreature(o: BuildOptions): string {
  const sp = SPECIES[o.species];
  const size = o.size ?? 120;
  if (!sp) throw new Error(`Unknown species: ${String(o.species)}`);
  if (sp.canonical) {
    const b = sp.body();
    b.anchors.face = b.face;
    const parts = `<g transform="rotate(${sp.tilt} 36 44)">` + [b.pre, b.body, b.post].join('') + `</g>`;
    return `<svg class="cr" style="animation-delay:${(nextUid() % 6) * 0.35}s" width="${size}" height="${size}" viewBox="0 0 72 72" role="img" aria-label="Grovekeeper">${parts}</svg>`;
  }
  const color = o.color ?? '#5B7C2E';
  if (o.stage === 'egg') {
    const e = sp.egg(color) as EggParts;
    return `<svg class="cr eggy" width="${size}" height="${size}" viewBox="0 0 72 72" role="img" aria-label="${o.species} egg">${e.art}</svg>`;
  }
  const b: BodyParts = sp.body(o.stage, color);
  b.anchors.face = b.face;
  const inner = [
    b.pre,
    b.body,
    marking(o.mark ?? 'none', b.anchors, color),
    b.post,
    o.stage === 'grad' ? gradCap(b.anchors.capX, b.anchors.capY, b.anchors.capRot ?? -8, o.species === 'Sprout' ? 'bloom' : '', b.anchors.capS ?? 1) : '',
    accessory(o.acc ?? 'none', b.anchors),
  ].join('');
  const parts = `<g transform="rotate(${sp.tilt || 0} 36 44)">${inner}</g>`;
  const cls = b.floaty ? 'cr floaty' : 'cr';
  return `<svg class="${cls}" style="animation-delay:${(nextUid() % 6) * 0.35}s" width="${size}" height="${size}" viewBox="0 0 72 72" role="img" aria-label="${o.species}">${parts}</svg>`;
}
