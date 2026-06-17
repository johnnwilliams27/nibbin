/**
 * Email creatures are hosted PNGs, never inline SVG. Gmail strips <svg>
 * entirely and the engine's feGaussianBlur/gradients don't survive most
 * clients, so every header creature is baked to a static raster at build time
 * (tools/raster-email-creatures.mts) and referenced by URL here.
 *
 * `creatureSlug` is the single source of truth for the asset filename — the
 * raster script writes `<slug>.png` and the renderers read it, so the two can
 * never drift (a test asserts every template creature has a baked PNG).
 */
import type { BuildOptions } from '@nibbin/creatures';

/** Display box for a non-Keeper creature: the 200×230 viewBox at width 104. */
export const SPECIES_IMG_W = 104;
export const SPECIES_IMG_H = 120;
/** The Keeper PNG is taller (rendered with headroom) and lives at the asset root. */
export const KEEPER_IMG_W = 104;
export const KEEPER_IMG_H = 124;
export const KEEPER_IMG_FILE = 'keeper-email.png';

/** Stable asset filename (no extension) for a creature's email raster. */
export function creatureSlug(o: BuildOptions): string {
  const parts: string[] = [o.species.toLowerCase(), o.stage ?? 'student'];
  if (o.acc && o.acc !== 'none') parts.push(o.acc);
  if (o.mark && o.mark !== 'none') parts.push(o.mark);
  if (o.color) parts.push(o.color.replace('#', '').toLowerCase());
  return parts.join('-');
}

const IMG_STYLE = 'display:block;margin:0 auto;border:0;outline:none;text-decoration:none;';

/**
 * The header `<img>` for an email creature. The Keeper uses the root
 * `keeper-email.png`; every other creature uses `creatures/<slug>.png`.
 * `base` is the absolute asset origin (e.g. https://nibbin.com); `esc` is the
 * caller's HTML escaper.
 */
export function creatureImgTag(
  base: string,
  creature: BuildOptions | undefined,
  esc: (s: string) => string,
): string {
  const c = creature ?? { species: 'Keeper' as const, size: 88 };
  const root = base.replace(/\/$/, '');
  if (c.species === 'Keeper') {
    return `<img src="${esc(root)}/${KEEPER_IMG_FILE}" width="${KEEPER_IMG_W}" height="${KEEPER_IMG_H}" alt="The Grovekeeper" style="${IMG_STYLE}">`;
  }
  // esc(slug) is defence-in-depth: slugs from BEAT_CREATURES are already
  // [a-z0-9-], but escaping here means a future caller passing a user-customized
  // creature can't break out of the src attribute.
  const slug = creatureSlug(c);
  return `<img src="${esc(root)}/creatures/${esc(slug)}.png" width="${SPECIES_IMG_W}" height="${SPECIES_IMG_H}" alt="${esc(c.species)}" style="${IMG_STYLE}">`;
}
