-- Training Mode (SPEC §18.1: "sampled + time-boxed") — STRICTLY ADDITIVE to
-- Agent School (§4.7). A user opts an agent into a time-boxed, budget-bounded
-- window during which the scheduler MAY sample more triggers, surfacing more
-- drafts-for-approval so the agent accumulates School's approval signal faster.
--
-- This migration is PROVABLY non-loosening:
--   * it adds a NEW table + NEW RPCs only; it alters NOTHING in the M4 gate path
--     (gateSideEffect lives in the runtime; nibbin_promote / decide_run /
--     run_begin are UNTOUCHED here — grep this file: it never references them).
--   * a window has a HARD time box (expires_at) AND a HARD run budget (max_runs)
--     AND is opt-in (only a member opens it) AND auto-expires (active() ignores
--     past-expiry / over-budget rows; no row ever "extends" itself).
--   * it grants NO autonomy: nothing here can execute a side effect or promote a
--     Nibbin. The only effect of a window is that the scheduler may admit extra
--     SUPERVISED runs — each of which still rides the unchanged runner gates.
--
-- Conventions follow M4 / channel_budgets: RLS on the account-scoped table,
-- member-read only; mutations through security-definer RPCs under search_path=''.

create table public.training_sessions (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references public.accounts (id) on delete cascade,
  nibbin_id uuid not null references public.nibbins (id) on delete cascade,
  started_at timestamptz not null default now(),
  -- HARD time box: a window is dead at/after this instant, no sweep required.
  -- CHECK keeps it within [1 hour, 14 days] of start (mirrors the TS clamp).
  expires_at timestamptz not null,
  -- HARD run budget: at most this many EXTRA sampled runs. [1, 100].
  max_runs integer not null check (max_runs >= 1 and max_runs <= 100),
  runs_used integer not null default 0 check (runs_used >= 0 and runs_used <= max_runs),
  novelty boolean not null default false,
  -- set when the window closes (user opt-out / budget / expiry / promotion).
  ended_at timestamptz,
  ended_reason text check (
    (ended_at is null) = (ended_reason is null)
    and (ended_reason is null or ended_reason in ('expired', 'budget', 'user', 'promoted'))
  ),
  constraint training_window_bounds check (
    expires_at > started_at
    and expires_at <= started_at + interval '14 days'
    and expires_at >= started_at + interval '1 hour'
  )
);
create index training_sessions_account_idx on public.training_sessions (account_id, nibbin_id);
-- At most ONE open window per agent (the opt-in is idempotent). A window is
-- "open" while ended_at is null; closed rows are unconstrained history.
create unique index training_sessions_one_open
  on public.training_sessions (nibbin_id) where ended_at is null;

alter table public.training_sessions enable row level security;
create policy training_sessions_member_read on public.training_sessions
  for select to authenticated using ((select private.is_account_member(account_id)));
revoke all on public.training_sessions from anon;
revoke insert, update, delete, truncate, references, trigger
  on public.training_sessions from authenticated;

-- ── open: the opt-in. A member enables training for THEIR agent. Idempotent —
--    returns the existing open window (never opens a second budget). Clamps the
--    duration + budget to the conservative bounds in SQL (defense in depth with
--    the TS clampWindow). Grants NO autonomy: it only writes a bounded row. ────
create function public.training_open(
  p_nibbin uuid,
  p_duration_secs integer,
  p_max_runs integer,
  p_novelty boolean
)
returns public.training_sessions
language plpgsql
security definer
set search_path = ''
as $$
declare
  -- Per-account cap on simultaneously-open windows. Bounds aggregate training
  -- cost (N agents × up-to-100 extra runs each) ahead of the scheduler wiring.
  max_open_per_account constant integer := 3;
  uid uuid := (select auth.uid());
  v_account uuid;
  v_dur interval;
  v_runs integer;
  v_open integer;
  v_row public.training_sessions;
begin
  select n.account_id into v_account from public.nibbins n where n.id = p_nibbin for update;
  if not found or (uid is not null and not (select private.is_account_member(v_account))) then
    raise exception 'unknown nibbin %', p_nibbin;
  end if;
  if uid is null and current_setting('role', true) <> 'service_role' then
    raise exception 'not authenticated';
  end if;

  -- Re-open lockout fix: with no sweep/cron, a window that is past its time box
  -- but not yet closed still has ended_at IS NULL, so it (a) is skipped by the
  -- idempotency SELECT below (which requires now() < expires_at) yet (b) still
  -- occupies the training_sessions_one_open partial unique index — so the INSERT
  -- would raise unique_violation and lock the user out of re-opening training for
  -- this agent. Close any such stale, expired-but-open row FIRST (we hold the
  -- nibbins row lock via the FOR UPDATE above, so this is race-free per agent),
  -- then the idempotency SELECT + INSERT proceed cleanly.
  update public.training_sessions
     set ended_at = now(), ended_reason = 'expired'
   where nibbin_id = p_nibbin and ended_at is null and now() >= expires_at;

  -- idempotent: an already-open window wins (under the unique-open index).
  select * into v_row from public.training_sessions
    where nibbin_id = p_nibbin and ended_at is null
    -- only a window that is still within its time box counts as open
    and now() < expires_at;
  if found then
    return v_row;
  end if;

  -- Per-account cap is checked only on the INSERT path (after idempotency found
  -- no open window): re-opening an EXISTING window for the same agent above
  -- always succeeds, so the cap can never strand an agent that is already open.
  select count(*) into v_open from public.training_sessions
    where account_id = v_account and ended_at is null;
  if v_open >= max_open_per_account then
    raise exception 'training open-window limit reached for this account (max %)', max_open_per_account
      using errcode = 'check_violation';
  end if;

  -- clamp to [1 hour, 14 days] and [1, 100] runs (CHECKs also enforce this).
  v_dur := make_interval(secs => greatest(least(p_duration_secs, 14 * 24 * 3600), 3600));
  v_runs := greatest(least(p_max_runs, 100), 1);

  insert into public.training_sessions (account_id, nibbin_id, expires_at, max_runs, novelty)
  values (v_account, p_nibbin, now() + v_dur, v_runs, coalesce(p_novelty, false))
  returning * into v_row;
  return v_row;
end;
$$;
revoke execute on function public.training_open(uuid, integer, integer, boolean) from public, anon;
grant execute on function public.training_open(uuid, integer, integer, boolean) to authenticated, service_role;

-- ── sample: the scheduler consumes ONE budget unit when it admits an extra
--    sampled run inside an open window. Atomic (FOR UPDATE), fail-closed: it
--    returns NULL when the window is closed/expired/over-budget — the caller
--    simply does NOT launch an extra run (the agent's ordinary cadence is
--    unaffected). Auto-closes the row when the budget hits zero. Service-role
--    only: a client can never accelerate its own sampling. NO autonomy: this
--    returns a count, never executes anything. ─────────────────────────────────
create function public.training_sample(p_nibbin uuid)
returns integer  -- runs_remaining after consuming; NULL = not sampled
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_row public.training_sessions;
begin
  select * into v_row from public.training_sessions
    where nibbin_id = p_nibbin and ended_at is null
    for update;
  if not found then
    return null;
  end if;
  -- time box closed: mark expired, do not sample.
  if now() >= v_row.expires_at then
    update public.training_sessions set ended_at = now(), ended_reason = 'expired'
      where id = v_row.id;
    return null;
  end if;
  -- budget exhausted (defensive: the unique-open index + auto-close below should
  -- prevent this state, but fail closed).
  if v_row.runs_used >= v_row.max_runs then
    update public.training_sessions set ended_at = now(), ended_reason = 'budget'
      where id = v_row.id and ended_at is null;
    return null;
  end if;

  update public.training_sessions
     set runs_used = runs_used + 1,
         ended_at = case when runs_used + 1 >= max_runs then now() else null end,
         ended_reason = case when runs_used + 1 >= max_runs then 'budget' else null end
   where id = v_row.id
   returning * into v_row;
  return v_row.max_runs - v_row.runs_used;
end;
$$;
revoke execute on function public.training_sample(uuid) from public, anon, authenticated;
grant execute on function public.training_sample(uuid) to service_role;

-- ── close: the user opt-out (one click), and the path a promotion uses to end
--    training cleanly. Member-checked; no-op if already closed. ─────────────────
create function public.training_close(p_nibbin uuid, p_reason text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  uid uuid := (select auth.uid());
  v_account uuid;
begin
  select n.account_id into v_account from public.nibbins n where n.id = p_nibbin;
  if not found or (uid is not null and not (select private.is_account_member(v_account))) then
    raise exception 'unknown nibbin %', p_nibbin;
  end if;
  if uid is null and current_setting('role', true) <> 'service_role' then
    raise exception 'not authenticated';
  end if;

  update public.training_sessions
     set ended_at = now(),
         ended_reason = case when p_reason in ('expired','budget','user','promoted') then p_reason else 'user' end
   where nibbin_id = p_nibbin and ended_at is null;
end;
$$;
revoke execute on function public.training_close(uuid, text) from public, anon;
grant execute on function public.training_close(uuid, text) to authenticated, service_role;
