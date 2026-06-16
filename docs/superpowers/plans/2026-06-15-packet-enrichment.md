# Synthesis Packet Enrichment Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Enrich the synthesis packet with re-minable redacted structure (per-workflow `sequences`, `urlTemplates`, `dailyMinutes`; top-level `dailyAppMinutes`), retained within the 256KB cap; and consume `sequences` now to compute a per-workflow `automatable` score surfaced in the diagnosis.

**Architecture:** The on-device segmenter (`packages/redaction/src/segment.ts`) emits the new bounded fields. The cloud validator (`validateSynthesisPacket`) clamps + passes them through (untrusted input). `synthesizeDiagnosis` derives `automatable` from `sequences` (server-side, deterministic v0 heuristic). The reveal UI shows an `automatable` badge. The existing `PacketLeakError` re-scan covers the new fields; the cross-package drift guard keeps the segmenter output ↔ validator in sync.

**Tech Stack:** TypeScript (segmenter, validator, synthesis, Next.js page), Vitest. No migration, no Rust.

**Reference:** `docs/superpowers/specs/2026-06-15-packet-enrichment-design.md`. Tests run from repo root `C:\Nibbin` via `npm test -- <substring>` (single root vitest config; globs `packages/*/test/**`, `apps/*/lib/**`, `apps/*/test/**`, `tests/**`).

**IMPORTANT — two type homes:** the packet shape is declared TWICE (intentionally): `packages/redaction/src/segment.ts` (the segmenter's own `SynthesisPacket`/`PacketWorkflow`, NOT re-exported via the barrel due to a name collision with `packet.ts`) and `apps/web/lib/diagnosis/types.ts` (the cloud contract). New fields must be added to BOTH; the drift-guard test `tests/diagnosis-packet-contract.test.ts` enforces they stay compatible.

---

## Task 1: Segmenter emits the enrichment fields

**Files:**
- Modify: `packages/redaction/src/segment.ts`
- Modify: `packages/redaction/test/segment.test.ts`

Context: current `segmentStudy` builds one `PacketWorkflow` per category inside a `for (const [category, evs] of byCat)` loop and returns `{version, studyId, studyDays, capturedFrom, capturedTo, workflows}`. `sequenceCandidates(events)` is imported from `./packet.js` and returns `{ steps: string[]; count: number }[]`. The function already ends with a `batteryStillMatches(JSON.stringify(packet))` re-scan — leave that LAST so it covers the new fields.

- [ ] **Step 1: Write failing tests**

Add to `packages/redaction/test/segment.test.ts`:

```typescript
  it('emits bounded enrichment: sequences, urlTemplates, dailyMinutes, dailyAppMinutes', async () => {
    // 4 identical-shaped email events across 2 days to create a repeated sequence.
    const events: ObserverEvent[] = [];
    for (let i = 0; i < 6; i += 1) {
      events.push(ev({
        ts: `2026-06-${10 + (i % 2)}T09:0${i}:00.000Z`, session: `s${i % 2}`,
        app: { bundle_id: 'g', name: 'Gmail' },
        url: { host: 'mail.google.com', path_template: `/mail/u/${i % 3}` },
        ax: { role_path: `list>row${i % 2}`, action: 'press', label_redacted: 'Open', value_class: 'none' },
      }));
    }
    const packet = await segmentStudy('study_1', events, NOW);
    const email = packet.workflows.find((w) => w.category === 'email')!;
    expect(Array.isArray(email.sequences)).toBe(true);
    expect(email.sequences!.length).toBeLessThanOrEqual(10);
    expect(email.urlTemplates!.length).toBeLessThanOrEqual(20);
    expect(new Set(email.urlTemplates)).toEqual(new Set(['/mail/u/0', '/mail/u/1', '/mail/u/2']));
    // dailyMinutes summed per ISO day (each event 60000ms = 1 min)
    expect(Object.keys(email.dailyMinutes!).sort()).toEqual(['2026-06-10', '2026-06-11']);
    // top-level daily app minutes present
    expect(packet.dailyAppMinutes!['2026-06-10'].Gmail).toBeGreaterThan(0);
  });
```

- [ ] **Step 2: Run to confirm fail**

Run: `npm test -- segment`
Expected: FAIL — `sequences`/`urlTemplates`/etc. are undefined.

- [ ] **Step 3: Add the local types**

In `packages/redaction/src/segment.ts`, extend the interfaces:

```typescript
export interface SequenceCandidateLite {
  steps: string[];
  count: number;
}

export interface PacketWorkflow {
  key: string;
  label: string;
  category: WorkflowCategory;
  apps: string[];
  minutesObserved: number;
  sessions: number;
  friction?: string;
  sequences?: SequenceCandidateLite[];
  urlTemplates?: string[];
  dailyMinutes?: Record<string, number>;
}

export interface SynthesisPacket {
  version: 1;
  studyId: string;
  studyDays: number;
  capturedFrom: string;
  capturedTo: string;
  workflows: PacketWorkflow[];
  dailyAppMinutes?: Record<string, Record<string, number>>;
}
```

- [ ] **Step 4: Emit the fields**

Inside the `for (const [category, evs] of byCat)` loop, after the existing `friction` computation,
build the enrichment and include it on the pushed workflow (only when non-empty, to keep the packet lean):

```typescript
    const sequences = sequenceCandidates(evs).slice(0, 10);
    const urlTemplates = [...new Set(evs.map((e) => e.url?.path_template).filter((u): u is string => !!u))].slice(0, 20);
    const dayMs: Record<string, number> = {};
    for (const e of evs) {
      const d = e.ts.slice(0, 10);
      dayMs[d] = (dayMs[d] ?? 0) + (e.input?.duration_ms ?? 0);
    }
    const dailyMinutes: Record<string, number> = {};
    for (const [d, ms] of Object.entries(dayMs).slice(0, 31)) dailyMinutes[d] = Math.round((ms / 60000) * 10) / 10;

    workflows.push({
      key: `${category}.general`,
      label: CATEGORY_LABEL[category],
      category,
      apps,
      minutesObserved: Math.round((ms / 60000) * 10) / 10,
      sessions,
      ...(friction ? { friction } : {}),
      ...(sequences.length ? { sequences } : {}),
      ...(urlTemplates.length ? { urlTemplates } : {}),
      ...(Object.keys(dailyMinutes).length ? { dailyMinutes } : {}),
    });
```

After the workflow loop (and the `workflows.sort(...)`), build the top-level aggregate, before assembling `packet`:

```typescript
  const dayAppMs: Record<string, Record<string, number>> = {};
  for (const e of exportable) {
    const d = e.ts.slice(0, 10);
    const bucket = (dayAppMs[d] ??= {});
    bucket[e.app.name] = (bucket[e.app.name] ?? 0) + (e.input?.duration_ms ?? 0);
  }
  const dailyAppMinutes: Record<string, Record<string, number>> = {};
  for (const [d, apps] of Object.entries(dayAppMs).slice(0, 31)) {
    const inner: Record<string, number> = {};
    for (const [app, ms] of Object.entries(apps).slice(0, 20)) inner[app] = Math.round((ms / 60000) * 10) / 10;
    dailyAppMinutes[d] = inner;
  }
```

Add `...(Object.keys(dailyAppMinutes).length ? { dailyAppMinutes } : {})` to the `packet` object literal.
Keep the `batteryStillMatches(JSON.stringify(packet))` re-scan as the LAST step.

- [ ] **Step 5: Run to confirm pass**

Run: `npm test -- segment`
Expected: PASS (existing + new test). `npm run typecheck -w packages/redaction` clean.

- [ ] **Step 6: Commit**

```bash
git add packages/redaction/src/segment.ts packages/redaction/test/segment.test.ts
git commit -m "feat(redaction): emit re-minable enrichment (sequences, urlTemplates, daily minutes)"
```

---

## Task 2: Cloud contract + validator clamp/passthrough

**Files:**
- Modify: `apps/web/lib/diagnosis/types.ts`
- Modify: `apps/web/lib/diagnosis/synthesize.ts` (`validateSynthesisPacket` only in this task)
- Modify: `apps/web/lib/diagnosis/synthesize.test.ts`

Context: `validateSynthesisPacket` whitelist-rebuilds the packet (so unlisted fields are dropped before storage). It uses local `clampStr(v, max)`. The packet is untrusted external input — every new field must be bounded.

- [ ] **Step 1: Write failing tests**

Add to `apps/web/lib/diagnosis/synthesize.test.ts`:

```typescript
import { synthesizeDiagnosis } from './synthesize'; // if not already imported

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
```

- [ ] **Step 2: Run to confirm fail**

Run: `npm test -- diagnosis/synthesize`
Expected: FAIL — enrichment fields not on the validated output.

- [ ] **Step 3: Extend the types**

In `apps/web/lib/diagnosis/types.ts`:

```typescript
export interface SequenceCandidate {
  steps: string[];
  count: number;
}

export interface PacketWorkflow {
  key: string;
  label: string;
  category: WorkflowCategory;
  apps: string[];
  minutesObserved: number;
  sessions: number;
  friction?: string;
  sequences?: SequenceCandidate[];
  urlTemplates?: string[];
  dailyMinutes?: Record<string, number>;
}

export interface SynthesisPacket {
  version: 1;
  studyId?: string;
  studyDays: number;
  capturedFrom: string;
  capturedTo: string;
  workflows: PacketWorkflow[];
  dailyAppMinutes?: Record<string, Record<string, number>>;
}
```

Also add `automatable: number;` to `DiagnosisWorkflow` (used in Task 3):

```typescript
export interface DiagnosisWorkflow {
  key: string;
  label: string;
  category: WorkflowCategory;
  hoursPerWeek: number;
  frequency: Frequency;
  friction: string | null;
  recommendedNibbin: string | null;
  automatable: number;
  description?: string;
}
```

- [ ] **Step 4: Clamp + pass through in the validator**

In `apps/web/lib/diagnosis/synthesize.ts`, add bounded helpers near `clampStr`:

```typescript
const clampNum = (v: unknown, max: number) => Math.max(0, Math.min(max, Number(v) || 0));

function clampDayMap(v: unknown, maxDays: number): Record<string, number> | undefined {
  if (typeof v !== 'object' || v === null) return undefined;
  const out: Record<string, number> = {};
  for (const [k, val] of Object.entries(v as Record<string, unknown>).slice(0, maxDays)) {
    out[clampStr(k, 10)] = Math.round(clampNum(val, 1_000_000) * 10) / 10;
  }
  return Object.keys(out).length ? out : undefined;
}

function clampSequences(v: unknown): { steps: string[]; count: number }[] | undefined {
  if (!Array.isArray(v)) return undefined;
  const out = v.slice(0, 10).map((raw) => {
    const s = (raw ?? {}) as Record<string, unknown>;
    const steps = Array.isArray(s.steps) ? s.steps.slice(0, 12).map((x) => clampStr(x, 80)).filter(Boolean) : [];
    return { steps, count: clampNum(s.count, 1_000_000) };
  }).filter((s) => s.steps.length > 0);
  return out.length ? out : undefined;
}
```

Inside the per-workflow loop of `validateSynthesisPacket`, after computing `friction`, build the
enrichment and spread it onto the pushed object:

```typescript
    const sequences = clampSequences(w.sequences);
    const urlTemplates = Array.isArray(w.urlTemplates)
      ? w.urlTemplates.slice(0, 20).map((u) => clampStr(u, 120)).filter(Boolean)
      : undefined;
    const dailyMinutes = clampDayMap(w.dailyMinutes, 31);
    workflows.push({
      key, label, category, apps, minutesObserved, sessions,
      ...(friction ? { friction } : {}),
      ...(sequences ? { sequences } : {}),
      ...(urlTemplates && urlTemplates.length ? { urlTemplates } : {}),
      ...(dailyMinutes ? { dailyMinutes } : {}),
    });
```

And the top-level return, add `dailyAppMinutes`:

```typescript
  const dailyAppMinutes = (() => {
    if (typeof p.dailyAppMinutes !== 'object' || p.dailyAppMinutes === null) return undefined;
    const out: Record<string, Record<string, number>> = {};
    for (const [day, apps] of Object.entries(p.dailyAppMinutes as Record<string, unknown>).slice(0, 31)) {
      const inner = clampDayMap(apps, 20);
      if (inner) out[clampStr(day, 10)] = inner;
    }
    return Object.keys(out).length ? out : undefined;
  })();

  return {
    version: 1,
    studyId: clampStr(p.studyId, 64) || undefined,
    studyDays,
    capturedFrom: clampStr(p.capturedFrom, 40),
    capturedTo: clampStr(p.capturedTo, 40),
    workflows,
    ...(dailyAppMinutes ? { dailyAppMinutes } : {}),
  };
```

- [ ] **Step 5: Run to confirm pass**

Run: `npm test -- diagnosis/synthesize diagnosis-packet-contract`
Expected: PASS (clamping tests + drift guard still green). `npm run typecheck -w apps/web` clean.

- [ ] **Step 6: Commit**

```bash
git add apps/web/lib/diagnosis/types.ts apps/web/lib/diagnosis/synthesize.ts apps/web/lib/diagnosis/synthesize.test.ts
git commit -m "feat(diagnosis): validate + retain packet enrichment fields"
```

---

## Task 3: Consume — `automatable` score in synthesis

**Files:**
- Modify: `apps/web/lib/diagnosis/synthesize.ts` (`synthOne`)
- Modify: `apps/web/lib/diagnosis/synthesize.test.ts`

Context: `synthOne(w, days)` builds a `DiagnosisWorkflow`. `DiagnosisWorkflow.automatable` was added in Task 2. The packet workflow now carries `sequences`.

- [ ] **Step 1: Write failing tests**

```typescript
describe('synthesizeDiagnosis automatable', () => {
  const base = (over: object) => ({
    version: 1 as const, studyDays: 7, capturedFrom: 'a', capturedTo: 'b',
    workflows: [{ key: 'email.general', label: 'Email', category: 'email' as const, apps: ['Gmail'], minutesObserved: 70, sessions: 7, ...over }],
  });
  it('is 0 with no sequences', () => {
    expect(synthesizeDiagnosis(base({})).workflows[0].automatable).toBe(0);
  });
  it('scales with the dominant sequence strength (strength 24 → 50)', () => {
    const m = synthesizeDiagnosis(base({ sequences: [{ steps: ['a', 'b', 'c'], count: 8 }] })); // 8*3 = 24
    expect(m.workflows[0].automatable).toBe(50);
  });
  it('is clamped to 100', () => {
    const m = synthesizeDiagnosis(base({ sequences: [{ steps: Array(12).fill('s'), count: 1000 }] }));
    expect(m.workflows[0].automatable).toBe(100);
  });
});
```

- [ ] **Step 2: Run to confirm fail**

Run: `npm test -- diagnosis/synthesize`
Expected: FAIL — `automatable` undefined / not computed.

- [ ] **Step 3: Compute the score**

In `synthesize.ts`, add the heuristic and wire it into `synthOne`:

```typescript
/** v0 automatability heuristic: saturating in the dominant repeated step-chain. */
function automatableScore(w: PacketWorkflow): number {
  const top = w.sequences?.[0];
  if (!top) return 0;
  const strength = (top.count || 0) * (top.steps?.length || 0);
  if (strength <= 0) return 0;
  return Math.max(0, Math.min(100, Math.round((100 * strength) / (strength + 24))));
}
```

In `synthOne`'s returned object, add `automatable: automatableScore(w),`.

- [ ] **Step 4: Run to confirm pass**

Run: `npm test -- diagnosis/synthesize diagnosis-packet-contract`
Expected: PASS. `npm run typecheck -w apps/web` clean.

- [ ] **Step 5: Commit**

```bash
git add apps/web/lib/diagnosis/synthesize.ts apps/web/lib/diagnosis/synthesize.test.ts
git commit -m "feat(diagnosis): derive per-workflow automatable score from sequences"
```

---

## Task 4: Surface `automatable` in the reveal UI

**Files:**
- Modify: `apps/web/app/app/diagnosis/page.tsx`
- Modify: `apps/web/app/app/diagnosis/diagnosis.module.css` (only if a new tone/class is needed)

Context: the per-workflow card renders a `wfMeta` row of `Badge` components (frequency, category, recommended Nibbin). `Badge` accepts a `tone` prop (`'honey' | 'sky' | 'neutral' | 'moss'` are used here). `w.automatable` is a number 0–100.

- [ ] **Step 1: Add the badge**

In `page.tsx`, in the `wfMeta` block, after the category `Badge`, add:

```tsx
                  {w.automatable > 0 && (
                    <Badge tone="sky">~{w.automatable}% automatable</Badge>
                  )}
```

(Reuse an existing tone — pick whichever reads best against the others; `sky` suggested. Only add a CSS class/tone if the design needs a distinct color.)

- [ ] **Step 2: Verify build + typecheck**

Run: `npm run typecheck -w apps/web` (clean) and `npm run build -w apps/web` if quick, OR rely on typecheck.
Expected: clean — `automatable` is a required field on `DiagnosisWorkflow`, so any older code path constructing a `DiagnosisWorkflow` without it would error (there should be none outside `synthOne`).

- [ ] **Step 3: Commit**

```bash
git add apps/web/app/app/diagnosis/page.tsx apps/web/app/app/diagnosis/diagnosis.module.css
git commit -m "feat(diagnosis): show automatable % per workflow in the reveal"
```

---

## Task 5: Size-bound guard + final check

**Files:**
- Modify: `packages/redaction/test/segment.test.ts`
- Modify: `docs/STATE.md`

- [ ] **Step 1: Size-bound test**

Add to `segment.test.ts` a test that a large multi-category study stays well under the 256KB cap:

```typescript
  it('stays under the 256KB packet cap for a large study', async () => {
    const hosts = ['mail.google.com', 'stripe.com', 'salesforce.com', 'docs.google.com', 'x.com'];
    const events: ObserverEvent[] = [];
    for (let d = 10; d <= 23; d += 1) {
      for (let i = 0; i < 200; i += 1) {
        const h = hosts[i % hosts.length];
        events.push(ev({
          ts: `2026-06-${d}T${String(8 + (i % 10)).padStart(2, '0')}:00:00.000Z`, session: `s${d}-${i % 12}`,
          app: { bundle_id: 'b', name: `App${i % 5}` }, url: { host: h, path_template: `/p/${i % 25}` },
          ax: { role_path: `r${i % 7}>c${i % 3}`, action: 'press', label_redacted: 'x', value_class: 'none' },
        }));
      }
    }
    const packet = await segmentStudy('big', events, '2026-06-24T00:00:00.000Z');
    expect(JSON.stringify(packet).length).toBeLessThan(262144);
  });
```

- [ ] **Step 2: Run to confirm pass**

Run: `npm test -- segment`
Expected: PASS (packet well under the cap given the per-field caps).

NOTE: if this test ever fails (a pathological study approaches the cap), add the trim-guard from the
spec's Error handling section to `segmentStudy` (trim `sequences` lowest-count-first until under a 230KB
threshold, recording a `manifestNote`) and re-run. Only add the guard if the test actually trips.

- [ ] **Step 3: Record in STATE.md**

Under the Field Study cloud sync bullet in `docs/STATE.md`, note: packet enrichment shipped — per-workflow
`sequences`/`urlTemplates`/`dailyMinutes` + top-level `dailyAppMinutes` retained (bounded, <256KB), and a
v0 `automatable` score (from `sequences`) computed in synthesis + shown in the reveal (advances Maya-demo
Group A). Move follow-up (a) "packet enrichment" to done; leave the finer re-mining (consume
`dailyMinutes`/`urlTemplates`) as the remaining enrichment follow-up.

- [ ] **Step 4: Commit + final suite**

```bash
git add packages/redaction/test/segment.test.ts docs/STATE.md
git commit -m "test(redaction): packet stays under 256KB cap; docs(state): enrichment shipped"
```

Run: `npm test -- segment diagnosis/synthesize diagnosis-packet-contract study-packet-route sync-study`
Expected: all green. Then dispatch a final code-reviewer over the enrichment diff (focus: validator
clamping bounds on untrusted input, size budget, drift guard).
