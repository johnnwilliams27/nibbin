/**
 * Every non-Keeper creature a beat template can show must have a baked PNG in
 * apps/web/public/creatures/ — emails reference these rasters by slug, so a
 * missing file is a broken (404) header image. If this fails, run
 * `npx tsx tools/raster-email-creatures.mts` and commit the new PNG(s).
 */
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { BEAT_CREATURES } from '../src/templates';
import { creatureSlug } from '../src/creature-image';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const CREATURES_DIR = path.join(REPO, 'apps', 'web', 'public', 'creatures');

describe('email creature rasters', () => {
  const nonKeeper = BEAT_CREATURES.filter((c) => c.species !== 'Keeper');

  it('has a baked PNG for every non-Keeper template creature', () => {
    for (const c of nonKeeper) {
      const file = path.join(CREATURES_DIR, `${creatureSlug(c)}.png`);
      expect(existsSync(file), `missing raster ${creatureSlug(c)}.png — run tools/raster-email-creatures.mts`).toBe(true);
    }
  });

  it('keeps the Keeper as the root PNG (not a per-species raster)', () => {
    expect(existsSync(path.join(REPO, 'apps', 'web', 'public', 'keeper-email.png'))).toBe(true);
  });
});
