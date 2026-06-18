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
