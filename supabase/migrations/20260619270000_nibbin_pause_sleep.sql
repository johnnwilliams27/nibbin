-- Nibbin pause / resume / sleep (archive) RPCs.
-- "sleep" is the soft-delete path: nibbins are never hard-deleted.
-- Design mirrors nibbin_demote: security-definer, set search_path, member-
-- check via private.is_account_member, audit_log insert, grant authenticated.

-- ── nibbin_pause ──────────────────────────────────────────────────────────────
-- Pauses an active nibbin at the user's request. Only active nibbins may be
-- paused here; system-driven pauses (anomaly/cap/connection) have their own
-- paths and are NOT overridden by this RPC.
create or replace function public.nibbin_pause(p_nibbin uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  uid       uuid := (select auth.uid());
  v_account uuid;
  v_status  text;
begin
  select n.account_id, n.status into v_account, v_status
    from public.nibbins n where n.id = p_nibbin for update;
  if not found
     or (uid is not null and not (select private.is_account_member(v_account)))
  then
    raise exception 'unknown nibbin %', p_nibbin;
  end if;
  if uid is null and current_setting('role', true) <> 'service_role' then
    raise exception 'not authenticated';
  end if;

  if v_status <> 'active' then
    raise exception 'nibbin % is not active (status: %)', p_nibbin, v_status;
  end if;

  update public.nibbins
     set status = 'paused', paused_reason = 'user'
   where id = p_nibbin;

  insert into public.audit_log (account_id, actor, actor_id, action, subject, meta)
  values (
    v_account,
    coalesce(case when uid is null then 'system' end, 'user'),
    coalesce(uid::text, 'runtime'),
    'nibbin.pause',
    p_nibbin::text,
    jsonb_build_object('reason', 'user')
  );
end;
$$;
revoke execute on function public.nibbin_pause(uuid) from public, anon;
grant  execute on function public.nibbin_pause(uuid) to authenticated, service_role;

-- ── nibbin_resume ─────────────────────────────────────────────────────────────
-- Resumes a user-paused nibbin. Only accepts paused_reason='user'; anomaly/
-- cap/connection pauses are resolved by their own system paths, not here, so
-- we refuse them to keep the security boundary clean.
create or replace function public.nibbin_resume(p_nibbin uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  uid           uuid := (select auth.uid());
  v_account     uuid;
  v_status      text;
  v_paused_reason text;
begin
  select n.account_id, n.status, n.paused_reason
    into v_account, v_status, v_paused_reason
    from public.nibbins n where n.id = p_nibbin for update;
  if not found
     or (uid is not null and not (select private.is_account_member(v_account)))
  then
    raise exception 'unknown nibbin %', p_nibbin;
  end if;
  if uid is null and current_setting('role', true) <> 'service_role' then
    raise exception 'not authenticated';
  end if;

  if v_status <> 'paused' then
    raise exception 'nibbin % is not paused (status: %)', p_nibbin, v_status;
  end if;
  if v_paused_reason <> 'user' then
    raise exception 'nibbin % was paused by the system (reason: %) — resolve via the relevant system path',
      p_nibbin, v_paused_reason;
  end if;

  update public.nibbins
     set status = 'active', paused_reason = null
   where id = p_nibbin;

  insert into public.audit_log (account_id, actor, actor_id, action, subject, meta)
  values (
    v_account,
    coalesce(case when uid is null then 'system' end, 'user'),
    coalesce(uid::text, 'runtime'),
    'nibbin.resume',
    p_nibbin::text,
    '{}'::jsonb
  );
end;
$$;
revoke execute on function public.nibbin_resume(uuid) from public, anon;
grant  execute on function public.nibbin_resume(uuid) to authenticated, service_role;

-- ── nibbin_sleep ──────────────────────────────────────────────────────────────
-- Archives a nibbin ("soft delete"): sets status='sleeping' and kills any
-- in-flight or queued runs so they don't hold credits or dangling state.
-- Nibbins are never hard-deleted; sleeping ones are simply hidden from the
-- roster query (the caller must filter .neq('status','sleeping')).
create or replace function public.nibbin_sleep(p_nibbin uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  uid       uuid := (select auth.uid());
  v_account uuid;
  v_status  text;
begin
  select n.account_id, n.status into v_account, v_status
    from public.nibbins n where n.id = p_nibbin for update;
  if not found
     or (uid is not null and not (select private.is_account_member(v_account)))
  then
    raise exception 'unknown nibbin %', p_nibbin;
  end if;
  if uid is null and current_setting('role', true) <> 'service_role' then
    raise exception 'not authenticated';
  end if;

  if v_status = 'sleeping' then
    raise exception 'nibbin % is already sleeping', p_nibbin;
  end if;

  -- Kill any runs that are still active so they don't block credits or re-fire.
  update public.runs
     set status = 'killed'
   where nibbin_id = p_nibbin
     and status in ('running', 'queued');

  update public.nibbins
     set status = 'sleeping', paused_reason = null
   where id = p_nibbin;

  insert into public.audit_log (account_id, actor, actor_id, action, subject, meta)
  values (
    v_account,
    coalesce(case when uid is null then 'system' end, 'user'),
    coalesce(uid::text, 'runtime'),
    'nibbin.sleep',
    p_nibbin::text,
    '{}'::jsonb
  );
end;
$$;
revoke execute on function public.nibbin_sleep(uuid) from public, anon;
grant  execute on function public.nibbin_sleep(uuid) to authenticated, service_role;
