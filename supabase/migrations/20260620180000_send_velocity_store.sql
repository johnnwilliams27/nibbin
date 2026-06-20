-- C8 hardening: durable, atomic send-velocity store for write-capable connectors.
--
-- Replaces the in-process MemorySendRecordStore TOCTOU (read-then-write in two
-- statements) with a single atomic check-and-record in a security-definer RPC
-- serialized by advisory lock per account. Two concurrent sends cannot both
-- pass the cap — the advisory lock serializes the count→check→insert triple.
--
-- The new table uses connector_id (the stable descriptor id, e.g. 'gmail') rather
-- than the generic 'provider' column used by the existing send_records table so
-- the two surfaces stay orthogonal and migration is additive-only.

-- ── table ─────────────────────────────────────────────────────────────────────

create table public.send_velocity_records (
  id           uuid        primary key default gen_random_uuid(),
  account_id   uuid        not null references public.accounts (id) on delete cascade,
  connector_id text        not null check (btrim(connector_id) <> ''),
  sent_at      timestamptz not null default now()
);

-- Covering index for the two window queries inside the RPC (hourly + daily).
create index send_velocity_records_window_idx
  on public.send_velocity_records (account_id, connector_id, sent_at);

-- RLS: service_role only (no user-facing read surface — raw send timestamps are
-- operational metadata, not user content, and have no legitimate client-side use).
alter table public.send_velocity_records enable row level security;

-- Tamper-evidence: no in-place edits; CASCADE delete for account purge is allowed.
create trigger send_velocity_records_no_update
  before update on public.send_velocity_records
  for each row execute function private.raise_append_only();
create trigger send_velocity_records_no_truncate
  before truncate on public.send_velocity_records
  for each statement execute function private.raise_append_only();

-- ── atomic check-and-record RPC ───────────────────────────────────────────────
--
-- send_velocity_check_and_record(account_id, connector_id, hourly_cap, daily_cap)
--
-- Atomicity guarantee: pg_advisory_xact_lock serializes all concurrent callers
-- for the same account so the count→check→insert triple is never interleaved.
-- The lock key is scoped to 'nibbin:velocity:<account_id>' — broader than
-- per-connector so a single account cannot race across two different connectors
-- (a future multi-connector send path).
--
-- Returns:
--   allowed   boolean — true iff both caps were under limit and the row was inserted
--   used_hour int     — sends in the last hour AFTER the potential insert
--   used_day  int     — sends in the last 24 hours AFTER the potential insert
--
-- Error semantics: any exception propagates to the caller. The TS client maps
-- exceptions to allowed=false (fail-closed).

create function public.send_velocity_check_and_record(
  p_account_id   uuid,
  p_connector_id text,
  p_hourly_cap   integer,
  p_daily_cap    integer
)
returns table (allowed boolean, used_hour integer, used_day integer)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_day_count  integer;
  v_hour_count integer;
begin
  -- Serialize per account: two concurrent sends on the same account cannot both
  -- pass the check phase. The key is account-scoped (not connector-scoped) to
  -- cover future multi-connector dispatch without changing the lock schema.
  perform pg_advisory_xact_lock(
    hashtextextended('nibbin:velocity:' || p_account_id::text, 0)
  );

  -- Count sends in the last 24 hours (daily window).
  select count(*)::integer into v_day_count
    from public.send_velocity_records
   where account_id   = p_account_id
     and connector_id = p_connector_id
     and sent_at      > now() - interval '24 hours';

  if v_day_count >= p_daily_cap then
    -- Over daily cap — do not insert. Return current counts.
    select count(*)::integer into v_hour_count
      from public.send_velocity_records
     where account_id   = p_account_id
       and connector_id = p_connector_id
       and sent_at      > now() - interval '1 hour';
    return query select false, v_hour_count, v_day_count;
    return;
  end if;

  -- Count sends in the last hour (hourly window).
  select count(*)::integer into v_hour_count
    from public.send_velocity_records
   where account_id   = p_account_id
     and connector_id = p_connector_id
     and sent_at      > now() - interval '1 hour';

  if v_hour_count >= p_hourly_cap then
    -- Over hourly cap — do not insert.
    return query select false, v_hour_count, v_day_count;
    return;
  end if;

  -- Both caps clear: record the send.
  insert into public.send_velocity_records (account_id, connector_id)
  values (p_account_id, p_connector_id);

  -- Return post-insert counts (including this row).
  return query select true, v_hour_count + 1, v_day_count + 1;
end;
$$;

revoke execute on function public.send_velocity_check_and_record(uuid, text, integer, integer)
  from public, anon, authenticated;
grant execute on function public.send_velocity_check_and_record(uuid, text, integer, integer)
  to service_role;
