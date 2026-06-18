/**
 * Web-side program conformance (design §3.2, all-reviewers P3).
 *
 * The runtime-side capabilities.test.ts asserts a HARD-CODED list of program
 * capabilities against the registry — it never reads the real yielded steps, so
 * a program that yields an UNREGISTERED capability would slip past it. This test
 * closes that gap from the side where the yielded `capability: '...'` strings
 * actually live, asserting each is a CAPABILITY_REGISTRY id. It FAILS if a
 * program/primitive adds an unregistered capability.
 *
 * Since Slice 2c, all six template programs in programs.ts DELEGATE to the
 * shared primitive implementations in packages/runtime/src/primitives — the
 * yielded `capability: '...'` strings now live in those primitive files, not in
 * programs.ts. So the scan covers BOTH programs.ts (in case a future template
 * inlines a yield again) AND every primitive source file. Driving the generators
 * to exhaustion would need a bespoke quarantined-read stub per program shape —
 * brittle for what is fundamentally a "no orphan capability strings" assertion.
 * The scan reads the same files the runner executes, so a new yielded capability
 * is caught the moment it lands.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { glob } from 'glob';
import { CAPABILITY_REGISTRY } from '@nibbin/runtime';

const PROGRAMS_SRC = fileURLToPath(new URL('./programs.ts', import.meta.url));
const PRIMITIVES_DIR = fileURLToPath(new URL('../../../../packages/runtime/src/primitives', import.meta.url));

describe('programs.ts — capability conformance (source scan)', () => {
  it('every capability the programs + primitives yield is a CAPABILITY_REGISTRY id', async () => {
    const primitiveFiles = await glob('*.ts', { cwd: PRIMITIVES_DIR, absolute: true });
    // The primitive impls are where the yields now live (programs.ts delegates).
    expect(primitiveFiles.length).toBeGreaterThan(0);
    const sources = [PROGRAMS_SRC, ...primitiveFiles].map((f) => readFileSync(f, 'utf8'));

    const used = new Set<string>();
    for (const src of sources) {
      for (const m of src.matchAll(/\bcapability:\s*'([^']+)'/g)) {
        used.add(m[1]);
      }
    }
    // Sanity: the scan found the capabilities we expect the programs to yield,
    // so a future regex/refactor breakage surfaces as an empty set rather than
    // a vacuous pass.
    expect(used.size).toBeGreaterThan(0);

    const orphans = [...used].filter((id) => !(id in CAPABILITY_REGISTRY));
    expect(orphans).toEqual([]);
  });
});
