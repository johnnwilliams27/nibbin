import { describe, it, expect } from 'vitest';
import {
  buildCreature,
  creatureCss,
  PALETTES,
  STAGES,
  ACCS,
  MARKS,
  USER_SPECIES,
  SPECIES_NAMES,
} from '../src/index';
import type { BuildOptions } from '../src/index';

/** Strip per-render unique ids and animation delays so two renders can be compared. */
function normalize(svg: string): string {
  return svg.replace(/m\d+/g, 'mX').replace(/animation-delay:[\d.]+s/g, 'animation-delay:X');
}

function assertWellFormed(svg: string, label: string) {
  expect(svg, `${label}: NaN leaked into render`).not.toContain('NaN');
  expect(svg, `${label}: undefined leaked into render`).not.toContain('undefined');
  expect((svg.match(/<svg/g) ?? []).length, `${label}: exactly one <svg>`).toBe(1);
  expect((svg.match(/<\/svg>/g) ?? []).length, `${label}: exactly one </svg>`).toBe(1);
  expect(svg.startsWith('<svg'), `${label}: starts with <svg`).toBe(true);
  expect(svg.endsWith('</svg>'), `${label}: ends with </svg>`).toBe(true);
}

describe('exhaustive render: species × stage × accessory × marking × palette', () => {
  it('renders every combination without NaN/undefined and exactly one <svg>', () => {
    let count = 0;
    for (const species of USER_SPECIES) {
      for (const stage of STAGES) {
        for (const acc of ACCS) {
          for (const mark of MARKS) {
            for (const palette of PALETTES) {
              const svg = buildCreature({ species, stage, acc, mark, color: palette.c });
              assertWellFormed(svg, `${species}/${stage}/${acc}/${mark}/${palette.n}`);
              count++;
            }
          }
        }
      }
    }
    expect(count).toBe(USER_SPECIES.length * STAGES.length * ACCS.length * MARKS.length * PALETTES.length);
  });

  it('renders the Keeper well-formed', () => {
    assertWellFormed(buildCreature({ species: 'Keeper' }), 'Keeper');
  });

  it('throws on an unknown species', () => {
    expect(() => buildCreature({ species: 'Gremlin' } as unknown as BuildOptions)).toThrow();
  });
});

describe('Keeper canonicality (C-brand: one form, every account)', () => {
  it('ignores stage/palette/accessory/marking — hostile args do not change the render', () => {
    const canonical = buildCreature({ species: 'Keeper' });
    const hostile = buildCreature({
      species: 'Keeper',
      stage: 'egg',
      color: '#FF00AA',
      acc: 'coin',
      mark: 'star',
    });
    expect(normalize(hostile)).toBe(normalize(canonical));
  });

  it('keeps brand moss and honey, and never uses a user palette fill', () => {
    const svg = buildCreature({ species: 'Keeper', color: '#FF00AA' });
    expect(svg).toContain('#5B7C2E'); // moss body
    expect(svg).toContain('#E8C44A'); // honey lantern/bloom
    expect(svg).not.toContain('#FF00AA');
  });

  it('never wears the graduation cap', () => {
    const svg = buildCreature({ species: 'Keeper', stage: 'grad' });
    expect(svg).not.toContain('tassel');
  });
});

describe('growth and layer behavior', () => {
  it('graduates wear the cap (tassel present); students do not', () => {
    for (const species of USER_SPECIES) {
      expect(buildCreature({ species, stage: 'grad', color: '#5B7C2E' })).toContain('tassel');
      expect(buildCreature({ species, stage: 'student', color: '#5B7C2E' })).not.toContain('tassel');
    }
  });

  it('blush is always coral #E2603A on every species and stage', () => {
    for (const species of USER_SPECIES) {
      for (const stage of ['student', 'senior', 'grad'] as const) {
        expect(buildCreature({ species, stage, color: '#3E7C74' })).toContain('#E2603A');
      }
    }
    expect(buildCreature({ species: 'Keeper' })).toContain('#E2603A');
  });

  it('unique gradient/clip ids per render — two renders never share ids', () => {
    const a = buildCreature({ species: 'Sprout', stage: 'senior', color: '#5B7C2E' });
    const b = buildCreature({ species: 'Sprout', stage: 'senior', color: '#5B7C2E' });
    const ids = (svg: string) => [...svg.matchAll(/id="([^"]+)"/g)].map((m) => m[1]);
    const setA = new Set(ids(a));
    for (const id of ids(b)) expect(setA.has(id), `id ${id} reused across renders`).toBe(false);
  });

  it('egg renders are eggs, not bodies (wobble class, no accessories)', () => {
    for (const species of USER_SPECIES) {
      const svg = buildCreature({ species, stage: 'egg', color: '#7B5BD6', acc: 'glasses' });
      expect(svg).toContain('class="cr eggy"');
      expect(svg).not.toContain('#39422B'); // no glasses/cap ink on an egg
    }
  });
});

describe('creatureCss', () => {
  it('ships idle animation and reduced-motion parity (static but visible)', () => {
    expect(creatureCss).toContain('prefers-reduced-motion');
    expect(creatureCss).toContain('nib-bob');
  });
});

describe('exports', () => {
  it('exposes the full taxonomy', () => {
    expect(SPECIES_NAMES).toEqual(['Sprout', 'Wisp', 'Shellback', 'Longear', 'Puff', 'Glim', 'Keeper']);
    expect(USER_SPECIES).toHaveLength(6);
    expect(STAGES).toHaveLength(4);
    expect(ACCS).toHaveLength(7);
    expect(MARKS).toHaveLength(4);
    expect(PALETTES).toHaveLength(8);
  });
});
