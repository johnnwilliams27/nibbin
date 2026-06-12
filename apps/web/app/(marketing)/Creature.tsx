import { buildCreature, type Accessory, type Marking, type SpeciesName, type Stage } from '@nibbin/creatures';

/**
 * Server-rendered creature from the canonical engine (no copied SVG strings).
 * Mirrors the reference demo's data-attr → BuildOptions mapping. The engine
 * returns a full `<span class="cr">…</span>`; we inject it so the idle
 * animation (CSS from creatureCss, already in the layout) runs.
 */
export function Creature({
  species = 'Sprout',
  stage,
  color = '#5B7C2E',
  acc = 'none',
  mark = 'none',
  size = 48,
  className,
}: {
  species?: SpeciesName;
  stage?: Stage;
  color?: string;
  acc?: Accessory;
  mark?: Marking;
  size?: number;
  className?: string;
}) {
  const html = buildCreature({ species, stage, color, acc, mark, size });
  return <span className={className} aria-hidden="true" dangerouslySetInnerHTML={{ __html: html }} />;
}
