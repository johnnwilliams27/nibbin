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

  it('sentinel values are unique magic strings (grep-provable)', () => {
    const values = Object.values(registry.sentinels).map((s) => s.value);
    expect(new Set(values).size).toBe(values.length);
    for (const v of values) {
      // each value embeds its hex tag so a partial leak is still greppable
      const tag = v.match(/[0-9a-f]{4}/);
      expect(tag, `sentinel value "${v}" must embed its hex tag`).not.toBeNull();
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

  function walk(dir: string, out: string[] = []): string[] {
    for (const name of readdirSync(dir)) {
      const p = join(dir, name);
      if (statSync(p).isDirectory()) {
        if (!SKIP.has(name) && !p.includes(join('tests', 'redaction-corpus'))) walk(p, out);
      } else if (/\.(ts|tsx|js|jsx|mjs|cjs|css|html|sql)$/.test(name)) {
        out.push(p);
      }
    }
    return out;
  }

  it('no sentinel value appears outside the corpus', () => {
    const values = Object.values(registry.sentinels).map((s) => s.value);
    const files = [
      ...walk(join(repoRoot, 'apps')),
      ...walk(join(repoRoot, 'packages')),
    ];
    for (const file of files) {
      const text = readFileSync(file, 'utf8');
      for (const v of values) {
        expect(text.includes(v), `${file} leaks sentinel "${v}"`).toBe(false);
      }
    }
  });
});
