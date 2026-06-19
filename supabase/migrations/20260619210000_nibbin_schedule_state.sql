-- Scheduled execution engine (design 2026-06-19) — the durable per-(nibbin,
-- schedule_key) due-state + exactly-once claim for the nibbin-schedule cron.
--
-- This is the FIRST always-on autonomous cadence, but it grants NO autonomy:
-- the engine only decides WHEN to launch a run. Every launched run still rides
-- the unchanged, School-gated runner (run_begin / gateSideEffect / write-grant
-- / idempotency) — grep this file: it never touches run_begin, nibbin_promote,
-- or any gate. The only effect of a state row is "this occurrence is due to
-- launch a supervised run".
--
-- Conventions follow M4 / training_sessions: RLS on the account-scoped table,
-- member-read only; ALL mutations through security-definer RPCs under
-- search_path=''. The seed/claim RPCs are INFRA (the cron's service role
-- consumes them), so they are service_role-only — never granted to
-- authenticated (a client can never seed or advance its own cadence).

create table public.nibbin_schedule_state (
  nibbin_id uuid not null references public.nibbins (id) on delete cascade,
  account_id uuid not null references public.accounts (id) on delete cascade,
  schedule_key text not null,
  -- the occurrence we are waiting to fire (the conditional claim fires iff
  -- next_run_at <= now, then advances this to the following occurrence).
  next_run_at timestamptz not null,
  -- last instant a claim fired this (nibbin, schedule_key); null until first fire.
  last_fired_at timestamptz,
  primary key (nibbin_id, schedule_key)
);
-- The due scan orders by next_run_at; this index keeps it cheap as state grows.
create index nibbin_schedule_state_next_run_idx on public.nibbin_schedule_state (next_run_at);

alter table public.nibbin_schedule_state enable row level security;
-- Member-read for observability (a member can see their agents' cadence state);
-- no client write path — the cron's service role seeds/claims via the RPCs.
create policy nibbin_schedule_state_member_read on public.nibbin_schedule_state
  for select to authenticated using ((select private.is_account_member(account_id)));
revoke all on public.nibbin_schedule_state from anon;
revoke insert, update, delete, truncate, references, trigger
  on public.nibbin_schedule_state from authenticated;

-- ── seed: register a FUTURE occurrence the first time the scheduler sees a
--    (nibbin, schedule_key). Idempotent (on conflict do nothing) so a re-scan
--    never overwrites an in-flight next_run_at. Seeds future → NEVER fires on
--    first sight (adoption already does a first run). Service-role only. ────────
create function public.schedule_seed(
  p_nibbin uuid,
  p_account uuid,
  p_schedule_key text,
  p_next_run_at timestamptz
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.nibbin_schedule_state (nibbin_id, account_id, schedule_key, next_run_at)
  values (p_nibbin, p_account, p_schedule_key, p_next_run_at)
  on conflict (nibbin_id, schedule_key) do nothing;
end;
$$;
revoke execute on function public.schedule_seed(uuid, uuid, text, timestamptz) from public, anon, authenticated;
grant execute on function public.schedule_seed(uuid, uuid, text, timestamptz) to service_role;

-- ── claim_and_advance: the EXACTLY-ONCE claim. The conditional UPDATE only
--    matches when the row is still due (next_run_at <= p_now); the first cron's
--    update advances next_run_at into the future, so a SECOND concurrent cron's
--    `where next_run_at <= p_now` matches 0 rows → returns false → does NOT fire.
--    Catch-up-safe: after a missed tick it fires ONCE (advancing one occurrence),
--    not N times. Returns true iff THIS call claimed the occurrence. The caller
--    fires the run ONLY on a true return. Service-role only. ────────────────────
create function public.schedule_claim_and_advance(
  p_nibbin uuid,
  p_schedule_key text,
  p_now timestamptz,
  p_next_run_at timestamptz
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.nibbin_schedule_state
     set last_fired_at = p_now,
         next_run_at = p_next_run_at
   where nibbin_id = p_nibbin
     and schedule_key = p_schedule_key
     and next_run_at <= p_now;
  return found;
end;
$$;
revoke execute on function public.schedule_claim_and_advance(uuid, text, timestamptz, timestamptz) from public, anon, authenticated;
grant execute on function public.schedule_claim_and_advance(uuid, text, timestamptz, timestamptz) to service_role;
