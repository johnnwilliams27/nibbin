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
