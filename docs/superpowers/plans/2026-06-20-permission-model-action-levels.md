# Permission Model — Action Levels + Agent School as Grade — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace Agent-School stage-gating with a per-Nibbin owner-set **action level** (Observe / Draft / Send) as the sole execution gate; reposition Agent School as an advisory **grade**; collapse email's two write capabilities into one; mirror drafts into native-draft apps (Gmail) with delete-sync; and rewrite all user-facing copy to match.

**Architecture:** A new `nibbins.action_level` column becomes the single gate read in `runner.ts dispatchStep` (replacing `gateSideEffect` + `hasGrant`). `school.ts`'s `promotionCheck`/grade math stays (advisory only). The executor mirrors drafts to Gmail at the Draft level and sends at the Send level. A segmented control sets the level; a non-blocking warning fires when Send is set on a sub-Graduate Nibbin.

**Tech Stack:** TypeScript, Next.js 15 App Router (`apps/web`), Supabase (migrations + RPC), Vitest, npm workspaces. Runtime in `packages/runtime`, connectors in `packages/connectors`.

## Global Constraints

- **Branch:** `main` is PR-protected — work on `feature/action-levels` (fresh worktree off latest `origin/main`); land via `gh pr create --base main`.
- **The action level is the ONLY execution gate.** `observe` → no output; `draft` → draft (+ native mirror for Gmail); `send` → execute. **Identical at every grade** — a Student/Egg with `send` executes. Stage/grade must NOT gate execution anywhere.
- **Retained safety walls (do NOT remove):** idempotency claim, send-velocity caps, resource-claim conflict locks, scope-held-at-connect, vault-only tokens, quarantine, same-origin redirects. They must still contain an `Egg+Send` Nibbin.
- **Default action level = `draft`.** `send` is always an explicit owner choice; the UI **warns but never blocks** on Send-for-sub-Graduate.
- **Drafting needs no grant/scope beyond connect:** creating a Gmail draft uses the compose scope held at connect.
- **Migration preserves effective behavior:** existing write-grant-holders → `send`; everyone else → `draft`.
- **Copy rule:** no surviving "earns the right to act / Agent School unlocks / read-only-until / draft-then-send ladder / untrained can't act" language. New framing: "you grant the actions (Observe/Draft/Send); Agent School grades how well it's doing."
- **Verification before PR:** `npm run lint`, `npm run typecheck`, full `npx vitest run`, `npm run build`. (`@nibbin/*` "missing export" tsc errors in a worktree are stale-dist false-positives — verify the symbol exists in worktree src + is re-exported, then trust CI.)
- **Adversarial gate REQUIRED** (write/grant/runtime surface + a changed safety model): 4-reviewer gate → `docs/gates/2026-06-20-action-levels.md`.

---

## File Structure

**New:**
- `supabase/migrations/<ts>_nibbin_action_level.sql` — `action_level` column + backfill.
- `apps/web/components/ui/SegmentedControl.tsx` (+ css) — 3-state design-system control.
- `apps/web/app/app/nibbins/action-level-actions.ts` — `setNibbinActionLevel` server action.

**Modified (runtime):**
- `packages/runtime/src/runner.ts` — `dispatchStep` gate → action level.
- `packages/runtime/src/school.ts` — `gateSideEffect` retired from the gate path (grade math kept).
- `packages/runtime/src/capabilities.ts` — collapse email write; `nativeDraft` flag; drop `draft` sideEffect.
- `apps/web/lib/runtime/stores.ts` — `getNibbin` returns `actionLevel`; Gmail draft store methods.
- `apps/web/lib/runtime/engine.ts` — draft-level native mirror; single email write send.
- `packages/connectors/src/connectors/gmail.ts` — `deleteDraft`, `sendDraft`.
- `apps/web/lib/connections/grants.ts` — collapse `WriteCapability`/`CapabilityTier`.

**Modified (UI + copy):**
- `apps/web/app/app/nibbins/NibbinControls.tsx` (+ a new ActionLevel control), nibbin detail/roster.
- Copy surfaces (Task 8): `app/page.tsx`, `app/about/page.tsx`, `app/app/nibbins/page.tsx`, `(marketing)/MayaDemo.tsx`, `app/app/hatch/HatchWizard.tsx`, `app/app/hatch/page.tsx`, `lib/help/content.ts`, `docs/help-compendium.md`, `packages/keeper/src/copy.ts`, `reference/*.html`, `README*`, `docs/INVARIANTS.md` (C8), `SPEC.md`.

---

## Task 1: `action_level` column + `getNibbin`

**Files:**
- Create: `supabase/migrations/<ts>_nibbin_action_level.sql`
- Modify: `apps/web/lib/runtime/stores.ts:109-122` (`getNibbin`) + the `NibbinCurrentState` type
- Test: `tests/rls/action-level.test.ts` (or extend an existing runtime store test)

**Interfaces:**
- Produces: `nibbins.action_level` enum(`observe`|`draft`|`send`), default `draft`; `getNibbin(id)` returns `{ stage, stageChangedAt, status, actionLevel }`.

- [ ] **Step 1: Write the migration**

```sql
-- supabase/migrations/<ts>_nibbin_action_level.sql
alter table public.nibbins
  add column action_level text not null default 'draft'
  check (action_level in ('observe', 'draft', 'send'));

-- Backfill: any Nibbin currently holding an active write grant keeps acting (send);
-- everyone else drafts. Preserves today's effective behavior.
update public.nibbins n
set action_level = 'send'
where exists (
  select 1 from public.nibbin_write_grants g
  where g.nibbin_id = n.id and g.revoked_at is null
);
```

- [ ] **Step 2: Apply to the three DBs** (dev `oqnqzytctwlptfdvyagl`, staging `swbbydpuiilnamnyhwnr`, prod `oaymttudfazqaqequrke`) via the Supabase apply_migration tool. Expected: success on all three.

- [ ] **Step 3: Write the failing test for `getNibbin` returning `actionLevel`**

```typescript
// asserts the store reads the new column
it('getNibbin returns the action level', async () => {
  // seed a nibbin with action_level='send' (via direct insert in the test harness)
  const state = await store.getNibbin(seededNibbinId);
  expect(state?.actionLevel).toBe('send');
});
```

- [ ] **Step 4: Run it — FAIL** (`actionLevel` undefined). `npx vitest run tests/rls/action-level.test.ts`

- [ ] **Step 5: Extend `getNibbin` + `NibbinCurrentState`**

In `apps/web/lib/runtime/stores.ts`, add `action_level` to the select and the return; add `actionLevel: 'observe'|'draft'|'send'` to `NibbinCurrentState`:

```typescript
const { data, error } = await this.svc
  .from('nibbins')
  .select('stage, stage_changed_at, status, action_level')
  .eq('id', nibbinId)
  .maybeSingle();
// ...
return {
  stage: data.stage as NibbinCurrentState['stage'],
  stageChangedAt: new Date(data.stage_changed_at as string).getTime(),
  status: data.status as NibbinCurrentState['status'],
  actionLevel: data.action_level as NibbinCurrentState['actionLevel'],
};
```
Add `actionLevel` to `NibbinCurrentState` in the `RunStore`/types definition (find via `grep -n "NibbinCurrentState" packages/runtime apps/web`).

- [ ] **Step 6: Run it — PASS.** Commit.

```bash
git add supabase/migrations apps/web/lib/runtime/stores.ts packages/runtime/src tests/rls/action-level.test.ts
git commit -m "feat(runtime): add nibbins.action_level + getNibbin reads it"
```

---

## Task 2: `dispatchStep` gates on action level (core runtime change)

**Files:**
- Modify: `packages/runtime/src/runner.ts:288-318` (the gate region)
- Modify: `packages/runtime/src/school.ts` (retire `gateSideEffect` from the gate path; keep grade math)
- Test: `packages/runtime/test/runner-invariants.test.ts`

**Interfaces:**
- Consumes: `freshNibbin.actionLevel` (Task 1).
- Behavior: gate decided by action level, not stage. `observe`→no output; `draft`→draft; `send`→execute. `hasGrant` removed from the gate.

- [ ] **Step 1: Write failing tests proving stage no longer gates**

In `runner-invariants.test.ts`, add (using the harness's nibbin builder + action level):
```typescript
it('Egg + Send executes (stage no longer gates)', async () => {
  const out = await executeRun(nibbinAt('egg', { actionLevel: 'send' }), TRIGGER, sendStep, deps);
  expect(out.kind).toBe('executed');
});
it('Graduate + Draft drafts (action level overrides grade)', async () => {
  const out = await executeRun(nibbinAt('grad', { actionLevel: 'draft' }), TRIGGER, sendStep, deps);
  expect(out.kind).toBe('drafted');
});
it('Observe produces no output at any stage', async () => {
  const out = await executeRun(nibbinAt('senior', { actionLevel: 'observe' }), TRIGGER, sendStep, deps);
  expect(out.kind).toBe('kill'); // observe = no draft, no execute
});
```
(Adapt `nibbinAt`/`executeRun`/`sendStep` to the harness; the action level must thread through `getNibbin`.)

- [ ] **Step 2: Run — FAIL** (Egg currently denies; Graduate currently executes). `npx vitest run packages/runtime/test/runner-invariants.test.ts -t "action level"`

- [ ] **Step 3: Replace the gate logic in `dispatchStep`**

Replace lines ~301-318 (the `gateSideEffect` call, the `hasGrant` re-gate, keep the draft-record + execute blocks) with an action-level decision off `freshNibbin.actionLevel`:

```typescript
// Action level is the sole execution gate (owner-set). Grade does not gate.
// `step.presentation` steps are always drafts (they're proposals by construction).
const level = freshNibbin.actionLevel;
let gate: { action: 'execute' } | { action: 'draft'; reason: string } | { action: 'deny'; reason: string };
if (step.presentation || level === 'draft') {
  gate = { action: 'draft', reason: 'level' };
} else if (level === 'observe') {
  gate = { action: 'deny', reason: 'observe' };
} else {
  gate = { action: 'execute' }; // level === 'send'
}

if (gate.action === 'deny') return done({ kind: 'kill', reason: gate.reason });
// (draft block and execute block below are UNCHANGED — they already record/execute correctly)
```
Remove the now-unused `routineApprovals`/`gateSideEffect`/`hasGrant` lines from this function. (`deps.grants`/`deps.routines` may remain on `RunnerDeps` for other callers; confirm with `grep -rn "gateSideEffect\|\.hasGrant(" packages apps` — if `dispatchStep` was the only `gateSideEffect` caller, leave the function exported for the grade explainer but unused here.)

- [ ] **Step 4: Run — PASS** (the three new tests + the existing suite). Watch for existing tests that asserted stage-gating — they now encode the OLD model; update them to set `actionLevel` explicitly and assert the new behavior, noting the change.

- [ ] **Step 5: Confirm the retained walls still fire under Egg+Send** — add a test: `Egg + Send` still dedupes on idempotency and still blocks on a held resource claim and still respects velocity. `npx vitest run packages/runtime/test/runner-invariants.test.ts`

- [ ] **Step 6: Commit.**

```bash
git commit -am "feat(runtime): action level is the sole execution gate; Agent School no longer gates"
```

---

## Task 3: Collapse email write to one capability

**Files:**
- Modify: `packages/runtime/src/capabilities.ts:108-121` (+ `sideEffect` union ~line 43)
- Modify: email/stripe primitives that yield `email.draft` (`grep -rln "'email.draft'" packages/runtime/src/primitives`)
- Modify: `apps/web/lib/connections/grants.ts:12,23-28` (+ `deriveCapabilityTier`)
- Test: `packages/runtime/test/` capability test + `apps/web/lib/connections/grants.test.ts`

**Interfaces:**
- Produces: single email write capability `email.send` with `nativeDraft: true`; `calendar.event-create` gets `nativeDraft: false`; `sideEffect` union is `read | write`; `WriteCapability = 'email.send' | 'calendar.event-create'`; `CapabilityTier = 'read_only' | 'write'`.

- [ ] **Step 1: Write failing tests** — a capability test asserting `email.draft` is no longer in the registry and `email.send` has `nativeDraft === true`; a `grants.test.ts` update asserting `deriveCapabilityTier` returns `'write'` when any write grant is held (drop the 4-tier cases).

- [ ] **Step 2: Run — FAIL.**

- [ ] **Step 3: Implement the collapse**
- `capabilities.ts`: remove the `email.draft` entry; `email.send` → `{ …, sideEffect: 'write', nativeDraft: true }`; `calendar.event-create` → add `nativeDraft: false`; drop `'draft'` from the `sideEffect` union (everything `read`|`write`); add `nativeDraft?: boolean` to the descriptor type.
- Primitives yielding `capability: 'email.draft'` → `'email.send'` (behavior preserved: the action level still drafts unless Send). Update `invoice.nudge` likewise if it was `sideEffect: 'draft'`.
- `grants.ts`: `WriteCapability = 'email.send' | 'calendar.event-create'`; `CapabilityTier = 'read_only' | 'write'`; `deriveCapabilityTier` returns `'write'` when the active set is non-empty, else `'read_only'`.

- [ ] **Step 4: Run — PASS.** Re-run the full runtime + connections suites; update any test still referencing `email.draft` as a capability.

- [ ] **Step 5: Commit.** `git commit -am "refactor(capabilities): single email write capability + nativeDraft flag; retire email.draft"`

---

## Task 4: Native-draft mirror + delete-sync

**Files:**
- Create migration: add `native_draft_ref text null` to the side-effects/draft table (find the draft row table via `grep -rn "recordStep" apps/web/lib/runtime/stores.ts`).
- Modify: `apps/web/lib/runtime/engine.ts` (draft path) + `packages/connectors/src/connectors/gmail.ts` (add `deleteDraft`, `sendDraft`).
- Modify: the runner draft-record path to capture `native_draft_ref`; the dismiss/delete action to delete the native draft.
- Test: `apps/web/test/effects-executor.test.ts` + a draft-dismiss test.

**Interfaces:**
- Produces: at `draft` level, `nativeDraft` capabilities create a Gmail draft and store its id; dismiss deletes it; at `send` level, send the stored draft if present.

- [ ] **Step 1: Write failing tests** — (a) drafting an email step at `draft` level calls `createDraft` and records a `native_draft_ref`; (b) drafting a calendar step records NO native ref; (c) dismissing an email draft calls `deleteDraft`; (d) sending with a stored draft ref calls `sendDraft` (not a fresh send).

- [ ] **Step 2: Run — FAIL.**

- [ ] **Step 3: Add Gmail client methods** (`gmail.ts`, mirroring `createDraft` at line 174):

```typescript
/** Delete a draft (compose scope). Used to keep Nibbin/Gmail drafts in sync. */
async deleteDraft(draftId: string): Promise<void> {
  this.requireGrantedScope(SCOPE_COMPOSE);
  await this.request(`/gmail/v1/users/me/drafts/${encodeURIComponent(draftId)}`, { method: 'DELETE' });
}
/** Send an existing draft (send scope + velocity already consumed by caller). */
async sendDraft(draftId: string): Promise<{ id?: string }> {
  this.requireGrantedScope(SCOPE_SEND);
  const res = await this.request('/gmail/v1/users/me/drafts/send', {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ id: draftId }),
  });
  return res.json() as { id?: string };
}
```

- [ ] **Step 4: Wire the executor + runner**
- In the runner draft path: for a `nativeDraft` capability, call the executor's draft-mirror (create Gmail draft via `createDraft`) and store the returned id in the draft `payload.native_draft_ref` (+ the column).
- In `engine.ts`: the `email.send` send path, if `args.args.nativeDraftRef` is set, calls `sendDraft(ref)` instead of `sendMessageDirect(rfc822)` (after the same velocity consume); clears the ref.
- The dismiss/delete draft action: if a `native_draft_ref` exists, call `deleteDraft(ref)` best-effort (logged, non-blocking).

- [ ] **Step 5: Run — PASS.** Commit. `git commit -am "feat(runtime): native Gmail draft mirror + delete-sync at draft/send levels"`

---

## Task 5: Set-action-level server action + retire Gmail-hardcoded grant

**Files:**
- Create: `apps/web/app/app/nibbins/action-level-actions.ts` (`setNibbinActionLevel(nibbinId, level)`).
- Modify: `apps/web/app/app/connections/actions.ts` — retire the Gmail-specific `beginWriteConnectAction` write path; the action level update manages grants/observe.
- Test: `apps/web/test/action-level-actions.test.ts`.

**Interfaces:**
- Produces: `setNibbinActionLevel(nibbinId, 'observe'|'draft'|'send')` — verifies ownership, updates `nibbins.action_level`. (Send/Draft also reconciles `nibbin_write_grants` for audit; the gate reads `action_level`.)

- [ ] **Step 1: Failing test** — `setNibbinActionLevel` updates the column after an ownership check; rejects a foreign nibbin (IDOR guard).
- [ ] **Step 2: Run — FAIL.**
- [ ] **Step 3: Implement** the server action (mirror the ownership check in `beginWriteConnectAction`, `actions.ts:69-74`); update `action_level`; reconcile grants (Send → ensure a grant row for audit; Draft/Observe → revoke).
- [ ] **Step 4: Run — PASS.** Commit.

---

## Task 6: Agent School repositioned as a grade (verify + surface)

**Files:**
- Modify: wherever the stage/grade is displayed (nibbin card/detail) to label it advisory.
- Test: a runtime test asserting `dispatchStep`'s outcome is invariant to `stage` given a fixed `actionLevel` (locks "grade never gates").

- [ ] **Step 1: Failing test** — same step + `actionLevel: 'send'`, run at each of egg/student/senior/grad → all `executed`. (Proves grade is decoupled.)
- [ ] **Step 2: Run — FAIL if any stage still gates** (should PASS after Task 2; this is the lock).
- [ ] **Step 3:** If anything still reads stage to gate, remove it. Update the grade display copy to "grade/report card" framing (ties to Task 8). Commit.

---

## Task 7: Observe/Draft/Send segmented control + warning + grade badge

**Files:**
- Create: `apps/web/components/ui/SegmentedControl.tsx` (+ `.module.css`) — reuse `DESIGN.md` tokens / existing `Button`/`Badge` styling; 3 mutually-exclusive segments.
- Modify: `apps/web/app/app/nibbins/NibbinControls.tsx` + the nibbin detail page — render the control (calls `setNibbinActionLevel`), the advisory grade `Badge`, and a non-blocking confirm when Send is chosen below Graduate.
- Test: `apps/web/test/segmented-control.test.tsx` (+ a control-copy test reused by Task 8's grep gate).

**Interfaces:**
- Consumes: `setNibbinActionLevel` (Task 5), the nibbin's `action_level` + `stage`.

- [ ] **Step 1: Failing test** — the control renders three options, marks the current one active, and calls `onChange` with the chosen level; choosing `send` below Graduate surfaces the warning text and only proceeds on confirm.
- [ ] **Step 2: Run — FAIL.**
- [ ] **Step 3: Build `SegmentedControl`** from design-system primitives (no new visual style; match `nibbins.module.css`/UI-kit tokens). Wire it into `NibbinControls`; add the grade `Badge` (advisory) and the Send-below-Graduate non-blocking warning.
- [ ] **Step 4: Run — PASS.** Run the design-review pass (`/design-review` or the design-system skill) against the control before merge.
- [ ] **Step 5: Commit.** `git commit -am "feat(ui): Observe/Draft/Send segmented control + advisory grade + send warning"`

---

## Task 8: Copy / content sweep (all surfaces)

**Files (enumerated from the inventory):** `apps/web/app/page.tsx:126,179-180`; `app/about/page.tsx:79-80`; `app/app/nibbins/page.tsx:339,454`; `app/(marketing)/MayaDemo.tsx:155-156,186,350,403`; `app/app/hatch/HatchWizard.tsx:180,228,352,382`; `app/app/hatch/page.tsx:30`; `apps/web/lib/help/content.ts`; `docs/help-compendium.md`; `packages/keeper/src/copy.ts`; `reference/*.html` (demo/privacy/data-ai/subprocessors); `README*`; `docs/INVARIANTS.md` (C8); `SPEC.md:120,333`; `apps/web/lib/connections/grants.ts` comments.

**Interface:** all copy reframed to "you grant the actions (Observe/Draft/Send); Agent School grades competency." No survivors of the old narrative.

- [ ] **Step 1:** Rewrite `docs/INVARIANTS.md` **C8** and `SPEC.md` C8 (+ lines 120, 333) to the action-level model: write scopes at connect; **execution gated by the owner-set action level, not stage**; Agent School is an advisory competency grade; explicitly remove "Agent School gates side effects" / "no autonomy without Agent School approval" / "untrained can't act."
- [ ] **Step 2:** Rewrite the marketing/product surfaces (landing, about, nibbins roster, MayaDemo, HatchWizard, hatch page) — replace "earns the right / graduates to act / drafting-until-it-graduates" with the grant + grade framing. Keep brand voice (use the brand-voice skill if available).
- [ ] **Step 3:** Rewrite the help content (`lib/help/content.ts`, `docs/help-compendium.md`) and Grovekeeper copy (`keeper/src/copy.ts`), and the `reference/*.html` + README + grants.ts comments.
- [ ] **Step 4: Grep gate** — `grep -rniE "earns? the right|agent school (unlocks|gates|grants)|read-only until|until it graduates|draft.{0,8}then.{0,8}send|untrained.{0,12}can.?t act" apps packages docs reference README* SPEC.md` returns nothing meaningful (only this plan/spec + legitimate protocol mentions). Fix survivors.
- [ ] **Step 5:** Watch for **smart-quote string delimiters** when editing `.ts`/`.tsx` copy (they break parsing — lint catches them; use straight quotes). Run `npm run lint`.
- [ ] **Step 6: Commit.** `git commit -m "docs+web: reframe all copy to action-level grants + Agent School as grade"`

---

## Task 9: Full verification + adversarial gate + PR

- [ ] **Step 1:** `npm run lint && npm run typecheck && npx vitest run && npm run build` — all green (treat `@nibbin/*` stale-dist tsc errors as worktree false-positives only after verifying the symbol exists + is re-exported).
- [ ] **Step 2: Adversarial gate** — run the 4 reviewers over the branch diff. Mandatory focus: **red-team** confirms the retained walls (idempotency, velocity, resource claims, vault, scope) fully contain an `Egg+Send` Nibbin now that the stage wall is gone; **claims-auditor** verifies every surface's copy matches the new model AND that C8/SPEC no longer assert stage-gating; **logic-skeptic** checks the action-level transitions + observe suppression + native-draft delete-sync; **cost-auditor** confirms no routing-tier change. Write `docs/gates/2026-06-20-action-levels.md`; fix P0/P1; re-run.
- [ ] **Step 3:** Rebase onto `origin/main`, `gh pr create --base main`, confirm the 4 CI checks + adversarial-gate workflow green, merge.

---

## Self-Review

**Spec coverage:** action-level gate → T1,T2; Agent School as grade → T2,T6; capability collapse → T3; native draft + delete-sync → T4; generic grant/action-level set → T5; UI segmented control + warning + advisory grade → T7; copy sweep incl. C8/SPEC → T8; migration → T1 (+ T4 column); adversarial gate → T9. All covered.

**Placeholder scan:** the copy-sweep task references exact files+lines from the inventory rather than re-pasting every string (the strings live in those files); load-bearing code (gate rewrite, migration, Gmail methods, capability collapse) is shown verbatim. The few "find via grep" pointers name the exact grep and exist because the symbol's line may have shifted post-merge.

**Type consistency:** `actionLevel` (T1) used in T2/T6; `WriteCapability`/`CapabilityTier` collapsed in T3 consistently; `native_draft_ref` (T4) consistent; `setNibbinActionLevel` (T5) consumed by T7.

**Open assumption flagged:** the exact draft-row table name for `native_draft_ref` (T4) and whether `dispatchStep` is the only `gateSideEffect` caller (T2) — both named with a grep to confirm before editing.
