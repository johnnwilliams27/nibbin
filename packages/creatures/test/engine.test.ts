import { describe, it, expect } from 'vitest';
import {
  buildCreature,
  creatureCss,
  shade,
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

describe('hostile input is neutralized at the chokepoint (XSS / markup injection)', () => {
  const payloads = [
    '#000"/><image href="x" onerror="alert(1)"/><rect fill="',
    '"><script>alert(1)</script>',
    '#fff', // 3-digit hex is not accepted — only full 6-digit
    'red',
    'url(#x)',
    '#5B7C2E;animation:evil',
  ];

  // tokens that only an injection could introduce — none appear in any
  // legitimate static render (unlike e.g. `#fff` eye-whites).
  const evilTokens = ['<image', '<script', '<animate', 'onerror', 'onload', 'onbegin', 'alert', 'animation:evil'];

  it('no hostile color introduces script/handlers/markup into any render', () => {
    for (const species of USER_SPECIES) {
      for (const stage of ['student', 'senior', 'grad', 'egg'] as const) {
        for (const color of payloads) {
          const svg = buildCreature({ species, stage, color });
          for (const token of evilTokens) {
            expect(svg, `${species}/${stage} leaked "${token}" from color "${color}"`).not.toContain(token);
          }
          assertWellFormed(svg, `${species}/${stage}/${color}`);
        }
      }
    }
  });

  it('an invalid color renders identically to an explicit brand-moss render (fallback proven)', () => {
    for (const species of USER_SPECIES) {
      for (const stage of ['student', 'senior', 'grad', 'egg'] as const) {
        const fallback = normalize(buildCreature({ species, stage, color: 'not-a-color' }));
        const moss = normalize(buildCreature({ species, stage, color: '#5B7C2E' }));
        expect(fallback, `${species}/${stage}`).toBe(moss);
      }
    }
  });

  it('a hostile size cannot break out of the width/height attributes', () => {
    const svg = buildCreature({ species: 'Sprout', stage: 'student', size: NaN });
    expect(svg).not.toContain('NaN');
    expect(svg).toContain('width="120"');
    const big = buildCreature({ species: 'Sprout', stage: 'student', size: 999999 });
    expect(big).toContain('width="1024"');
  });
});

describe('grad-stage anatomy suppression (cap replaces the growth signature)', () => {
  // At Graduate the cap occupies the headspace, so Wisp's flame, Puff's crest,
  // and Glim's antennae are removed. A regression (cap drawn over the feature,
  // or feature left in) is a brand defect, so assert senior-has / grad-lacks
  // using a color token unique to each feature. mass() only ever emits
  // shade(±32/22/16/40), so shade(color, 30/45/50) are feature-only markers.
  const C = '#3E7C74';
  const cases = [
    { species: 'Wisp', pct: 45, feature: 'flame' },
    { species: 'Puff', pct: 30, feature: 'crest' },
    { species: 'Glim', pct: 50, feature: 'antennae' },
  ] as const;

  for (const { species, pct, feature } of cases) {
    it(`${species} shows its ${feature} at senior and drops it at grad`, () => {
      const marker = shade(C, pct);
      expect(buildCreature({ species, stage: 'senior', color: C }), `senior ${species} should have ${feature}`).toContain(marker);
      expect(buildCreature({ species, stage: 'grad', color: C }), `grad ${species} should drop ${feature}`).not.toContain(marker);
    });
  }

  it('only the Sprout graduate cap carries the honey bloom', () => {
    expect(buildCreature({ species: 'Sprout', stage: 'grad', color: '#3E7C74' })).toContain('#B5D87A');
    expect(buildCreature({ species: 'Longear', stage: 'grad', color: '#3E7C74' })).not.toContain('#B5D87A');
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
    expect(SPECIES_NAMES).toEqual(['Sprout', 'Wisp', 'Capling', 'Longear', 'Puff', 'Glim', 'Keeper']);
    expect(USER_SPECIES).toHaveLength(6);
    expect(STAGES).toHaveLength(4);
    expect(ACCS).toHaveLength(7);
    expect(MARKS).toHaveLength(4);
    expect(PALETTES).toHaveLength(8);
  });
});
