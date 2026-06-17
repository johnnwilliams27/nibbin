/**
 * Bake the email header creatures to static PNGs.
 *
 * Email clients strip inline <svg> and don't paint the engine's
 * feGaussianBlur/gradients, so every header creature is pre-rasterized to a
 * transparent PNG in apps/web/public/creatures/. The set is derived from the
 * beat templates (BEAT_CREATURES) so it never drifts from what emails request;
 * a test (packages/email/test/creature-assets.test.ts) asserts coverage.
 *
 * Usage:  npx tsx tools/raster-email-creatures.mts
 * Re-run whenever a template creature is added or the engine art changes, then
 * commit the regenerated PNGs.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';
import { buildCreature, type BuildOptions } from '../packages/creatures/src/index.ts';
import { BEAT_CREATURES } from '../packages/email/src/templates.ts';
import { creatureSlug, SPECIES_IMG_W, SPECIES_IMG_H } from '../packages/email/src/creature-image.ts';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, '..');
const OUT = path.join(REPO, 'apps', 'web', 'public', 'creatures');

// 4× the email display box for retina crispness (matches the Keeper raster's DPI).
const SCALE = 4;
const W = SPECIES_IMG_W * SCALE; // 416
const H = SPECIES_IMG_H * SCALE; // 480

/** Make an engine SVG rasterizable by sharp/librsvg: add the SVG namespace and
 *  fix the pixel dimensions to the target box (viewBox keeps the aspect). */
function prepareSvg(o: BuildOptions): string {
  const svg = buildCreature(o);
  return svg
    .replace('<svg ', '<svg xmlns="http://www.w3.org/2000/svg" ')
    .replace(/width="\d+"/, `width="${W}"`)
    .replace(/height="\d+"/, `height="${H}"`);
}

async function main(): Promise<void> {
  mkdirSync(OUT, { recursive: true });

  // Distinct non-Keeper creatures, keyed by slug (the Keeper uses keeper-email.png).
  const bySlug = new Map<string, BuildOptions>();
  for (const c of BEAT_CREATURES) {
    if (c.species === 'Keeper') continue;
    bySlug.set(creatureSlug(c), c);
  }

  if (bySlug.size === 0) {
    console.log('No non-Keeper email creatures to rasterize.');
    return;
  }

  for (const [slug, o] of bySlug) {
    const png = await sharp(Buffer.from(prepareSvg(o)), { density: 72 })
      .resize(W, H, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } })
      .png()
      .toBuffer();
    const file = path.join(OUT, `${slug}.png`);
    writeFileSync(file, png);
    console.log(`✓ ${slug}.png  (${W}×${H}, ${(png.length / 1024).toFixed(1)} KB)`);
  }

  console.log(`\nWrote ${bySlug.size} creature PNG(s) to apps/web/public/creatures/`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
