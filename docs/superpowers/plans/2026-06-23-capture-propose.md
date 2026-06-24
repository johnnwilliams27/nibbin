# P3 — Passive-Capture Propose Loop — TDD Implementation Plan

**Date:** 2026-06-23
**Branch / worktree:** `feature/company-brain-capture-propose` in `C:\nib-p3` (use `cd /c/nib-p3`).
**Source of truth:** `docs/superpowers/specs/2026-06-23-capture-propose-design.md`.
**Builds on (already present in this worktree):** F1/F2 Foundation — migration `supabase/migrations/20260622140000_company_brain_foundation.sql` (`sources`, `proposals`, `propose_memory_change`, `decide_memory_proposal`, `field_evidence`, `grove_memory_history`, `field_meta`, `review_item` notification).

---

## Goal

Close the "learns by watching" loop: after the user's privacy review on `/app/study/review`, derive a small, typed `ObservationSummary` **on-device** from the surviving events, send only that summary to the cloud, and turn it into 1–3 `propose_memory_change(origin='capture', source kind='observation')` proposals that flow into the **existing F2 review queue** on the Memory page. No new approval UI; reuse F2 end to end.

**Confirmed decisions baked in (do not re-litigate):**
- **PD1 — Option A (on-device pattern-level derivation).** A local `deriveObservationSummary()` Tauri command runs over the kept-after-review events. Only the typed `ObservationSummary` (top apps, timing, workflow shapes) crosses to the cloud. **No** AX label / window title / URL path / keystroke content ever leaves the device. C1/C7 are NOT relaxed.
- Post-study surface = **land on the Memory page with a banner** ("Your Nibbin found N thing(s)…"). The optional §8.2 micro-surface is NOT in this plan.
- Derivation/upload timing = **async / fire-and-forget** from the user's POV. The "Done — save what I kept" button completes the study immediately and shows a brief "Learning…" affordance; proposals arrive in the queue without a blocking spinner. On `[]` / error → navigate normally, no nudge, no error surfaced.
- Cloud-side flow is **route-level orchestration** (PD4): no new PL/pgSQL primitive. The new route inserts the `sources` row and calls the existing `propose_memory_change` RPC per proposal.

---

## Architecture

```
/app/study/review  ── "Done — save what I kept" ──►  desktopBridge.finalizeReview()
                                                          │  (Tauri, on-device)
            ┌─────────────────────────────────────────────┘
            ▼
  Rust: finalize_review command
    1. flush pending deletions (existing review_delete path)
    2. mark study COMPLETE (existing control verb)
    3. derive_observation_summary  ── computeFieldNotes + workflow-shape pass ──► ObservationSummary | null
    4. if non-null: POST it to /api/brain/propose-from-capture (authed, access_token from keychain)
            │   (ONLY the summary crosses the trust boundary)
            ▼  CLOUD
  POST /api/brain/propose-from-capture
    a. clientForRequest(req) → user → ensureAccount  (same auth as /api/study/packet)
    b. ObservationSummary Zod strict-parse (extra field → 400)
    c. batteryStillMatches(JSON.stringify(summary)) !== null → 422 quarantine (no DB write)
    d. serviceClient: insert sources(kind='observation', source_tier=40, redaction_status='clean')
    e. deriveProposalsFromObservation(summary) → small anthropicGenerate() call → [{field_key,value,rationale}] (0–3)
    f. per proposal: batteryStillMatches(value) clean → propose_memory_change(origin='capture', source_id, op='append')
    g. return { source_id, proposal_ids }
            │
            ▼
  F2 review queue (Memory page) — proposals tagged "From your Field Study" + link back to study.
  Approve path is F2's decide_memory_proposal (unchanged): curated write + history + field_evidence + audit.
```

**The cross-boundary payload (the ONLY thing that leaves the device):**
```ts
interface ObservationSummary {
  study_id: string;
  study_period: { start: string; end: string };   // ISO dates
  total_events_reviewed: number;
  active_ms: number;
  top_apps: Array<{ name: string; durationMs: number; category?: string }>;
  busiest_hour: number | null;                     // 0-23
  workflow_shapes: Array<{ pattern: string; frequency: number }>;  // app-name transitions only
  gap_count: number;
}
```

**Reused seams (do not reinvent):**
- On-device stats base: `apps/desktop/src/core/field-notes.ts` → `computeFieldNotes`.
- Web bridge: `apps/web/lib/desktop/bridge.ts` (`desktopBridge`, `call<T>` graceful-degrade pattern).
- Redaction guard: `batteryStillMatches(text): string | null` from `@nibbin/redaction` (the `isClean` the spec refers to — returns a rule id on residual, `null` when clean).
- LLM seam: `anthropicGenerate(): Generate | null` from `apps/web/lib/llm/client.ts` (returns `null` without an API key → caller must fall back to `[]`).
- Cloud auth pattern: copy `/api/study/packet/route.ts` (`clientForRequest` + `auth.getUser` + `ensureAccount`).
- F2 RPC signature: `propose_memory_change(p_account, p_field_key, p_op, p_value, p_rationale, p_source_id, p_origin)` — service-role only.
- RLS test harness: `tests/rls/harness.ts` + `RlsHarness` (see `tests/rls/company-brain-foundation.test.ts`).

---

## Global constraints (privacy invariants — non-negotiable)

1. **C1 / derived-not-raw.** No raw event content (`ax.label_redacted`, `window.title_redacted`, `url.path`/`url.host`, `e.id`, keystroke content) appears in `ObservationSummary`, in any network payload, in `sources.origin`, in `proposals`, or in any log line. `workflow_shapes.pattern` is built from `e.app.name` transitions ONLY.
2. **C7 / split preserved.** Derivation runs in the Tauri process over the post-review survivor set; the cloud `packages/drip` field-notes path is untouched. The cloud never receives events.
3. **Strict schema + redaction gate at the boundary.** Server Zod-parses with `.strict()` (extra field → 400). `batteryStillMatches` is run on the stringified summary before any DB write (→ 422, no write) AND on each model-proposed value before `propose_memory_change` (residual → drop that proposal silently, keep the source).
4. **No new curated-write path.** P3 only *proposes*. The single curated write remains F2's `decide_memory_proposal` (authenticated, logged). Producers use the service-role RPC; the route never writes `grove_memory` directly.
5. **`[]` is success.** Thin summary or no-API-key → no proposals, no `review_item` notification, no user-facing error. The `sources` row is still written (staleness evidence).
6. **No schema migration.** `sources.kind='observation'`, `proposals.origin='capture'`, and the `review_item` notification already exist from F1/F2. P3 ships ZERO migrations. If a task appears to need one, STOP and escalate.
7. **Adversarial gate.** This is a privacy-sensitive data path → the 4-reviewer adversarial gate (red-team / claims-auditor / logic-skeptic / cost-auditor) runs before merge (see Task 9). Land via PR against `main` with the 4 CI checks.

---

## Toolchain note (read before starting)

Tasks split into two tracks that can be built and tested **independently**:

- **WEB track (no desktop toolchain).** Tasks 1, 2, 3, 4, 6, 8. Buildable/testable with `npm` + `vitest` only. The `ObservationSummary` type, the workflow-shape derivation (pure TS), the cloud route, the cloud proposal derivation, the bridge method signatures, and the review-page button + Memory origin tag. Run with `npm run test` (vitest) and `npm run typecheck`; DB-backed assertions run under `tests/rls` (needs a local Postgres per `RlsHarness.probe()`; suite self-skips when absent).
- **DESKTOP track (REQUIRES Rust + MSVC + Strawberry Perl + NASM — see `project_nibbin_desktop_local_build`).** Tasks 5, 7. The Rust `derive_observation_summary` + `finalize_review` Tauri commands and their `cargo test`. **Mark these clearly; if the Rust toolchain is unavailable, the web track is fully shippable/reviewable on its own and the Rust commands are stubbed behind the bridge's graceful-degrade `call<T>` fallback.**

Each task is bite-sized, TDD (test first), with an exact test command and a commit at the end.

---

## Task 0 — Branch sanity + baseline green  *(WEB)*

Confirm the worktree is on the right branch, F1/F2 is present, and the baseline is green before adding anything.

```bash
cd /c/nib-p3
git rev-parse --abbrev-ref HEAD          # expect: feature/company-brain-capture-propose
git log --oneline -3                      # expect F1/F2 migration commit present
ls supabase/migrations/20260622140000_company_brain_foundation.sql
npm run typecheck
```

**Commit:** none (read-only baseline check). If `typecheck` is red on untouched code, STOP and report before building.

---

## Task 1 — `ObservationSummary` type + pure workflow-shape derivation  *(WEB, pure TS)*

The summary type and the on-device derivation live in a shared, pure module so both the Rust-driven on-device path (conceptually) and the cloud Zod schema agree on one shape, and so the workflow-shape pass is unit-testable without the desktop toolchain. Place it next to the existing local field-notes (it imports `ObserverEvent` and reuses `computeFieldNotes`).

**1a. Test first** — `apps/desktop/src/core/observation-summary.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { deriveWorkflowShapes, buildObservationSummary } from './observation-summary';
import type { ObserverEvent } from '@nibbin/redaction';

function ev(app: string, ts: string, durationMs = 1000): ObserverEvent {
  return {
    id: `${app}-${ts}`,
    ts,
    kind: 'snapshot',
    app: { name: app, bundle_id: `com.${app}` },
    window: { title_redacted: 'X' },
    input: { duration_ms: durationMs, keys: 1, clicks: 1 },
  } as unknown as ObserverEvent;
}

describe('deriveWorkflowShapes', () => {
  it('collapses same-app runs and counts length-2/3 app transitions only', () => {
    const events = [
      ev('Figma', '2026-06-20T09:00:00Z'),
      ev('Figma', '2026-06-20T09:01:00Z'), // collapsed
      ev('Slack', '2026-06-20T09:02:00Z'),
      ev('Figma', '2026-06-20T09:03:00Z'),
      ev('Slack', '2026-06-20T09:04:00Z'),
    ];
    const shapes = deriveWorkflowShapes(events);
    const fs = shapes.find((s) => s.pattern === 'Figma→Slack');
    expect(fs?.frequency).toBe(2);
    // no raw content anywhere in patterns — app names only
    for (const s of shapes) expect(s.pattern).not.toMatch(/[Xx]title|redacted|http/);
  });
});

describe('buildObservationSummary', () => {
  it('returns null below the floor (<10 events or <5min active)', () => {
    const summary = buildObservationSummary([ev('Figma', '2026-06-20T09:00:00Z')], 'study-1');
    expect(summary).toBeNull();
  });

  it('carries only structural fields and no raw event content', () => {
    const events = Array.from({ length: 12 }, (_, i) =>
      ev(i % 2 ? 'Slack' : 'Figma', `2026-06-20T09:${String(i).padStart(2, '0')}:00Z`, 40_000),
    );
    const summary = buildObservationSummary(events, 'study-1')!;
    expect(summary.study_id).toBe('study-1');
    expect(summary.total_events_reviewed).toBe(12);
    expect(summary.top_apps[0].name).toBeDefined();
    const json = JSON.stringify(summary);
    expect(json).not.toMatch(/title_redacted|label_redacted|bundle_id|"id"/);
  });
});
```

**1b. Implement** — `apps/desktop/src/core/observation-summary.ts`:

```ts
/**
 * On-device derivation of the ObservationSummary (P3, Option A). PURE math over
 * the post-privacy-review survivor events. C1/C7: only structural derivations
 * (app names, timing, transition shapes) — never any *_redacted content, URL,
 * keystroke text, or event ids — appear in the output. Nothing here does IO.
 */
import type { ObserverEvent } from '@nibbin/redaction';
import { computeFieldNotes, studyDaysWithActivity } from './field-notes';

export interface ObservationApp {
  name: string;
  durationMs: number;
  category?: string;
}

export interface WorkflowShape {
  pattern: string; // app-name transition only, e.g. "Figma→Slack"
  frequency: number;
}

export interface ObservationSummary {
  study_id: string;
  study_period: { start: string; end: string };
  total_events_reviewed: number;
  active_ms: number;
  top_apps: ObservationApp[];
  busiest_hour: number | null;
  workflow_shapes: WorkflowShape[];
  gap_count: number;
}

const MIN_EVENTS = 10;
const MIN_ACTIVE_MS = 5 * 60 * 1000;

/** Collapse runs of the same app, then count length-2 and length-3 transitions. */
export function deriveWorkflowShapes(events: ObserverEvent[]): WorkflowShape[] {
  const ordered = [...events]
    .filter((e) => e.kind !== 'capture_gap')
    .sort((a, b) => a.ts.localeCompare(b.ts))
    .map((e) => e.app.name);
  const collapsed: string[] = [];
  for (const name of ordered) {
    if (collapsed[collapsed.length - 1] !== name) collapsed.push(name);
  }
  const counts = new Map<string, number>();
  const bump = (k: string) => counts.set(k, (counts.get(k) ?? 0) + 1);
  for (let i = 0; i + 1 < collapsed.length; i++) {
    bump(`${collapsed[i]}→${collapsed[i + 1]}`);
    if (i + 2 < collapsed.length) bump(`${collapsed[i]}→${collapsed[i + 1]}→${collapsed[i + 2]}`);
  }
  return [...counts.entries()]
    .map(([pattern, frequency]) => ({ pattern, frequency }))
    .filter((s) => s.frequency > 1)
    .sort((a, b) => b.frequency - a.frequency)
    .slice(0, 5);
}

export function buildObservationSummary(
  events: ObserverEvent[],
  studyId: string,
): ObservationSummary | null {
  const real = events.filter((e) => e.kind !== 'capture_gap');
  const days = studyDaysWithActivity(events);
  let activeMs = 0;
  const apps = new Map<string, ObservationApp>();
  let busiest: number | null = null;
  let busiestCount = 0;
  const hours = new Map<number, number>();
  let gapCount = 0;
  for (const e of events) {
    if (e.kind === 'capture_gap') { gapCount++; continue; }
    const a = apps.get(e.app.name) ?? { name: e.app.name, durationMs: 0 };
    if (e.input) { a.durationMs += e.input.duration_ms; activeMs += e.input.duration_ms; }
    apps.set(e.app.name, a);
    const h = new Date(e.ts).getUTCHours();
    hours.set(h, (hours.get(h) ?? 0) + 1);
  }
  for (const [h, c] of hours) if (c > busiestCount) { busiest = h; busiestCount = c; }

  if (real.length < MIN_EVENTS || activeMs < MIN_ACTIVE_MS) return null;

  return {
    study_id: studyId,
    study_period: { start: days[0] ?? '', end: days[days.length - 1] ?? '' },
    total_events_reviewed: real.length,
    active_ms: activeMs,
    top_apps: [...apps.values()].sort((a, b) => b.durationMs - a.durationMs).slice(0, 5),
    busiest_hour: busiest,
    workflow_shapes: deriveWorkflowShapes(events),
    gap_count: gapCount,
  };
}
```
> `void computeFieldNotes;` is intentionally NOT called here — we recompute over the full survivor set (multi-day) rather than per-day; the import is kept for the busiest-hour parity reference and may be dropped if `typecheck` flags it as unused. Prefer dropping the unused import.

**1c. Run & commit:**
```bash
cd /c/nib-p3
npm run test -- apps/desktop/src/core/observation-summary.test.ts
npm run typecheck
git add apps/desktop/src/core/observation-summary.ts apps/desktop/src/core/observation-summary.test.ts
git commit -m "P3 Task 1: ObservationSummary type + pure on-device workflow-shape derivation"
```

---

## Task 2 — Cloud Zod schema + redaction-gate helper  *(WEB)*

A strict server-side schema mirroring `ObservationSummary`, plus the boundary-scan helper. Co-located so the route stays thin.

**2a. Test first** — `apps/web/lib/brain/observation-schema.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { parseObservationSummary, summaryIsClean } from './observation-schema';

const valid = {
  study_id: 's1',
  study_period: { start: '2026-06-20', end: '2026-06-21' },
  total_events_reviewed: 12,
  active_ms: 600000,
  top_apps: [{ name: 'Figma', durationMs: 400000, category: 'design' }],
  busiest_hour: 9,
  workflow_shapes: [{ pattern: 'Figma→Slack', frequency: 3 }],
  gap_count: 1,
};

describe('parseObservationSummary', () => {
  it('accepts a valid summary', () => {
    expect(parseObservationSummary(valid)?.study_id).toBe('s1');
  });
  it('rejects unexpected fields (strict) — guards against future raw-content leak', () => {
    expect(parseObservationSummary({ ...valid, ax_label: 'secret' })).toBeNull();
  });
  it('rejects missing required fields', () => {
    const { active_ms, ...bad } = valid;
    expect(parseObservationSummary(bad)).toBeNull();
  });
});

describe('summaryIsClean', () => {
  it('flags a payload that smuggles content matching a battery rule', () => {
    // an email address is a battery-matched token
    const dirty = { ...valid, top_apps: [{ name: 'leak@example.com', durationMs: 1 }] };
    expect(summaryIsClean(dirty)).toBe(false);
  });
  it('passes a clean structural summary', () => {
    expect(summaryIsClean(valid)).toBe(true);
  });
});
```

**2b. Implement** — `apps/web/lib/brain/observation-schema.ts`:

```ts
import { z } from 'zod';
import { batteryStillMatches } from '@nibbin/redaction';

const appSchema = z.object({
  name: z.string().min(1).max(120),
  durationMs: z.number().int().nonnegative(),
  category: z.string().max(60).optional(),
}).strict();

const shapeSchema = z.object({
  pattern: z.string().min(1).max(200),
  frequency: z.number().int().positive(),
}).strict();

export const observationSummarySchema = z.object({
  study_id: z.string().min(1).max(200),
  study_period: z.object({ start: z.string().max(40), end: z.string().max(40) }).strict(),
  total_events_reviewed: z.number().int().nonnegative(),
  active_ms: z.number().int().nonnegative(),
  top_apps: z.array(appSchema).max(20),
  busiest_hour: z.number().int().min(0).max(23).nullable(),
  workflow_shapes: z.array(shapeSchema).max(20),
  gap_count: z.number().int().nonnegative(),
}).strict();

export type ObservationSummary = z.infer<typeof observationSummarySchema>;

export function parseObservationSummary(body: unknown): ObservationSummary | null {
  const r = observationSummarySchema.safeParse(body);
  return r.success ? r.data : null;
}

/** Boundary scan: the battery must find NO residual sensitive token in the payload. */
export function summaryIsClean(summary: unknown): boolean {
  return batteryStillMatches(JSON.stringify(summary)) === null;
}
```

**2c. Run & commit:**
```bash
cd /c/nib-p3
npm run test -- apps/web/lib/brain/observation-schema.test.ts
npm run typecheck
git add apps/web/lib/brain/observation-schema.ts apps/web/lib/brain/observation-schema.test.ts
git commit -m "P3 Task 2: strict ObservationSummary Zod schema + battery boundary-scan helper"
```

---

## Task 3 — Cloud proposal derivation (small constrained Claude call → 0–3 proposals)  *(WEB)*

Pure function (dependency-injected `Generate`) that maps a summary to `{ field_key, value, rationale }[]`, constrained to `MEMORY_SECTIONS` keys, never `hard_rules`, returns `[]` on thin data / no model / parse failure. Each value is battery-scanned by the caller (Task 4), but we also drop obvious non-conformers here.

**3a. Test first** — `apps/web/lib/brain/derive-proposals.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { deriveProposalsFromObservation } from './derive-proposals';
import type { ObservationSummary } from './observation-schema';

const summary: ObservationSummary = {
  study_id: 's1',
  study_period: { start: '2026-06-20', end: '2026-06-21' },
  total_events_reviewed: 40,
  active_ms: 3_600_000,
  top_apps: [{ name: 'Figma', durationMs: 3_000_000, category: 'design' }],
  busiest_hour: 9,
  workflow_shapes: [{ pattern: 'Figma→Slack', frequency: 6 }],
  gap_count: 0,
};

describe('deriveProposalsFromObservation', () => {
  it('returns [] when no model is configured', async () => {
    expect(await deriveProposalsFromObservation(summary, null)).toEqual([]);
  });

  it('parses a valid model response, dropping unknown field_keys and hard_rules', async () => {
    const gen = async () => ({
      text: JSON.stringify([
        { field_key: 'facts', value: 'Design is the primary daily focus.', rationale: 'Most time in Figma.' },
        { field_key: 'hard_rules', value: 'never', rationale: 'x' },     // dropped
        { field_key: 'not_a_section', value: 'x', rationale: 'x' },       // dropped
      ]),
      usage: { input_tokens: 1, output_tokens: 1 },
    });
    const out = await deriveProposalsFromObservation(summary, gen as never);
    expect(out).toHaveLength(1);
    expect(out[0].field_key).toBe('facts');
  });

  it('returns [] on a non-JSON / garbage model response (graceful)', async () => {
    const gen = async () => ({ text: 'sorry', usage: { input_tokens: 1, output_tokens: 1 } });
    expect(await deriveProposalsFromObservation(summary, gen as never)).toEqual([]);
  });
});
```

**3b. Implement** — `apps/web/lib/brain/derive-proposals.ts`:

```ts
import 'server-only';
import { z } from 'zod';
import type { Generate } from '@nibbin/router';
import { MEMORY_SECTIONS } from '../grove/memory';
import type { ObservationSummary } from './observation-schema';

export interface CaptureProposal {
  field_key: string;
  value: string;
  rationale: string;
}

const ALLOWED = new Set(MEMORY_SECTIONS.map((s) => s.key)); // facts/pricing/policies/faq/voice — never hard_rules

const modelOut = z.array(z.object({
  field_key: z.string(),
  value: z.string().min(1).max(6000),
  rationale: z.string().max(2000),
})).max(3);

const SYSTEM = [
  'You convert a STRUCTURAL summary of observed work patterns into 1-3 brief additions to the',
  "user's business memory. You may reference only PATTERNS (recurring apps, timing, workflow",
  'shapes) — never a specific moment, file, message, or person. Output ONLY JSON:',
  '[{"field_key","value","rationale"}]. field_key must be one of: facts, pricing, policies, faq, voice.',
  'Never propose to hard_rules. Never include raw content. If the summary is too thin for a',
  'confident proposal, output []. Keep each value under 240 characters.',
].join(' ');

/** Pattern-level proposals from a summary. Returns [] on no-model / thin / unparseable. */
export async function deriveProposalsFromObservation(
  summary: ObservationSummary,
  generate: Generate | null,
): Promise<CaptureProposal[]> {
  if (!generate) return [];
  let raw: { text: string };
  try {
    raw = await generate({
      system: SYSTEM,
      messages: [{ role: 'user', content: JSON.stringify(summary) }],
      maxTokens: 600,
      tier: 'small',
    } as never);
  } catch {
    return [];
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw.text.trim());
  } catch {
    return [];
  }
  const r = modelOut.safeParse(parsed);
  if (!r.success) return [];
  return r.data.filter((p) => ALLOWED.has(p.field_key));
}
```
> The exact `generate(...)` argument shape must match `Generate` from `@nibbin/router` — mirror an existing caller (`apps/web/lib/llm/synthesis.ts` or `understanding.ts`) when wiring; the `as never` casts in the test/impl are placeholders to be tightened to the real signature during implementation. Keep `tier`/`maxTokens` aligned with a small, cheap call (cost-auditor will check this).

**3c. Run & commit:**
```bash
cd /c/nib-p3
npm run test -- apps/web/lib/brain/derive-proposals.test.ts
npm run typecheck
git add apps/web/lib/brain/derive-proposals.ts apps/web/lib/brain/derive-proposals.test.ts
git commit -m "P3 Task 3: cloud proposal derivation (constrained small model call, [] on thin/no-model)"
```

---

## Task 4 — `POST /api/brain/propose-from-capture` route  *(WEB)*

Orchestration: auth → strict parse → boundary scan → insert `sources(observation)` → derive proposals → per-proposal battery scan → `propose_memory_change(origin='capture')`. Extract the orchestration into a testable core (DI'd service client + generate) so it runs under vitest without a live route.

**4a. Test first** — `apps/web/lib/brain/propose-from-capture.test.ts` (tests the core, not the Next handler):

```ts
import { describe, it, expect, vi } from 'vitest';
import { proposeFromCaptureCore } from './propose-from-capture';

function fakeSvc(opts: { sourceId?: string } = {}) {
  const calls: Array<{ fn: string; args: unknown }> = [];
  const svc = {
    calls,
    from: () => ({
      insert: () => ({ select: () => ({ single: async () => ({ data: { id: opts.sourceId ?? 'src-1' }, error: null }) }) }),
    }),
    rpc: async (fn: string, args: unknown) => { calls.push({ fn, args }); return { data: 'prop-' + calls.length, error: null }; },
  };
  return svc as never;
}

describe('proposeFromCaptureCore', () => {
  const summary = {
    study_id: 's1', study_period: { start: '2026-06-20', end: '2026-06-21' },
    total_events_reviewed: 40, active_ms: 3_600_000,
    top_apps: [{ name: 'Figma', durationMs: 3_000_000 }],
    busiest_hour: 9, workflow_shapes: [{ pattern: 'Figma→Slack', frequency: 6 }], gap_count: 0,
  };

  it('writes a source then one propose_memory_change per derived proposal', async () => {
    const svc = fakeSvc();
    const generate = (async () => ({ text: JSON.stringify([{ field_key: 'facts', value: 'Design-led.', rationale: 'r' }]) })) as never;
    const out = await proposeFromCaptureCore('acct-1', summary, svc, generate);
    expect(out.source_id).toBe('src-1');
    expect(out.proposal_ids).toHaveLength(1);
    const rpc = (svc as never as { calls: { fn: string; args: { p_origin: string } }[] }).calls[0];
    expect(rpc.fn).toBe('propose_memory_change');
    expect(rpc.args.p_origin).toBe('capture');
  });

  it('still writes the source but emits no proposals when derivation returns []', async () => {
    const svc = fakeSvc();
    const out = await proposeFromCaptureCore('acct-1', summary, svc, null);
    expect(out.source_id).toBe('src-1');
    expect(out.proposal_ids).toHaveLength(0);
  });

  it('drops a proposal whose value fails the battery scan', async () => {
    const svc = fakeSvc();
    const generate = (async () => ({ text: JSON.stringify([{ field_key: 'facts', value: 'email me leak@example.com', rationale: 'r' }]) })) as never;
    const out = await proposeFromCaptureCore('acct-1', summary, svc, generate);
    expect(out.proposal_ids).toHaveLength(0);
  });
});
```

**4b. Implement core** — `apps/web/lib/brain/propose-from-capture.ts`:

```ts
import 'server-only';
import type { Generate } from '@nibbin/router';
import { batteryStillMatches } from '@nibbin/redaction';
import type { ObservationSummary } from './observation-schema';
import { deriveProposalsFromObservation } from './derive-proposals';

export interface ProposeFromCaptureResult { source_id: string; proposal_ids: string[]; }

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function proposeFromCaptureCore(
  accountId: string,
  summary: ObservationSummary,
  svc: any,
  generate: Generate | null,
): Promise<ProposeFromCaptureResult> {
  // 1. Source row — origin carries ONLY structural fields from the summary.
  const { data: src, error: srcErr } = await svc
    .from('sources')
    .insert({
      account_id: accountId,
      kind: 'observation',
      title: `Field Study — ${summary.study_period.start}`,
      origin: {
        study_id: summary.study_id,
        active_ms: summary.active_ms,
        top_apps: summary.top_apps,
        workflow_shapes: summary.workflow_shapes,
        busiest_hour: summary.busiest_hour,
      },
      source_tier: 40,
      redaction_status: 'clean',
      captured_at: new Date().toISOString(),
    })
    .select('id')
    .single();
  if (srcErr || !src) throw new Error('source_insert_failed');
  const sourceId: string = src.id;

  // 2. Derive 0-3 pattern proposals.
  const proposals = await deriveProposalsFromObservation(summary, generate);

  // 3. Per proposal: battery-scan the value, then service-role propose (append).
  const proposalIds: string[] = [];
  for (const p of proposals) {
    if (batteryStillMatches(p.value) !== null) continue; // silent drop (§11)
    const { data: id, error } = await svc.rpc('propose_memory_change', {
      p_account: accountId,
      p_field_key: p.field_key,
      p_op: 'append',
      p_value: p.value,
      p_rationale: p.rationale,
      p_source_id: sourceId,
      p_origin: 'capture',
    });
    if (!error && id) proposalIds.push(id as string);
  }
  return { source_id: sourceId, proposal_ids: proposalIds };
}
```

**4c. Implement the route** — `apps/web/app/api/brain/propose-from-capture/route.ts` (mirror `/api/study/packet/route.ts` auth):

```ts
import { NextResponse, type NextRequest } from 'next/server';
import { serviceClient } from '../../../../lib/supabase/service';
import { clientForRequest } from '../../../../lib/auth/desktop-client';
import { ensureAccount } from '../../../../lib/auth/bootstrap';
import { upsertOwnProfile } from '../../../../lib/auth/profile';
import { anthropicGenerate } from '../../../../lib/llm/client';
import { parseObservationSummary, summaryIsClean } from '../../../../lib/brain/observation-schema';
import { proposeFromCaptureCore } from '../../../../lib/brain/propose-from-capture';

export async function POST(req: NextRequest): Promise<NextResponse> {
  const supabase = await clientForRequest(req);
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  let accountId: string;
  try {
    accountId = await ensureAccount({
      getEmail: async () => user.email ?? null,
      ensureProfile: () => upsertOwnProfile(supabase, user),
      bootstrap: async (name) => {
        const { data, error } = await supabase.rpc('bootstrap_account', { account_name: name });
        if (error) throw error;
        return data as string;
      },
    });
  } catch { return NextResponse.json({ error: 'account' }, { status: 500 }); }

  const len = Number(req.headers.get('content-length') ?? 0);
  if (len > 64_000) return NextResponse.json({ error: 'too_large' }, { status: 413 });

  let body: unknown;
  try { body = await req.json(); } catch { return NextResponse.json({ error: 'bad_request' }, { status: 400 }); }

  const summary = parseObservationSummary(body);
  if (!summary) return NextResponse.json({ error: 'invalid_summary' }, { status: 400 });
  if (!summaryIsClean(summary)) return NextResponse.json({ error: 'quarantined' }, { status: 422 });

  try {
    const result = await proposeFromCaptureCore(accountId, summary, serviceClient(), anthropicGenerate());
    return NextResponse.json(result);
  } catch {
    return NextResponse.json({ error: 'propose_failed' }, { status: 500 });
  }
}
```

**4d. Run & commit:**
```bash
cd /c/nib-p3
npm run test -- apps/web/lib/brain/propose-from-capture.test.ts
npm run typecheck
git add apps/web/lib/brain/propose-from-capture.ts apps/web/lib/brain/propose-from-capture.test.ts apps/web/app/api/brain/propose-from-capture/route.ts
git commit -m "P3 Task 4: /api/brain/propose-from-capture route + DI'd orchestration core"
```

---

## Task 5 — Rust Tauri commands `derive_observation_summary` + `finalize_review`  *(DESKTOP — REQUIRES Rust+MSVC toolchain)*

> **TOOLCHAIN GATE.** This task needs Rust + MSVC + Strawberry Perl + NASM (per `project_nibbin_desktop_local_build`). If unavailable, SKIP and leave the bridge fallback (Task 6) in place — the web track ships independently; the bridge degrades to its `call<T>` fallback. Re-do this task on a machine with the toolchain before desktop release.

Locate the Tauri command surface (the handlers backing `review_events` / `review_delete` / `send_control` in the bridge) under `apps/desktop/src-tauri/src/`. Add two commands.

**5a. Test first** (Rust unit test, co-located in the command module): a `derive_observation_summary` that runs over the in-memory survivor set and returns `Option<ObservationSummary>` (mirror the TS floor: `< 10` events or `< 5min` active → `None`). Assert: (a) below-floor input → `None`; (b) a valid set yields a summary whose serialized JSON contains no `label_redacted` / `title_redacted` / `url` / event-id substrings; (c) `workflow_shapes` only contains `app.name` transitions.

```rust
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn below_floor_returns_none() { assert!(derive_summary(&few_events()).is_none()); }
    #[test]
    fn summary_has_no_raw_content() {
        let s = derive_summary(&many_events()).unwrap();
        let json = serde_json::to_string(&s).unwrap();
        for needle in ["label_redacted", "title_redacted", "\"url\"", "\"id\""] {
            assert!(!json.contains(needle), "leaked: {needle}");
        }
    }
}
```

**5b. Implement:**
- `#[tauri::command] async fn derive_observation_summary(state) -> Option<ObservationSummary>` — read the post-review survivor events from the same store `review_events` reads (events NOT marked `user_deleted`), run the Rust port of `buildObservationSummary` (struct fields identical to Task 1 / Task 2 schema). Pure, no IO beyond the local store read.
- `#[tauri::command] async fn finalize_review(state, app) -> FinalizeResult` sequencing per spec §9:
  1. flush pending deletions (same path `review_delete` uses);
  2. mark study `COMPLETE` (same path the `stop_early`/complete control verb uses);
  3. `derive_observation_summary()`;
  4. if `Some`, POST the summary to the web app's `/api/brain/propose-from-capture` using the keychain access token (reuse the `upload_packet` HTTP path). **Fire-and-forget for the UX**: return `FinalizeResult { proposals_requested: bool }` as soon as the POST is dispatched; do NOT block the command on proposal generation. On any upload error, swallow it (study already complete; §8.1 "silently no-ops").
- Register both commands in the Tauri `invoke_handler!` list.

**5c. Run & commit:**
```bash
cd /c/nib-p3/apps/desktop/src-tauri
cargo test
cargo build
cd /c/nib-p3
git add apps/desktop/src-tauri
git commit -m "P3 Task 5: Rust derive_observation_summary + finalize_review Tauri commands (no raw content leaves device)"
```

---

## Task 6 — Bridge methods `deriveObservationSummary` + `finalizeReview`  *(WEB)*

Add the two methods to `desktopBridge` in `apps/web/lib/desktop/bridge.ts`, using the existing `call<T>` graceful-degrade helper so the web build/tests pass with or without the Rust commands registered.

**6a. Test first** — `apps/web/lib/desktop/bridge.test.ts` (extend or create): in a plain (non-shell) env, `desktopBridge.finalizeReview()` resolves to the fallback (`{ proposals_requested: false }`) and `deriveObservationSummary()` resolves to `null` — never throws.

```ts
import { describe, it, expect } from 'vitest';
import { desktopBridge } from './bridge';

describe('desktopBridge P3 methods (non-shell fallback)', () => {
  it('finalizeReview returns inert fallback off-shell', async () => {
    await expect(desktopBridge.finalizeReview()).resolves.toEqual({ proposals_requested: false });
  });
  it('deriveObservationSummary returns null off-shell', async () => {
    await expect(desktopBridge.deriveObservationSummary()).resolves.toBeNull();
  });
});
```

**6b. Implement** — add to `bridge.ts` (import the type from the shared module; add a `FinalizeResult` interface):

```ts
import type { ObservationSummary } from '../../../desktop/src/core/observation-summary';

export interface FinalizeResult { proposals_requested: boolean; }

// inside desktopBridge:
  /** Run the on-device pattern derivation over post-review survivor events. */
  deriveObservationSummary(): Promise<ObservationSummary | null> {
    return call<ObservationSummary | null>('derive_observation_summary', undefined, null);
  },

  /** Flush deletions → complete study → derive → upload summary (fire-and-forget). */
  finalizeReview(): Promise<FinalizeResult> {
    return call<FinalizeResult>('finalize_review', undefined, { proposals_requested: false });
  },
```
> If importing across the `apps/desktop` boundary trips `apps/web` tsconfig `rootDir`/path settings, instead re-declare a minimal `ObservationSummary` interface locally in `bridge.ts` (structural match) — the bridge already declares its own shims for cross-boundary types; do not add a project reference just for this.

**6c. Run & commit:**
```bash
cd /c/nib-p3
npm run test -- apps/web/lib/desktop/bridge.test.ts
npm run typecheck
git add apps/web/lib/desktop/bridge.ts apps/web/lib/desktop/bridge.test.ts
git commit -m "P3 Task 6: bridge deriveObservationSummary + finalizeReview (graceful off-shell fallback)"
```

---

## Task 7 — "Done — save what I kept" button on `/app/study/review`  *(WEB)*

Additive primary CTA at the bottom of `ReviewContent` (the existing delete-individual interactions are unchanged). On click: call `desktopBridge.finalizeReview()`, show a brief inline "Learning from your study…" affordance, then navigate to `/app/memory?from_study=1` (the Memory page reads that param to show the banner — Task 8). Async per the decision: do NOT block on proposal generation; the nudge appears when proposals land. On `{ proposals_requested: false }` or any error → navigate to `/app/memory` with no banner param.

**7a. Test first** — `apps/web/app/app/study/review/review-cta.test.tsx` (React Testing Library; mock `desktopBridge` + `next/navigation` `useRouter`):

```ts
// Assert:
// - the "Done — save what I kept" button renders
// - clicking it calls desktopBridge.finalizeReview() exactly once
// - on { proposals_requested: true } → router.push('/app/memory?from_study=1')
// - on { proposals_requested: false } → router.push('/app/memory')
// - finalizeReview rejecting does NOT throw to the user; still navigates to '/app/memory'
```

**7b. Implement** — in `apps/web/app/app/study/review/page.tsx`: add `useRouter`, a `finalizing` state, and a footer `<Button variant="primary">`:

```tsx
const router = useRouter();
const [finalizing, setFinalizing] = useState(false);

const handleDone = useCallback(async () => {
  setFinalizing(true);
  try {
    const res = await desktopBridge.finalizeReview();
    router.push(res.proposals_requested ? '/app/memory?from_study=1' : '/app/memory');
  } catch {
    router.push('/app/memory');
  }
}, [router]);

// …render below the exclusion card:
<Button variant="primary" onClick={() => void handleDone()} disabled={finalizing}>
  {finalizing ? 'Learning from your study…' : 'Done — save what I kept'}
</Button>
```

**7c. Run & commit:**
```bash
cd /c/nib-p3
npm run test -- apps/web/app/app/study/review/review-cta.test.tsx
npm run typecheck
git add apps/web/app/app/study/review/page.tsx apps/web/app/app/study/review/review-cta.test.tsx
git commit -m "P3 Task 7: 'Done — save what I kept' review CTA → finalizeReview → Memory page"
```

---

## Task 8 — Memory page: capture-origin tag + "N suggestion(s)" banner  *(WEB)*

In the F2 review-queue rendering on the Memory page (`apps/web/app/app/memory/*`): (a) render a "From your Field Study" origin badge for proposals where `origin='capture'` (distinct from doc/manual), with an affordance linking back to the linked study via `source_id` → `sources.origin.study_id`; (b) when `?from_study=1` is present and there are pending capture proposals, show the banner "Your Nibbin found N thing(s) to add to your memory — ready when you are."

> First locate where the F2 review queue is read/rendered on the Memory page (P1 may not yet exist in this worktree). If the F2 review-queue surface is NOT yet present here, scope this task to: (1) the origin-tag rendering helper + its unit test, and (2) the banner component + its unit test, both as standalone testable units, and wire them where the queue lands. **Do not build the whole F2 queue UI** — that is P1; only the capture-specific tag + banner are P3's.

**8a. Test first** — `apps/web/app/app/memory/capture-tag.test.tsx`:

```ts
// originLabel('capture') === 'From your Field Study'
// originLabel('doc_extract') === 'From a document'  (or existing P1 label; match P1 if present)
// <CaptureBanner count={2} /> renders "found 2 things"; count={1} renders "1 thing"; count={0} renders null
```

**8b. Implement** the `originLabel(origin)` helper + `<CaptureBanner count>` component; wire into the queue render + read `searchParams.from_study`.

**8c. Run & commit:**
```bash
cd /c/nib-p3
npm run test -- apps/web/app/app/memory/capture-tag.test.tsx
npm run typecheck
git add apps/web/app/app/memory
git commit -m "P3 Task 8: capture-origin tag + post-study suggestions banner on Memory page"
```

---

## Task 9 — RLS / end-to-end propose→ratify test + adversarial gate  *(WEB; DB-backed)*

Prove the cloud path end-to-end against the F1/F2 schema using the existing `RlsHarness`, then run the privacy-sensitive-path adversarial gate.

**9a. Test** — `tests/rls/company-brain-capture-propose.test.ts` (model on `tests/rls/company-brain-foundation.test.ts`; self-skips when no DB):
- service-role: insert a `sources(kind='observation', source_tier=40)` row for account A → readable by member A, NOT by B (cross-account isolation).
- service-role: `propose_memory_change(A, 'facts', 'append', 'Design-led.', 'r', source_id, 'capture')` → returns a proposal id; a `review_item` notification row exists for A.
- member A: `decide_memory_proposal(id, 'approved')` → `grove_memory` `facts` updated (append), `grove_memory_history(change_source='proposal')` row, `field_evidence(field_key='facts', source_id)` link, `audit_log` ratification row, notification resolved (inherited from F2 — this is the P3 e2e proof).
- member B cannot `decide_memory_proposal` A's proposal (not a member → raises).
- a `proposals` row with `origin='capture'` is accepted by the CHECK (regression that F1/F2 already allows it — no migration needed).

```bash
cd /c/nib-p3
npm run test -- tests/rls/company-brain-capture-propose.test.ts
```

**9b. Full suite + typecheck:**
```bash
cd /c/nib-p3
npm run test
npm run typecheck
git add tests/rls/company-brain-capture-propose.test.ts
git commit -m "P3 Task 9: end-to-end capture→propose→ratify RLS test (observation source, origin='capture')"
```

**9c. Adversarial gate** (privacy-sensitive data path — required before merge): run the 4-reviewer gate (red-team / claims-auditor / logic-skeptic / cost-auditor). Focus areas:
- **red-team:** can any raw event field reach the cloud (route payload, `sources.origin`, `proposals`, logs)? Try a malicious bridge payload with extra fields (must 400) and a content-smuggling value (must 422 / silent-drop).
- **claims-auditor:** verify "no raw content leaves device" against the actual Rust serialization (Task 5) AND the route (Tasks 2/4), not the summary.
- **logic-skeptic:** `[]`/no-API-key/error paths emit no notification and surface no error; the source row still persists.
- **cost-auditor:** confirm the derivation is one small, capped call per completed study and `anthropicGenerate()===null` short-circuits to `[]`.

Write the gate report to `docs/gates/2026-06-23-capture-propose.md`, address findings, commit.

---

## Task 10 — Land  *(WEB)*

```bash
cd /c/nib-p3
git fetch origin && git rebase origin/main      # main is PR-protected; rebase before PR
npm run test && npm run typecheck
gh pr create --base main --title "P3 — Passive-capture propose loop" --body "<summary + gate link>"
```
Land via PR with the 4 CI checks green. **No migration to apply** (P3 ships none).

---

## Risks / forks

- **Toolchain split is real.** Tasks 5 + 7-validation of the live native path need the Rust+MSVC toolchain. The plan is structured so Tasks 1–4, 6, 8, 9 (the entire cloud + web surface) are built and proven under vitest/`tests/rls` independently; the Rust command (Task 5) is the only piece that strictly needs the desktop build, and the bridge's `call<T>` fallback keeps the web build/tests green without it. **Fork:** if no Rust machine is available, ship the web track and tag Task 5 as a follow-up before desktop release.
- **`Generate` signature drift.** Task 3's model call argument shape (`system`/`messages`/`tier`/`maxTokens`) is written against the spec, not verified against `@nibbin/router`'s exact `Generate` type. Mirror an existing caller (`apps/web/lib/llm/synthesis.ts`) during implementation; tighten the `as never` casts.
- **Memory F2 queue UI may not exist in this worktree (P1 not landed).** Task 8 is scoped to only the capture-specific tag + banner as standalone units; if the queue render site is absent, wire-up is deferred to P1 and Task 8 ships the units + tests. **Do not build the F2 queue UI here.**
- **Cross-boundary type import** (`apps/web` importing `apps/desktop`'s `ObservationSummary`) may trip tsconfig boundaries → fall back to a local structural re-declaration in `bridge.ts` (Task 6 note).
- **Battery false-positives.** `batteryStillMatches` could flag a legitimate app name (e.g. an app literally named with an email-like token). Acceptable: it errs toward dropping a proposal / quarantining, never toward leaking. Note for the gate.
```