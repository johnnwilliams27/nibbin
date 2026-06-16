import { describe, it, expect } from 'vitest';
import { validateSynthesisPacket, synthesizeDiagnosis } from './synthesize';

const base = {
  version: 1, studyDays: 5, capturedFrom: '2026-06-10', capturedTo: '2026-06-15',
  workflows: [{ key: 'email.general', label: 'Email', category: 'email', apps: ['Gmail'],
                minutesObserved: 120, sessions: 10 }],
};

describe('validateSynthesisPacket studyId', () => {
  it('passes studyId through, clamped', () => {
    const p = validateSynthesisPacket({ ...base, studyId: 'study_abc' });
    expect(p?.studyId).toBe('study_abc');
  });
  it('tolerates a missing studyId (web caller)', () => {
    const p = validateSynthesisPacket(base);
    expect(p).not.toBeNull();
    expect(p?.studyId ?? '').toBe('');
  });
});

describe('validateSynthesisPacket kind + label', () => {
  it('defaults a garbage or absent kind to full_study', () => {
    expect(validateSynthesisPacket(base)?.kind).toBe('full_study');
    expect(validateSynthesisPacket({ ...base, kind: 'nonsense' })?.kind).toBe('full_study');
    expect(validateSynthesisPacket({ ...base, kind: 42 })?.kind).toBe('full_study');
  });

  it('passes quick_scan through', () => {
    expect(validateSynthesisPacket({ ...base, kind: 'quick_scan' })?.kind).toBe('quick_scan');
  });

  it('clamps an over-long label to 120 chars', () => {
    const p = validateSynthesisPacket({ ...base, label: 'L'.repeat(500) })!;
    expect(p.label!.length).toBeLessThanOrEqual(120);
    expect(p.label).toBe('L'.repeat(120));
  });
});

describe('validateSynthesisPacket enrichment clamping', () => {
  it('passes through + clamps oversized enrichment', () => {
    const p = validateSynthesisPacket({
      version: 1, studyDays: 5, capturedFrom: '2026-06-10', capturedTo: '2026-06-15',
      dailyAppMinutes: { '2026-06-10': { Gmail: 12.5 } },
      workflows: [{
        key: 'email.general', label: 'Email', category: 'email', apps: ['Gmail'],
        minutesObserved: 60, sessions: 5,
        sequences: Array.from({ length: 50 }, () => ({ steps: Array.from({ length: 40 }, () => 'x'.repeat(200)), count: 9 })),
        urlTemplates: Array.from({ length: 80 }, (_, i) => `/p/${i}`),
        dailyMinutes: { '2026-06-10': 30, '2026-06-11': 30 },
      }],
    })!;
    const w = p.workflows[0];
    expect(w.sequences!.length).toBeLessThanOrEqual(10);
    expect(w.sequences![0].steps.length).toBeLessThanOrEqual(12);
    expect(w.sequences![0].steps[0].length).toBeLessThanOrEqual(80);
    expect(w.urlTemplates!.length).toBeLessThanOrEqual(20);
    expect(p.dailyAppMinutes!['2026-06-10'].Gmail).toBe(12.5);
  });

  it('drops malformed enrichment without throwing', () => {
    const p = validateSynthesisPacket({
      version: 1, studyDays: 5, capturedFrom: 'a', capturedTo: 'b',
      workflows: [{ key: 'email.general', label: 'Email', category: 'email', apps: [], minutesObserved: 0, sessions: 0,
                    sequences: 'not-an-array', urlTemplates: 42, dailyMinutes: null }],
    });
    expect(p).not.toBeNull();
    const w = p!.workflows[0];
    expect(w.sequences ?? []).toEqual([]);
    expect(w.urlTemplates ?? []).toEqual([]);
  });
});

describe('validateSynthesisPacket size cap (HIGH-1)', () => {
  it('returns null when a validated packet exceeds the 256KB column cap', () => {
    // 60 maxed-out workflows: 10 sequences × 12 steps × 80-char strings, 20
    // urlTemplates, full dailyMinutes. With enrichment this serializes to
    // ~870KB — well past 262144.
    const big = validateSynthesisPacket({
      version: 1,
      studyDays: 5,
      capturedFrom: '2026-06-10',
      capturedTo: '2026-06-15',
      workflows: Array.from({ length: 60 }, (_, wi) => ({
        key: `email.k${wi}`,
        label: 'L'.repeat(80),
        category: 'email',
        apps: Array.from({ length: 12 }, (_, i) => `app-${i}`),
        minutesObserved: 600,
        sessions: 60,
        friction: 'f'.repeat(280),
        sequences: Array.from({ length: 10 }, () => ({
          steps: Array.from({ length: 12 }, () => 'x'.repeat(80)),
          count: 9,
        })),
        urlTemplates: Array.from({ length: 20 }, (_, i) => `/p/${'u'.repeat(100)}/${i}`),
        dailyMinutes: Object.fromEntries(
          Array.from({ length: 31 }, (_, d) => [`2026-06-${String(d + 1).padStart(2, '0')}`, 30]),
        ),
      })),
    });
    expect(big).toBeNull();
  });

  it('still validates a normal small packet', () => {
    const p = validateSynthesisPacket(base);
    expect(p).not.toBeNull();
    expect(p!.workflows.length).toBe(1);
  });
});

describe('validateSynthesisPacket prototype-key hazard (MEDIUM-3)', () => {
  it('does not throw or corrupt the result for a "__proto__" day-key', () => {
    // Parse from JSON so "__proto__" is a real own enumerable key (object
    // literals / bracket assignment special-case it via the setter and would
    // not create one). This is exactly the untrusted shape the route feeds in.
    const input = JSON.parse(
      JSON.stringify({
        version: 1,
        studyDays: 5,
        capturedFrom: 'a',
        capturedTo: 'b',
        dailyAppMinutes: { '2026-06-10': { Gmail: 12 } },
        workflows: [{
          key: 'email.general', label: 'Email', category: 'email', apps: ['Gmail'],
          minutesObserved: 60, sessions: 5,
          dailyMinutes: { '2026-06-10': 30 },
        }],
      }).replace('"2026-06-10":30', '"2026-06-10":30,"__proto__":99')
        .replace('"2026-06-10":{"Gmail":12}', '"2026-06-10":{"Gmail":12},"__proto__":{"Gmail":5}'),
    );
    const p = validateSynthesisPacket(input);
    expect(p).not.toBeNull();
    const dm = p!.workflows[0].dailyMinutes!;
    // "__proto__" landed as a normal own data key, not a prototype mutation.
    expect(Object.prototype.hasOwnProperty.call(dm, '__proto__')).toBe(true);
    expect(dm['2026-06-10']).toBe(30);
    // The accumulator's prototype was never replaced (null/uncorrupted).
    expect(Object.getPrototypeOf(p!.dailyAppMinutes!['2026-06-10'])).toBeNull();
    // Object.prototype itself is untouched.
    expect(({} as Record<string, unknown>).Gmail).toBeUndefined();
  });
});

describe('synthesizeDiagnosis automatable', () => {
  const base2 = (over: object) => ({
    version: 1 as const, studyDays: 7, capturedFrom: 'a', capturedTo: 'b',
    workflows: [{ key: 'email.general', label: 'Email', category: 'email' as const, apps: ['Gmail'], minutesObserved: 70, sessions: 7, ...over }],
  });
  it('is 0 with no sequences', () => {
    expect(synthesizeDiagnosis(base2({})).workflows[0].automatable).toBe(0);
  });
  it('scales with the dominant sequence strength (strength 24 → 50)', () => {
    const m = synthesizeDiagnosis(base2({ sequences: [{ steps: ['a', 'b', 'c'], count: 8 }] })); // 8*3 = 24
    expect(m.workflows[0].automatable).toBe(50);
  });
  it('is clamped to 100', () => {
    const m = synthesizeDiagnosis(base2({ sequences: [{ steps: Array(12).fill('s'), count: 1000 }] }));
    expect(m.workflows[0].automatable).toBe(100);
  });
});

describe('synthesizeDiagnosis finer re-mining (narrowness + regularity + friction)', () => {
  const seq = [{ steps: ['a', 'b', 'c'], count: 8 }]; // strength 24 → repetition 0.5
  const base3 = (over: object) => ({
    version: 1 as const, studyDays: 7, capturedFrom: 'a', capturedTo: 'b',
    workflows: [{ key: 'email.general', label: 'Email', category: 'email' as const, apps: ['Gmail'], minutesObserved: 70, sessions: 7, sequences: seq, ...over }],
  });

  it('broad workflow (many url templates) scores below the repetition ceiling', () => {
    const m = synthesizeDiagnosis(base3({ urlTemplates: Array.from({ length: 21 }, (_, i) => `/p/${i}`) }));
    expect(m.workflows[0].automatable).toBe(40); // 0.5 * (0.6 + 0.25*(1/6) + 0.15) ≈ 0.396
    expect(m.workflows[0].automatable).toBeLessThan(50);
  });

  it('sporadic workflow (active 1 of 7 days) scores below the ceiling', () => {
    const m = synthesizeDiagnosis(base3({ dailyMinutes: { '2026-06-10': 70 } }));
    expect(m.workflows[0].automatable).toBe(44); // 0.5 * (0.6 + 0.25 + 0.15*(1/7)) ≈ 0.436
    expect(m.workflows[0].automatable).toBeLessThan(50);
  });

  it('narrow + regular + repetitive stays at the repetition ceiling', () => {
    const m = synthesizeDiagnosis(base3({
      urlTemplates: ['/inbox'],
      dailyMinutes: Object.fromEntries(Array.from({ length: 7 }, (_, i) => [`2026-06-1${i}`, 10])),
    }));
    expect(m.workflows[0].automatable).toBe(50);
  });

  it('friction composes a factual line from sequences + templates + days', () => {
    const m = synthesizeDiagnosis(base3({
      urlTemplates: ['/x', '/y'],
      dailyMinutes: { d1: 10, d2: 10, d3: 10 },
    }));
    const f = m.workflows[0].friction!;
    expect(f).toContain('repeated 8×');
    expect(f).toContain('across 2 views');
    expect(f).toContain('on 3 days');
  });

  it('friction falls back to the on-device note when no sequences', () => {
    const m = synthesizeDiagnosis({
      version: 1, studyDays: 7, capturedFrom: 'a', capturedTo: 'b',
      workflows: [{ key: 'email.general', label: 'Email', category: 'email', apps: [], minutesObserved: 10, sessions: 2, friction: 'device note' }],
    });
    expect(m.workflows[0].friction).toBe('device note');
  });
});

describe('synthesizeDiagnosis timeSavedPerWeek', () => {
  it('pins Σ hoursPerWeek × automatable/100 (one workflow 10h @ 50 → 5.0)', () => {
    // 7-day study, 600 min observed → 10h/week; strength 24 → automatable 50.
    const m = synthesizeDiagnosis({
      version: 1, studyDays: 7, capturedFrom: 'a', capturedTo: 'b',
      workflows: [{
        key: 'email.general', label: 'Email', category: 'email', apps: ['Gmail'],
        minutesObserved: 600, sessions: 7, sequences: [{ steps: ['a', 'b', 'c'], count: 8 }],
      }],
    });
    expect(m.workflows[0].hoursPerWeek).toBe(10);
    expect(m.workflows[0].automatable).toBe(50);
    expect(m.timeSavedPerWeek).toBe(5);
  });

  it('is 0 when nothing is automatable', () => {
    const m = synthesizeDiagnosis({
      version: 1, studyDays: 7, capturedFrom: 'a', capturedTo: 'b',
      workflows: [{ key: 'email.general', label: 'Email', category: 'email', apps: [], minutesObserved: 600, sessions: 7 }],
    });
    expect(m.timeSavedPerWeek).toBe(0);
  });
});

describe('synthesizeDiagnosis appAllocation', () => {
  it('sums each app across days, converts to hours/week, ranks desc', () => {
    const m = synthesizeDiagnosis({
      version: 1, studyDays: 7, capturedFrom: 'a', capturedTo: 'b',
      workflows: [{ key: 'email.general', label: 'Email', category: 'email', apps: ['Gmail'], minutesObserved: 60, sessions: 5 }],
      dailyAppMinutes: {
        '2026-06-10': { Gmail: 60, Stripe: 30 },
        '2026-06-11': { Gmail: 60 },
      },
    });
    // Gmail 120 min / 7 days * 7 / 60 = 2.0; Stripe 30/7*7/60 ≈ 0.5
    expect(m.appAllocation).toEqual([
      { app: 'Gmail', hoursPerWeek: 2 },
      { app: 'Stripe', hoursPerWeek: 0.5 },
    ]);
  });

  it('caps at the top 8 apps', () => {
    const day: Record<string, number> = {};
    for (let i = 0; i < 12; i += 1) day[`App${i}`] = (i + 1) * 60;
    const m = synthesizeDiagnosis({
      version: 1, studyDays: 7, capturedFrom: 'a', capturedTo: 'b',
      workflows: [{ key: 'other.general', label: 'Other', category: 'other', apps: [], minutesObserved: 60, sessions: 5 }],
      dailyAppMinutes: { '2026-06-10': day },
    });
    expect(m.appAllocation).toHaveLength(8);
    expect(m.appAllocation[0].app).toBe('App11'); // largest
  });

  it('is [] when dailyAppMinutes is absent', () => {
    const m = synthesizeDiagnosis({
      version: 1, studyDays: 7, capturedFrom: 'a', capturedTo: 'b',
      workflows: [{ key: 'email.general', label: 'Email', category: 'email', apps: [], minutesObserved: 60, sessions: 5 }],
    });
    expect(m.appAllocation).toEqual([]);
  });
});
