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
    -- §4.6: the Egg observes account context before becoming a Student. A
    -- completed scan IS observed context — on a scanned account incubation
    -- completes immediately (that is how the Day-One <10-minute first draft
    -- stays possible); otherwise the 3-day observation floor applies.
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

    -- The window: last v_window DECIDED runs in THIS stage (count-based; an idle
    -- /paused Nibbin's earned ratio never decays), each with its 1/3/10 stakes
    -- weight from runs.weight_class.
    with win as (
      select a.run_id, a.decision,
             case r.weight_class when 'standard' then 1 when 'frontier' then 3 when 'computer_use' then 10 else 1 end as weight
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

    -- NOTE: today every shipped template ships weight_class='standard' (a
    -- model-cost tier, not a per-action stakes tier), so R3 below is currently a
    -- safe no-op — it activates only once weight_class varies or a per-action
    -- stakes map lands. It can only ever tighten.
    -- R3 severity (ADDITIVE — must ALSO clear the stakes-weighted ratio; a
    -- high-stakes miss counts 3×/10×). Can only reject, never loosen.
    if v_w_approved / greatest(v_w_total, 1) < v_min_pct then
      raise exception 'nibbin % has not earned weighted promotion (% of % by stakes, need %)',
        p_nibbin, v_w_approved, v_w_total, v_min_pct;
    end if;

    -- R1 coverage (senior→grad ONLY, ADDITIVE): full autonomy requires breadth
    -- — ≥K distinct routine patterns proven (approved-unedited) WITHIN this same
    -- window. Counts only patterns that actually ran this window; a narrow
    -- Nibbin (or one whose recent work is one pattern) caps at Senior, still
    -- autonomous on what it proved.
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
