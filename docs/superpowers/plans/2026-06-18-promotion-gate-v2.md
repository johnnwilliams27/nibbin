# Promotion Gate v2 (R1 coverage + R3 severity) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development. Steps use checkbox (`- [ ]`) syntax. This is PR 1 of the promotion-rubric build; PR 2 (drift nudge + dignified demotion) is a separate plan.

**Goal:** Strengthen Agent School's promotion gate with two **strictly additive** dimensions from the settled rubric (`docs/superpowers/specs/2026-06-18-promotion-rubric-design.md`): **R3 severity** (weight each decision by the 1/3/10 credit tier so high-stakes misses count more) and **R1 coverage** (Senior→Grad requires ≥4 distinct routine patterns proven). Today's 95%/25 approved-unedited gate stays the spine, unchanged.

**Architecture:** The authoritative `nibbin_promote` SQL gains two extra AND-conditions; the TS mirror (`packages/runtime/src/school.ts` `promotionCheck`) and the pre-check (`apps/web/lib/runtime/engine.ts` `maybePromote`) match it. Both new conditions can only ever *reject* — never promote anything the old gate didn't — which is the non-negotiable invariant ("no mechanic may grant or accelerate autonomy"; floors only tighten).

**Why additive (the key safety property):** weighting a pass-ratio *alone* can turn an unweighted-fail into a weighted-pass (ace the high-stakes, flub the trivial) — that would *loosen*. So R3 is an **extra** condition ANDed with the existing unweighted check: a Nibbin must clear BOTH the unweighted AND the weighted ratio. R1 is a third AND-condition (senior→grad only). Strictly stricter, provably.

**GATED build:** touches `supabase/migrations/`, `packages/runtime/`, `apps/web/lib/runtime/` — all in the CI sensitive-path regex. Requires a `docs/gates/2026-06-18-promotion-gate-v2.md` report + the migration applied to dev/staging/prod + the CI adversarial 4-reviewer gate. Security testing must assert: no fall-back/reset, floors only tighten, paused≠penalized (count-based window, no wall-clock), egg→student path unchanged.

## Settled parameters
- Coverage `K = 4` distinct routine patterns (curriculum `coverageMinPatterns`, default 4, floor 4 — tighten-only).
- Severity weights = `runs.weight_class`: standard 1, frontier 3, computer_use 10 (the existing credit tiers).
- Coverage applies to **senior→grad only**; student→senior unchanged except R3.

## File structure
- **Create** `supabase/migrations/20260618000000_promotion_gate_v2.sql` — `create or replace nibbin_promote` with R3 + R1.
- **Modify** `packages/runtime/src/types.ts` — add `coverageMinPatterns?` to `PromotionThresholds`.
- **Modify** `packages/runtime/src/templates.ts` — `PROMOTION` includes `coverageMinPatterns: 4`.
- **Modify** `packages/runtime/src/school.ts` — `promotionCheck` gains an optional `opts` (weights, distinctPatterns, stage) and ANDs the two extra conditions.
- **Modify** `apps/web/lib/runtime/engine.ts` — `maybePromote` gathers weights + distinct patterns and passes `opts` so the pre-check matches the SQL.
- **Modify** `packages/runtime/test/trust-gate.test.ts` — add R1/R3 cases.

---

### Task 1: The migration — `nibbin_promote` v2

**Files:** Create `supabase/migrations/20260618000000_promotion_gate_v2.sql`

- [ ] **Step 1** — write the migration. It `create or replace`s `nibbin_promote` (single-definition today, in m4). The egg→student branch is **unchanged**; the non-egg branch adds R3 + R1 as additive AND-conditions:

```sql
-- Promotion gate v2 (R1 coverage + R3 severity) — strictly ADDITIVE conditions
-- on top of the unchanged 95%/25 approved-unedited gate. Spec:
-- docs/superpowers/specs/2026-06-18-promotion-rubric-design.md
-- Invariant: these can only REJECT; they never promote anything the base gate
-- wouldn't, never reset progress, and never key on wall-clock (paused≠penalized).
create or replace function public.nibbin_promote(p_nibbin uuid)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_account uuid;
  v_stage text;
  v_stage_since timestamptz;
  v_next text;
  v_window integer;
  v_min_pct numeric;
  v_coverage_k integer;
  v_decided integer;
  v_approved integer;
  v_w_total numeric;
  v_w_approved numeric;
  v_distinct_patterns integer;
begin
  select n.account_id, n.stage, n.stage_changed_at into v_account, v_stage, v_stage_since
    from public.nibbins n where n.id = p_nibbin for update;
  if not found then
    raise exception 'unknown nibbin %', p_nibbin;
  end if;

  v_next := case v_stage
    when 'egg' then 'student'
    when 'student' then 'senior'
    when 'senior' then 'grad'
    else null
  end;
  if v_next is null then
    raise exception 'nibbin % is already a graduate', p_nibbin;
  end if;

  if v_stage = 'egg' then
    -- UNCHANGED §4.6 egg→student context check.
    if not exists (select 1 from public.scan_results s where s.account_id = v_account)
       and not exists (
         select 1 from public.grove_state g
         where g.account_id = v_account and g.answers <> '{}'::jsonb
       )
       and (select hatched_at from public.nibbins where id = p_nibbin) > now() - interval '3 days'
    then
      raise exception 'nibbin % has not observed enough context to leave the egg', p_nibbin;
    end if;
  else
    select greatest(coalesce((s.curriculum -> 'promotion' ->> 'windowRuns')::integer, 25), 25),
           greatest(coalesce((s.curriculum -> 'promotion' ->> 'minApprovedUneditedPct')::numeric, 0.95), 0.95),
           greatest(coalesce((s.curriculum -> 'promotion' ->> 'coverageMinPatterns')::integer, 4), 4)
      into v_window, v_min_pct, v_coverage_k
      from public.nibbins n join public.agent_specs s on s.id = n.spec_id
      where n.id = p_nibbin;

    -- The window: last v_window DECIDED runs in THIS stage (count-based, so an
    -- idle/paused Nibbin's earned ratio never decays), each carrying its 1/3/10
    -- severity weight from runs.weight_class.
    select count(*),
           count(*) filter (where w.decision = 'approved'),
           coalesce(sum(w.weight), 0),
           coalesce(sum(w.weight) filter (where w.decision = 'approved'), 0)
      into v_decided, v_approved, v_w_total, v_w_approved
      from (
        select a.decision,
               case r.weight_class
                 when 'standard' then 1 when 'frontier' then 3 when 'computer_use' then 10 else 1
               end as weight
          from public.approvals a
          join public.runs r on r.id = a.run_id
         where a.account_id = v_account
           and a.decided_at > v_stage_since
           and r.nibbin_id = p_nibbin
         order by a.decided_at desc
         limit v_window
      ) w;

    -- Base gate (UNCHANGED): enough decided + ≥min_pct UNWEIGHTED approved.
    if v_decided < v_window or v_approved::numeric / greatest(v_decided, 1) < v_min_pct then
      raise exception 'nibbin % has not earned promotion (% of % approved in window, need %)',
        p_nibbin, v_approved, v_decided, v_min_pct;
    end if;

    -- R3 severity (ADDITIVE — must ALSO clear the gate weighted by stakes; a
    -- high-stakes miss now counts 3×/10×). Can only reject, never loosen.
    if v_w_approved / greatest(v_w_total, 1) < v_min_pct then
      raise exception 'nibbin % has not earned weighted promotion (% of % by stakes, need %)',
        p_nibbin, v_w_approved, v_w_total, v_min_pct;
    end if;

    -- R1 coverage (senior→grad ONLY, ADDITIVE): full autonomy requires breadth
    -- — ≥K distinct routine patterns approved-unedited in this stage. Counts
    -- only patterns that actually ran (a paused capability can't block the rest;
    -- a genuinely narrow Nibbin simply caps at Senior, still autonomous on what
    -- it proved).
    if v_stage = 'senior' then
      select count(distinct rs.payload ->> 'patternKey')
        into v_distinct_patterns
        from public.approvals a
        join public.runs r on r.id = a.run_id
        join public.run_steps rs on rs.run_id = r.id and rs.kind = 'draft'
       where a.account_id = v_account
         and a.decision = 'approved'
         and a.decided_at > v_stage_since
         and r.nibbin_id = p_nibbin
         and rs.payload ->> 'patternKey' is not null;
      if coalesce(v_distinct_patterns, 0) < v_coverage_k then
        raise exception 'nibbin % needs broader proof before graduating (% of % distinct patterns)',
          p_nibbin, coalesce(v_distinct_patterns, 0), v_coverage_k;
      end if;
    end if;
  end if;

  update public.nibbins set stage = v_next, stage_changed_at = now() where id = p_nibbin;
  insert into public.audit_log (account_id, actor, actor_id, action, subject, meta)
  values (v_account, 'system', 'runtime', 'nibbin.stage_promoted', p_nibbin::text,
    jsonb_build_object('from', v_stage, 'to', v_next));
  return v_next;
end;
$$;
revoke execute on function public.nibbin_promote(uuid) from public, anon, authenticated;
grant execute on function public.nibbin_promote(uuid) to service_role;
```

- [ ] **Step 2** — do NOT apply the migration from the subagent. The controller (main agent) applies it to dev/staging/prod via the Supabase MCP after this task's code review. Commit: `feat(school): nibbin_promote v2 — additive severity (R3) + coverage (R1) gates`.

---

### Task 2: Curriculum type + template default

**Files:** Modify `packages/runtime/src/types.ts`, `packages/runtime/src/templates.ts`

- [ ] **Step 1 — `types.ts`** add the optional field to `PromotionThresholds`:
```ts
export interface PromotionThresholds {
  /** Rolling window of decided runs. Floor 25 — config may only tighten. */
  windowRuns: number;
  /** Approved-unedited share required. Floor 0.95 — config may only tighten. */
  minApprovedUneditedPct: number;
  /**
   * Distinct routine patterns required for Senior→Grad (R1 coverage). Floor 4
   * — config may only tighten. Optional for back-compat with existing specs;
   * the SQL + mirror default to 4 when absent.
   */
  coverageMinPatterns?: number;
}
```

- [ ] **Step 2 — `templates.ts`** add it to the shared `PROMOTION` const:
```ts
const PROMOTION = { windowRuns: 25, minApprovedUneditedPct: 0.95, coverageMinPatterns: 4 };
```
(Existing DB specs lack the key; the SQL `coalesce(..., 4)` and the mirror `?? 4` handle them — no backfill needed.)

- [ ] **Step 3** — `cd /c/Nibbin && npx tsc --noEmit -p apps/web && npx tsc --noEmit -p packages/runtime` (or the repo's runtime typecheck) → exit 0. Commit: `feat(runtime): coverageMinPatterns curriculum threshold (default 4)`.

---

### Task 3: Mirror the gate in `school.ts`

**Files:** Modify `packages/runtime/src/school.ts`

- [ ] **Step 1** — extend `promotionCheck` with an optional `opts`, ANDing the two additive conditions. Keep the existing signature working (back-compat):
```ts
export function promotionCheck(
  decisions: readonly Decision[],
  curriculum: CurriculumConfig,
  opts?: {
    /** Per-decision severity weight (1/3/10), parallel to `decisions`. R3. */
    weights?: readonly number[];
    /** Distinct routine patterns approved-unedited in this stage. R1. */
    distinctPatterns?: number;
    /** Current stage — coverage applies only to senior→grad. */
    stage?: StageName;
  },
): PromotionCheck {
  // The floors are invariant: config may tighten, never loosen (§4.7).
  const windowRuns = Math.max(curriculum.promotion.windowRuns, 25);
  const needPct = Math.max(curriculum.promotion.minApprovedUneditedPct, 0.95);
  const coverageK = Math.max(curriculum.promotion.coverageMinPatterns ?? 4, 4);
  const window = decisions.slice(0, windowRuns);
  const approved = window.filter((d) => d === 'approved').length;

  let eligible = window.length >= windowRuns && approved / window.length >= needPct;

  // R3 (additive): must ALSO clear the gate weighted by stakes.
  if (eligible && opts?.weights) {
    const w = opts.weights.slice(0, windowRuns);
    const wTotal = w.reduce((s, x) => s + x, 0);
    const wApproved = window.reduce((s, d, i) => s + (d === 'approved' ? (w[i] ?? 1) : 0), 0);
    if (wTotal > 0 && wApproved / wTotal < needPct) eligible = false;
  }
  // R1 (additive, senior→grad only): breadth across ≥K distinct patterns.
  if (eligible && opts?.stage === 'senior') {
    if ((opts.distinctPatterns ?? 0) < coverageK) eligible = false;
  }

  return {
    eligible,
    decidedInWindow: window.length,
    approvedUnedited: approved,
    windowRuns,
    needPct,
  };
}
```
(Confirm `StageName` is already imported in school.ts — it is, from `./types`.)

- [ ] **Step 2** — `cd /c/Nibbin && npx tsc --noEmit -p packages/runtime` → exit 0. Commit: `feat(school): promotionCheck mirrors the additive R1/R3 gate`.

---

### Task 4: `maybePromote` gathers weights + distinct patterns

**Files:** Modify `apps/web/lib/runtime/engine.ts`

- [ ] **Step 1** — in `maybePromote`, change the approvals query to also pull each run's `weight_class`, build a parallel `weights` array, query distinct approved patterns, and pass `opts` to `promotionCheck`. Replace the decisions-fetch + `promotionCheck` call block with:
```ts
  const { data: decisions } = await svc
    .from('approvals')
    .select('decision, decided_at, runs!inner(weight_class)')
    .in('run_id', runIds)
    .gt('decided_at', nrow.stage_changed_at as string)
    .order('decided_at', { ascending: false })
    .limit(windowRuns);
  const rows = (decisions ?? []) as Array<{
    decision: Decision;
    runs: { weight_class: string } | { weight_class: string }[];
  }>;
  const newestFirst = rows.map((d) => d.decision);
  const weightOf = (wc: string) => (wc === 'computer_use' ? 10 : wc === 'frontier' ? 3 : 1);
  const weights = rows.map((d) => {
    const r = Array.isArray(d.runs) ? d.runs[0] : d.runs;
    return weightOf(r?.weight_class ?? 'standard');
  });

  // R1 coverage (senior→grad): distinct routine patterns approved this stage.
  let distinctPatterns = 0;
  if (stage === 'senior') {
    const { data: steps } = await svc
      .from('run_steps')
      .select('payload, run_id, runs!inner(nibbin_id)')
      .eq('kind', 'draft')
      .eq('runs.nibbin_id', nibbinId);
    // Count distinct patternKeys whose run was approved-unedited in this stage.
    const approvedRunIds = new Set(
      ((
        (await svc
          .from('approvals')
          .select('run_id, decision, decided_at')
          .in('run_id', runIds)
          .eq('decision', 'approved')
          .gt('decided_at', nrow.stage_changed_at as string)).data ?? []
      ) as Array<{ run_id: string }>).map((a) => a.run_id),
    );
    const keys = new Set<string>();
    for (const s of (steps ?? []) as Array<{ payload: { patternKey?: string } | null; run_id: string }>) {
      const k = s.payload?.patternKey;
      if (k && approvedRunIds.has(s.run_id)) keys.add(k);
    }
    distinctPatterns = keys.size;
  }

  if (!promotionCheck(newestFirst, specRow.curriculum, { weights, distinctPatterns, stage }).eligible) return null;
```
(Confirm `Decision` is imported from `@nibbin/runtime`/school in engine.ts; if not, import it. The SQL remains authoritative — this pre-check only avoids calling the RPC when it would refuse.)

- [ ] **Step 2** — `cd /c/Nibbin && npx tsc --noEmit -p apps/web` → exit 0. Commit: `feat(web): maybePromote pre-check matches the v2 SQL gate`.

---

### Task 5: Tests

**Files:** Modify `packages/runtime/test/trust-gate.test.ts`

- [ ] **Step 1** — read the existing test file to match its style/imports, then add cases for `promotionCheck`:
  - **base unchanged**: 25 approved, no opts → eligible; 24/25 → not eligible.
  - **R3 weighted blocks**: 25 decided where unweighted ≥0.95 but a single high-weight (10) rejection drags weighted <0.95 → NOT eligible. (e.g. 24×standard approved + 1×computer_use rejected: unweighted 24/25=0.96 pass, weighted 24/(24+10)=0.71 → fail.)
  - **R3 cannot loosen**: an unweighted-fail (e.g. 20/25 with the 5 fails all standard, successes high-weight) stays NOT eligible (the base condition still fails).
  - **R1 coverage blocks**: stage='senior', base+weighted pass, distinctPatterns=3 → NOT eligible; distinctPatterns=4 → eligible.
  - **R1 only at senior**: stage='student' with distinctPatterns=0 → eligible (coverage not required).
  - **floors only tighten**: a curriculum with `coverageMinPatterns: 2` still requires 4 (Math.max floor).

- [ ] **Step 2** — `cd /c/Nibbin && npx vitest run packages/runtime/test/trust-gate.test.ts` → all green. Commit: `test(school): R1 coverage + R3 severity gate cases`.

---

### Task 6: Verify
- [ ] `cd /c/Nibbin && npx tsc --noEmit -p apps/web` → exit 0.
- [ ] `cd /c/Nibbin && npx vitest run packages/runtime/test` → green (incl. existing trust-gate + trigger-graph).
- [ ] Confirm the egg→student branch in the migration is byte-for-byte the original logic (no behavior change there).
- [ ] Confirm no path lowers a floor: `windowRuns` `greatest(...,25)`, `minApprovedUneditedPct` `greatest(...,0.95)`, `coverageMinPatterns` `greatest(...,4)` in BOTH the SQL and `school.ts`.

## Self-review
- **Strictly additive / non-loosening:** R3 and R1 are extra AND-conditions; the base unweighted 95%/25 is untouched and still required. No input can promote something the old gate refused.
- **Paused ≠ penalized:** the window is count-based (last N decided), never wall-clock; an idle/paused Nibbin accrues no decisions and its earned ratio is frozen, not decayed.
- **No fall-back/reset:** this PR only gates promotion *up*; it never demotes or resets (`stage_changed_at` only moves on a real promotion, as before).
- **Coverage is breadth-floor, not completeness:** counts distinct patterns that actually ran — a paused capability can't block; a narrow Nibbin caps at Senior (still autonomous on proven patterns) by design.
- **SQL authoritative; TS mirrors:** `maybePromote` matches the SQL so it neither false-promotes (SQL would still refuse) nor needlessly calls the RPC.
- **Watch-item for the gate report:** coverage depends on `run_steps.payload->>'patternKey'` being set on draft steps (same field Senior autonomy already uses). Note in the gate report that agents whose drafts don't set a patternKey cap at Senior.
