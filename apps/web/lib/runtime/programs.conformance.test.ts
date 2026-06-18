/**
 * Web-side program conformance (design §3.2, all-reviewers P3).
 *
 * The runtime-side capabilities.test.ts asserts a HARD-CODED list of program
 * capabilities against the registry — it never reads the real programs, so a
 * program that yields an UNREGISTERED capability would slip past it. This test
 * closes that gap from the side where the programs actually live: it scans the
 * real programs.ts source for every yielded `capability: '...'` and asserts each
 * is a CAPABILITY_REGISTRY id. It FAILS if a program adds an unregistered
 * capability.
 *
 * Approach: source-scan (regex over programs.ts). Driving the six generators to
 * exhaustion would need a bespoke quarantined-read stub per program shape
 * (mailbox/calendar/payments JSON) — brittle for what is fundamentally a
 * "no orphan capability strings" assertion. The scan reads the same file the
 * runner executes, so a new yielded capability is caught the moment it lands.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { CAPABILITY_REGISTRY } from '@nibbin/runtime';

const PROGRAMS_SRC = fileURLToPath(new URL('./programs.ts', import.meta.url));

describe('programs.ts — capability conformance (source scan)', () => {
  it('every capability the programs yield is a CAPABILITY_REGISTRY id', () => {
    const src = readFileSync(PROGRAMS_SRC, 'utf8');
    const used = new Set<string>();
    for (const m of src.matchAll(/\bcapability:\s*'([^']+)'/g)) {
      used.add(m[1]);
    }
    // Sanity: the scan found the capabilities we expect the programs to yield,
    // so a future regex/refactor breakage surfaces as an empty set rather than
    // a vacuous pass.
    expect(used.size).toBeGreaterThan(0);

    const orphans = [...used].filter((id) => !(id in CAPABILITY_REGISTRY));
    expect(orphans).toEqual([]);
  });
});
