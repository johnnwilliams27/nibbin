# Promotion Gate v3 — per-action stakes (F1) + index (F4) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development. Checkbox steps. Finishes the promotion-rubric follow-ups from the #128/#129 gate reports.

**Goal:** Make **R3 severity actually bite (F1)** by weighting each promotion decision by the run's **side-effect stakes** — derived from the draft step's capability (`run_steps.tool`) — instead of the dormant model-cost `weight_class`. Add the **`run_steps(run_id, kind)` index (F4)**. Resolve F2/F3/cost-nit by decision (documented in the gate report).

**Why this is correct + safe:** R3 stays a **strictly additive** AND-condition on the unchanged base 95%/25 gate — swapping the *weight basis* changes which candidates R3 *rejects*, never rescues a base-failing one (non-loosening preserved). The stakes signal (`run_steps.tool` = the step's `capability`, set server-side by the runner from the trusted program literal) is **not client-controllable**, so it can't be gamed. A read-only agent's runs are uniformly stakes-1 (R3 ≡ base for it); a sending agent's runs weigh more, so flubbing high-stakes drafts blocks promotion.

**Stakes taxonomy (conservative, tunable in one place):** `*.read` → 1; `*.delete`/`*.archive` → 10; everything else (draft/send/nudge/write/create/update + any unknown) → **3** (unknown defaults to consequential = the safe/stricter direction). Per-run weight = **max** stakes over the run's steps.

**GATED:** migration + `packages/runtime` + `apps/web/lib/runtime`. Needs `docs/gates/2026-06-18-promotion-gate-v3.md` + the migration applied dev/staging/prod + the adversarial gate.

## File structure
- **Create** `supabase/migrations/20260618020000_promotion_gate_v3_stakes.sql` — `capability_stakes(text)` immutable fn; `create or replace nibbin_promote` (win-CTE weight via `capability_stakes(run_steps.tool)`); `run_steps(run_id, kind)` index.
- **Modify** `packages/runtime/src/school.ts` — export `stakesOf(capability)` (the TS mirror of `capability_stakes`).
- **Modify** `apps/web/lib/runtime/engine.ts` — `maybePromote` builds per-run weights from `run_steps.tool` stakes (one windowed `run_steps` fetch reused for R3 weights + R1 coverage); drop `weight_class`.
- **Modify** `packages/runtime/test/trust-gate.test.ts` — add `stakesOf` mapping cases.

---

### Task 1: Migration — capability stakes + nibbin_promote v3 + index

**Files:** Create `supabase/migrations/20260618020000_promotion_gate_v3_stakes.sql`

- [ ] **Step 1** — write it. Add the stakes fn, redefine `nibbin_promote` changing ONLY the `win` CTE's `weight` expression (everything else — egg branch, floors, base gate, R3 condition, R1 coverage CTE, update/audit, grants — stays byte-identical to v2), and add the index:

```sql
-- Promotion gate v3 (F1): R3 severity now weights by per-run SIDE-EFFECT STAKES
-- (the draft step's capability), not the dormant model-cost weight_class. Still
-- strictly additive — R3 is ANDed with the unchanged base gate; it can only
-- reject, never rescue a base-failing candidate. Stakes signal is server-set
-- (runner writes run_steps.tool from the trusted program literal), not gameable.

-- Side-effect stakes for a capability. Conservative: reads are low; destructive
-- is highest; everything else (incl. UNKNOWN) is consequential (=3) — unknown
-- defaults to the stricter direction. Tune here only.
create or replace function public.capability_stakes(p_cap text)
returns integer
language sql
immutable
set search_path = ''
as $$
  select case
    when p_cap is null then 1
    when p_cap like '%.read' then 1
    when p_cap like '%.delete' or p_cap like '%.archive' then 10
    else 3
  end;
$$;

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

    -- Window: last v_window DECIDED runs in this stage (count-based; paused≠penalized),
    -- each weighted by its SIDE-EFFECT stakes = max capability_stakes over its steps.
    with win as (
      select a.run_id, a.decision,
             coalesce((select max(public.capability_stakes(rs.tool))
                         from public.run_steps rs where rs.run_id = a.run_id), 1) as weight
        from public.approvals a
        join public.runs r on r.id = a.run_id
       where a.account_id = v_account
         and a.decided_at > v_stage_since
         and r.nibbin_id = p_nibbin
       order by a.decided_at desc
       limit v_window
    )
    select count(*), count(*) filter (where decision = 'approved'),
           coalesce(sum(weight), 0), coalesce(sum(weight) filter (where decision = 'approved'), 0)
      into v_decided, v_approved, v_w_total, v_w_approved
      from win;

    -- Base gate (UNCHANGED): enough decided + ≥min_pct UNWEIGHTED approved.
    if v_decided < v_window or v_approved::numeric / greatest(v_decided, 1) < v_min_pct then
      raise exception 'nibbin % has not earned promotion (% of % approved in window, need %)',
        p_nibbin, v_approved, v_decided, v_min_pct;
    end if;

    -- R3 severity (ADDITIVE): also clear the stakes-weighted ratio. Can only reject.
    if v_w_approved / greatest(v_w_total, 1) < v_min_pct then
      raise exception 'nibbin % has not earned weighted promotion (% of % by stakes, need %)',
        p_nibbin, v_w_approved, v_w_total, v_min_pct;
    end if;

    -- R1 coverage (senior→grad ONLY, ADDITIVE): ≥K distinct routine patterns
    -- proven (approved-unedited) WITHIN this same window.
    if v_stage = 'senior' then
      with win as (
        select a.run_id, a.decision
          from public.approvals a
          join public.runs r on r.id = a.run_id
         where a.account_id = v_account
           and a.decided_at > v_stage_since
           and r.nibbin_id = p_nibbin
         order by a.decided_at desc
         limit v_window
      )
      select count(distinct rs.payload ->> 'patternKey')
        into v_distinct_patterns
        from win
        join public.run_steps rs on rs.run_id = win.run_id and rs.kind = 'draft'
       where win.decision = 'approved'
         and rs.payload ->> 'patternKey' is not null;
      if coalesce(v_distinct_patterns, 0) < v_coverage_k then
        raise exception 'nibbin % needs broader proof before graduating (% of % distinct patterns in window)',
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

-- F4: back the per-run run_steps lookups (window-bounded today, cheap insurance).
create index if not exists run_steps_run_kind_idx on public.run_steps (run_id, kind);
```

- [ ] **Step 2** — do NOT apply (controller applies dev/staging/prod). Commit: `feat(school): R3 weights by per-action stakes (F1) + run_steps index (F4)`.

---

### Task 2: TS stakes mirror

**Files:** Modify `packages/runtime/src/school.ts`

- [ ] **Step 1** — add the exported mirror of `capability_stakes` (keep it adjacent to `promotionCheck`):
```ts
/** Side-effect stakes for a capability — the TS mirror of the SQL
 *  `capability_stakes`. Reads are low; destructive highest; everything else
 *  (incl. unknown) is consequential (=3). Used to weight R3 (see promotionCheck). */
export function stakesOf(capability: string | null | undefined): number {
  if (!capability) return 1;
  if (capability.endsWith('.read')) return 1;
  if (capability.endsWith('.delete') || capability.endsWith('.archive')) return 10;
  return 3;
}
```

- [ ] **Step 2** — `cd /c/Nibbin && npx tsc --noEmit -p packages/runtime` → exit 0. Commit: `feat(runtime): stakesOf — TS mirror of capability_stakes`.

---

### Task 3: maybePromote builds weights from capability stakes

**Files:** Modify `apps/web/lib/runtime/engine.ts`

- [ ] **Step 1** — import `stakesOf`: add it to the existing `@nibbin/runtime` (or school) import alongside `promotionCheck`/`Decision`.

- [ ] **Step 2** — replace the weights/coverage block. Drop `weight_class` from the approvals select; add a count-eligibility early-return (so the `run_steps` fetch only runs when there are ≥window decided); fetch the windowed runs' steps ONCE and use them for both R3 stakes and R1 coverage:
```ts
  const { data: decisions } = await svc
    .from('approvals')
    .select('decision, run_id, decided_at, runs!inner(nibbin_id)')
    .eq('runs.nibbin_id', nibbinId)
    .gt('decided_at', nrow.stage_changed_at as string)
    .order('decided_at', { ascending: false })
    .limit(windowRuns);
  const rows = (decisions ?? []) as Array<{ decision: Decision; run_id: string }>;
  // Count-eligibility gate: base needs ≥windowRuns decided, so skip the steps
  // fetch entirely when the window isn't full (the common case).
  if (rows.length < windowRuns) return null;
  const newestFirst = rows.map((d) => d.decision);

  // One windowed run_steps fetch → per-run stakes (R3) + distinct patterns (R1).
  const runIds = rows.map((d) => d.run_id);
  const { data: steps } = await svc
    .from('run_steps')
    .select('run_id, tool, kind, payload')
    .in('run_id', runIds);
  const stepRows = (steps ?? []) as Array<{
    run_id: string; tool: string | null; kind: string; payload: { patternKey?: string } | null;
  }>;
  const stakesByRun = new Map<string, number>();
  for (const s of stepRows) {
    stakesByRun.set(s.run_id, Math.max(stakesByRun.get(s.run_id) ?? 1, stakesOf(s.tool)));
  }
  const weights = rows.map((d) => stakesByRun.get(d.run_id) ?? 1);

  let distinctPatterns = 0;
  if (stage === 'senior') {
    const approved = new Set(rows.filter((d) => d.decision === 'approved').map((d) => d.run_id));
    const keys = new Set<string>();
    for (const s of stepRows) {
      if (s.kind === 'draft' && approved.has(s.run_id) && s.payload?.patternKey) keys.add(s.payload.patternKey);
    }
    distinctPatterns = keys.size;
  }

  if (!promotionCheck(newestFirst, specRow.curriculum, { weights, distinctPatterns, stage }).eligible) return null;
```
(Everything below — the `nibbin_promote` RPC call, the send-grant — is unchanged.)

- [ ] **Step 3** — `cd /c/Nibbin && npx tsc --noEmit -p apps/web` → exit 0. Commit: `feat(web): maybePromote weights by per-action stakes (F1)`.

---

### Task 4: Tests

**Files:** Modify `packages/runtime/test/trust-gate.test.ts`

- [ ] **Step 1** — add a `stakesOf` describe block: `email.read`→1, `calendar.read`→1; `email.draft`→3, `email.send`→3, `invoice.nudge`→3, unknown `foo.bar`→3, `null`/`undefined`→1; `mail.delete`→10, `mail.archive`→10. (The existing `promotionCheck` weighted-block/cannot-loosen cases still pass — they pass `weights` arrays directly, unaffected by the weight *source* change.)
- [ ] **Step 2** — `cd /c/Nibbin && npx vitest run packages/runtime/test` → green.

---

### Task 5: Verify
- [ ] `cd /c/Nibbin && npx tsc --noEmit -p apps/web && npx tsc --noEmit -p packages/runtime` → exit 0.
- [ ] `cd /c/Nibbin && npx vitest run packages/runtime/test apps/web/` → green.
- [ ] Confirm R3 stays ADDITIVE: the base unweighted gate is unchanged and ANDed before R3; the `win` change only alters the `weight` value, not the gate structure. Egg branch + R1 coverage CTE byte-identical to v2.
- [ ] Confirm `stakesOf` (TS) and `capability_stakes` (SQL) agree on the mapping.

## Self-review / decisions to record in the gate report
- **F1 — DONE:** R3 weights by side-effect stakes; non-loosening preserved (additive); stakes server-set (not gameable); read-only agents unaffected. Cost: the `run_steps` fetch is now gated behind the count-eligibility early-return (only when ≥window decided), bounded to ≤window runs.
- **F4 — DONE:** `run_steps(run_id, kind)` index.
- **F2 — resolved (no code):** coverage counts distinct `patternKey`s = the breadth metric; current programs emit exactly one draft (one patternKey) per run, so single-run inflation is unreachable. Revisit only if multi-draft programs land.
- **F3 — resolved (verified):** all six shipped programs set a `patternKey` on their draft step, so "patternKey-less caps at Senior" can't bite today; it becomes a synthesis-time requirement (a synthesized agent's drafts must set a patternKey to be able to graduate).
- **cost-nit — wontfix (auditor-endorsed):** the per-senior/grad-decision double `nibbins` PK read (maybePromote + maybeDriftNudge) is one cheap lookup; threading stage through both adds coupling for negligible gain. Left as-is by the cost-auditor's own recommendation.
