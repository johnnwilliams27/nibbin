# Bug-Runtime Fix Report — #43, #44, #47

Commit: `af770acf`
Branch: `fix/bug-runtime`
Gate: lint clean | tsc clean (no new errors vs baseline) | vitest 270/270 passed

---

## #43 — Stage/status not re-checked mid-run

Root cause: `executeRun` passes `nibbin` (a dispatch-time snapshot) to `dispatchStep`; `nibbin_demote` flips the DB row instantly but the in-flight runner uses stale `NibbinRef.stage`.

Files changed:
- `packages/runtime/src/types.ts:162` — Added `stageChangedAt: number` to `NibbinRef`
- `packages/runtime/src/stores.ts:28` — Added `NibbinCurrentState` interface; `getNibbin(nibbinId)` to `RunStore`
- `packages/runtime/src/stores.ts:87` — `MemoryNibbinState` gains `stage?/stageChangedAt?`; `begin()` seeds them; `MemoryRunStore.getNibbin()` implemented
- `packages/runtime/src/runner.ts:264` — Before execute branch in `dispatchStep`: re-reads `freshNibbin = await deps.runs.getNibbin(nibbin.id)`; if absent or `status !== 'active'` → draft-not-execute; uses `freshNibbin.stage/stageChangedAt` for gating
- `packages/runtime/src/runner.ts:415` — `executeRun` passes `nibbinStage/nibbinStageChangedAt` to `begin()` to seed in-memory store
- `apps/web/lib/runtime/stores.ts:107` — `SupabaseRunStore.getNibbin` reads `stage, stage_changed_at, status` from `nibbins`
- `apps/web/lib/runtime/engine.ts` — All `nibbins` selects include `stage_changed_at`; all `NibbinRef` constructions include `stageChangedAt`

Tests added (runner-invariants.test.ts):
- `a grad run executes normally when no demotion occurs` — baseline ✓
- `a grad run demoted mid-run (store stage flipped to student) drafts instead of executing` — demotes inside program body; asserts `awaiting_approval` not `executed` ✓
- `a nibbin paused mid-run (store status flipped to paused) also drafts instead of executing` ✓

---

## #44 — Routine-pattern trust never resets on demotion

Root cause: `RoutineStore.approvedCount` counted approvals for all time with no stage scoping.

Files changed:
- `packages/runtime/src/stores.ts:61` — `RoutineStore.approvedCount` gains `sinceMs: number` parameter
- `packages/runtime/src/stores.ts:305` — `MemoryRoutineStore` stores timestamps per approval; `approvedCount` filters `t >= sinceMs`
- `packages/runtime/src/runner.ts:275` — `approvedCount` called with `effectiveStageChangedAt` (from fresh `getNibbin` read)
- `apps/web/lib/runtime/stores.ts:128` — `SupabaseRoutineStore.approvedCount` adds `.gte('decided_at', sinceIso)`

Tests added (runner-invariants.test.ts):
- `approvals recorded BEFORE demotion do not count toward re-promotion autonomy` — 5 pre-demotion approvals, sinceMs=DEMOTION_AT → count=0 ✓
- `approvals recorded AFTER demotion count toward re-promotion autonomy` — 3 pre + 4 post → count=4 ✓
- `a senior whose pattern was approved pre-demotion does not regain autonomy after re-promotion` — full executeRun with pre-demotion approvals → awaiting_approval ✓

---

## #47 — M4+M5 gate findings

### #47a (FIXED) — nibbin_demote is member-callable (red-team griefing)

Migration: `supabase/migrations/20260620200000_nibbin_demote_role_gate.sql`

The original function checked `private.is_account_member()` (any role). The fix replaces this with:

  if uid is not null then
    if not exists (
      select 1 from public.memberships m
      where m.account_id = v_account
        and m.user_id = uid and m.status = 'active'
        and m.role in ('owner', 'admin')
    ) then
      raise exception 'permission denied — demoting a Nibbin requires owner or admin role';
    end if;
  end if;

Preserved: SECURITY DEFINER, SET search_path='', signature, return type, stage-transition logic, audit_log insert, grant to authenticated+service_role. Service-role callers (uid IS NULL) are unaffected.

CONTROLLER ACTION REQUIRED: Apply migration to dev/staging/prod.

### #47b (ADDRESSED by #43/#44) — Promotion window decided_at-scoped, not run-scoped

The issue was prior-stage decisions decided after promotion counting toward the next window. #43 re-reads stage_changed_at freshly before each execute; #44 scopes approvedCount to decided_at >= stage_changed_at. No additional work needed.

### #47 P3s — noted, not fixed (cosmetic/deferred)

Finding #47/1: unseenInsights permanently-unseen classes; copy claims "not yet seen" — cosmetic copy/UX, no correctness risk
Finding #47/2: nibbinDay counts rejected/failed/killed as "nibbles done" — cosmetic metric, no trust/money impact
Finding #47/3: ensureArcs backfills week-old accounts with started_at=now() — pre-existing behavior, low observational impact
Finding #47/4: MemoryRunStore.finish allows queued→completed; SQL blocks it — mirror divergence, no app-path risk
Finding #47/6: Credit RPCs need READ COMMITTED comment; queue depth unbounded at zero balance — comment note, no immediate risk
Finding #47/7: emit_product_event allows members to forge their own funnel events — analytics only, no entitlement risk today (red-team P3)
Finding #47/9: maxTokens enforced post-hoc; reader.read has no timeout — handled by wall-clock ceiling
Finding #47/10: Warm-up cap check-then-send across ticks (+1-2/day overshoot) — accepted minor overshoot
Finding #47/11: Rejected drafts keep their charge — deliberate §6.4 tension; needs product decision

---

## Verification

  npm run lint              → clean
  npx tsc -p apps/web       → only pre-existing errors (DONE/@nibbin/keeper, MAX_COMPOSED_STEPS, planAction, sparticuz, etc.)
  npx vitest run packages/runtime → 270/270 passed (17 files)
