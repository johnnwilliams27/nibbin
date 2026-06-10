/**
 * Redaction corpus — CI-blocking and P0 (SPEC §7.1).
 *
 * M0 scope: the Observer's 4-layer pipeline does not exist yet (M6), so the
 * pipeline assertions (zero persisted sentinels, fail-closed NER, day-14 stop)
 * cannot run against real code. What IS enforced from day one:
 *   1. Corpus integrity — registry well-formed, sentinel values unique and
 *      grep-provable, every fixture references only registered sentinels.
 *   2. No sentinel value ever appears in shipped source code or built app
 *      output (a leak of the corpus itself into the product would poison
 *      grep-provability).
 * The pipeline suites attach here at M6 and reuse these fixtures.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const fixturesDir = join(here, 'fixtures');
const repoRoot = join(here, '..', '..');

interface SentinelEntry {
  kind: string;
  value: string;
}

const registry = JSON.parse(readFileSync(join(fixturesDir, 'sentinels.json'), 'utf8')) as {
  sentinels: Record<string, SentinelEntry>;
};

describe('corpus integrity', () => {
  it('registry is non-empty and every sentinel id follows SENTINEL_<KIND>_<hex>', () => {
    const ids = Object.keys(registry.sentinels);
    expect(ids.length).toBeGreaterThanOrEqual(9);
    for (const id of ids) {
      expect(id).toMatch(/^SENTINEL_[A-Z]+_[0-9a-f]{4}$/);
    }
  });

  it('sentinel values are unique magic strings, each embedding its own id tag (grep-provable)', () => {
    const values = Object.values(registry.sentinels).map((s) => s.value);
    expect(new Set(values).size).toBe(values.length);
    for (const [id, entry] of Object.entries(registry.sentinels)) {
      // the value must contain THIS id's hex tag, so a partial leak traces back
      // to its exact registry entry — not just any 4 hex-ish chars.
      const tag = id.slice(-4);
      expect(entry.value, `sentinel ${id} value "${entry.value}" must embed its own tag "${tag}"`).toContain(tag);
    }
  });

  it('every fixture references only registered sentinel ids', () => {
    const ids = new Set(Object.keys(registry.sentinels));
    const fixtureFiles = readdirSync(fixturesDir).filter((f) => f.endsWith('.json') && f !== 'sentinels.json');
    expect(fixtureFiles.length).toBeGreaterThanOrEqual(3);
    for (const f of fixtureFiles) {
      const text = readFileSync(join(fixturesDir, f), 'utf8');
      const used = text.match(/SENTINEL_[A-Z]+_[0-9a-f]{4}/g) ?? [];
      expect(used.length, `${f} must seed at least one sentinel`).toBeGreaterThan(0);
      for (const id of used) {
        expect(ids.has(id), `${f} references unregistered sentinel ${id}`).toBe(true);
      }
    }
  });
});

describe('sentinels never leak into shipped source', () => {
  const SKIP = new Set(['node_modules', '.git', '.next', 'dist', 'build', 'coverage', '.vercel']);
  const corpusDir = join(repoRoot, 'tests', 'redaction-corpus');

  function walk(dir: string, out: string[] = []): string[] {
    for (const name of readdirSync(dir)) {
      const p = join(dir, name);
      if (statSync(p).isDirectory()) {
        // exclude the corpus itself (where sentinels legitimately live) but
        // scan everything else the repo ships — including tools/, infra/,
        // supabase/ migrations, reference/ HTML, and root config.
        if (!SKIP.has(name) && !p.startsWith(corpusDir)) walk(p, out);
      } else if (/\.(ts|tsx|js|jsx|mjs|cjs|css|html|sql|json|md|ya?ml)$/.test(name)) {
        out.push(p);
      }
    }
    return out;
  }

  it('no sentinel value appears anywhere outside the corpus (full-repo walk)', () => {
    const values = Object.values(registry.sentinels).map((s) => s.value);
    const files = walk(repoRoot);
    // census guard: the walk must actually reach every shipped top-level dir,
    // so this control cannot silently shrink its own coverage.
    for (const top of ['apps', 'packages', 'tools', 'supabase', 'reference']) {
      const prefix = join(repoRoot, top);
      expect(files.some((f) => f.startsWith(prefix)), `leak walk must cover ${top}/`).toBe(true);
    }
    for (const file of files) {
      const text = readFileSync(file, 'utf8');
      for (const v of values) {
        expect(text.includes(v), `${file} leaks sentinel "${v}"`).toBe(false);
      }
    }
  });
});
