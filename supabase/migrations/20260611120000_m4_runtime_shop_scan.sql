-- M4: agent specs, nibbins, runs, approvals, scan results, product events,
-- side-effect idempotency, send-velocity records, and the runtime RPCs.
-- SPEC §4.6/§4.7 (shop + Agent School), §6.2 (runtime invariants), §6.4
-- (weighted credits), §6.12 (event taxonomy). docs/INVARIANTS.md: RLS via
-- membership on every account-scoped table; append-only where history is the
-- product; weighted credits 1/3/10; School gates side effects at the runtime
-- layer; no mechanic may grant autonomy except verified accuracy.
--
-- Conventions follow M1/M3: RLS on every account-scoped table, client roles
-- get SELECT through membership policies only, all client writes go through
-- security-definer functions or the service role, anon gets nothing.
--
-- Concurrency: every credit/run mutation runs under a per-account advisory
-- transaction lock (private.lock_account) so balance checks, refund caps and
-- admission checks cannot race (GOTCHAS: "enforce the per-run refund cap in a
-- security-definer function under per-account serialization").

-- ── agent specs (§6.1 sketch; snapshot-per-adoption) ─────────────────────────
-- Shop templates live in code (packages/runtime). Adoption snapshots the
-- validated template (or a validated custom spec) into a row scoped to the
-- account, so every Nibbin carries the exact spec version it was hatched with.

create table public.agent_specs (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references public.accounts (id) on delete cascade,
  -- shop template key ('sweep'…'scribe'); null for custom hatch-wizard specs
  template_key text check (template_key is null or btrim(template_key) <> ''),
  version integer not null check (version >= 1),
  display_name text not null check (btrim(display_name) <> ''),
  tools_allowlist text[] not null default '{}',
  required_connectors text[] not null default '{}',
  triggers jsonb not null default '[]'::jsonb check (jsonb_typeof(triggers) = 'array'),
  curriculum jsonb not null default '{}'::jsonb,
  credit_profile jsonb not null default '{}'::jsonb,
  -- set by adopt_nibbin: rows only exist after app-layer validation (trigger
  -- graph cycle check + tool allowlist vs the connector registry). Clients
  -- cannot insert here at all (service-role write path only).
  validated_at timestamptz not null,
  created_at timestamptz not null default now()
);
create index agent_specs_account_idx on public.agent_specs (account_id);

-- ── nibbins (§6.1) ───────────────────────────────────────────────────────────

create table public.nibbins (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references public.accounts (id) on delete cascade,
  kind text not null default 'specialist' check (kind in ('keeper', 'specialist')),
  spec_id uuid not null references public.agent_specs (id) on delete restrict,
  name text not null check (btrim(name) <> ''),
  species text not null check (species in ('Sprout', 'Wisp', 'Shellback', 'Longear', 'Puff', 'Glim', 'Keeper')),
  -- Agent School (§4.7). Stage changes ONLY through nibbin_promote /
  -- nibbin_demote below — there is no other write path for clients, and the
  -- promote function re-verifies accuracy in SQL ("never time-served").
  stage text not null default 'egg' check (stage in ('egg', 'student', 'senior', 'grad')),
  -- when the CURRENT stage began — the promotion window only counts decisions
  -- after this, so each stage is earned on its own merits and a demotion truly
  -- resets the climb (no re-promote on one stale approval). §4.7.
  stage_changed_at timestamptz not null default now(),
  palette text,
  accessory text,
  marking text,
  seed integer,
  status text not null default 'active' check (status in ('active', 'paused', 'sleeping')),
  -- why paused: 'anomaly' (§6.2 auto-pause), 'cap', 'connection', 'user'
  paused_reason text check (
    (status = 'paused') = (paused_reason is not null)
    and (paused_reason is null or paused_reason in ('anomaly', 'cap', 'connection', 'user'))
  ),
  hatched_at timestamptz not null default now()
);
create index nibbins_account_idx on public.nibbins (account_id, status);

-- ── runs + steps + approvals (§6.1) ──────────────────────────────────────────

create table public.runs (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references public.accounts (id) on delete cascade,
  nibbin_id uuid not null references public.nibbins (id) on delete restrict,
  -- {kind: 'user'|'schedule'|'event', key?, dedupeKey?}
  trigger jsonb not null default '{}'::jsonb,
  status text not null default 'running' check (
    status in ('queued', 'running', 'awaiting_approval', 'completed', 'rejected', 'failed', 'killed')
  ),
  -- present exactly while queued ('cap': §6.2 pause politely, queue, explain)
  queued_reason text check ((status = 'queued') = (queued_reason is not null)),
  weight_class text not null check (weight_class in ('standard', 'frontier', 'computer_use')),
  credits_charged integer not null default 0 check (credits_charged >= 0),
  model_mix jsonb not null default '{}'::jsonb,
  started_at timestamptz,
  ended_at timestamptz,
  created_at timestamptz not null default now()
);
create index runs_account_idx on public.runs (account_id, created_at);
create index runs_nibbin_idx on public.runs (nibbin_id, created_at);

create table public.run_steps (
  id uuid primary key default gen_random_uuid(),
  run_id uuid not null references public.runs (id) on delete cascade,
  account_id uuid not null references public.accounts (id) on delete cascade,
  idx integer not null check (idx >= 0),
  kind text not null check (kind in ('read', 'compose', 'tool', 'draft', 'execute')),
  tool text,
  input_hash text,
  output_ref text,
  model text,
  tokens integer not null default 0 check (tokens >= 0),
  -- structured step output (draft text for approval cards, deterministic
  -- evidence) — never raw quarantined connector dumps
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  unique (run_id, idx)
);
create index run_steps_account_idx on public.run_steps (account_id);

create table public.approvals (
  id uuid primary key default gen_random_uuid(),
  run_id uuid not null unique references public.runs (id) on delete cascade,
  account_id uuid not null references public.accounts (id) on delete cascade,
  user_id uuid not null references public.users (id),
  decision text not null check (decision in ('approved', 'edited', 'rejected')),
  edit_distance integer not null default 0 check (edit_distance >= 0),
  decided_at timestamptz not null default now()
);
create index approvals_account_idx on public.approvals (account_id, decided_at);

-- ── per-Nibbin write grants (C8 structural rows — issue #26 / IG client F3) ──
-- A side effect may execute ONLY when a grant row exists for exactly that
-- (nibbin, connection, capability) — the runtime layer's structural authority,
-- replacing the mutable connection.scopes marker that the connector clients
-- still trust. Granting happens at adoption time with a plain-language
-- explanation.
--   PARTIAL at M4 (tracked, #26 stays OPEN): the runtime honors these rows, but
--   (a) no code writes them yet — v0 ships no write path (the effect executor
--   fails closed), so the table is intentionally empty; (b) connection revoke
--   does not yet null revoked_at on dependent grants or set
--   nibbins.paused_reason='connection' — the FK cascade only fires on row
--   DELETE, and M3 revoke keeps the connection row. The grant writer + the
--   revoke→pause cascade land with the first real write adoption, BEFORE
--   Instagram/QuickBooks go live (the #26 condition).

create table public.nibbin_write_grants (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references public.accounts (id) on delete cascade,
  nibbin_id uuid not null references public.nibbins (id) on delete cascade,
  connection_id uuid not null references public.connections (id) on delete cascade,
  capability text not null check (btrim(capability) <> ''),
  granted_by uuid references public.users (id),
  granted_at timestamptz not null default now(),
  revoked_at timestamptz,
  unique (nibbin_id, connection_id, capability)
);
create index nibbin_write_grants_account_idx on public.nibbin_write_grants (account_id);

create function private.log_write_grant()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.audit_log (account_id, actor, actor_id, action, subject, meta)
  values (
    new.account_id, 'user', coalesce(new.granted_by::text, 'service'),
    'nibbin.write_granted', new.nibbin_id::text,
    jsonb_build_object('capability', new.capability, 'connection_id', new.connection_id)
  );
  return new;
end;
$$;

create trigger nibbin_write_grants_audit
  after insert on public.nibbin_write_grants
  for each row execute function private.log_write_grant();

-- ── side-effect idempotency (§6.2: idempotency keys on every side effect) ────
-- Claim-then-execute: the unique key makes the claim atomic; executed_at
-- separates "claimed" from "done" (GOTCHAS #28: seen ≠ processed). A claim
-- with executed_at null after a crash means outcome-unknown — the runtime
-- must NOT retry the same key (at-most-once for outbound sends).

create table public.side_effects (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references public.accounts (id) on delete cascade,
  run_id uuid not null references public.runs (id) on delete cascade,
  step_idx integer not null check (step_idx >= 0),
  capability text not null check (btrim(capability) <> ''),
  idempotency_key text not null check (btrim(idempotency_key) <> ''),
  claimed_at timestamptz not null default now(),
  executed_at timestamptz,
  unique (account_id, idempotency_key)
);

-- ── send-velocity records (RISKS §2; atomic via send_velocity_consume) ───────

create table public.send_records (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references public.accounts (id) on delete cascade,
  provider text not null check (btrim(provider) <> ''),
  sent_at timestamptz not null default now()
);
create index send_records_window_idx on public.send_records (account_id, provider, sent_at);

-- ── scan results (§4.4) ──────────────────────────────────────────────────────

create table public.scan_results (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references public.accounts (id) on delete cascade,
  connection_id uuid references public.connections (id) on delete set null,
  -- one scan run = one batch; "latest scan" is the max batch for the account
  batch_id uuid not null,
  module text not null check (btrim(module) <> ''),
  finding jsonb not null,
  computed_at timestamptz not null default now()
);
create index scan_results_account_idx on public.scan_results (account_id, batch_id);

-- ── product events (§6.12; cookieless, our own Postgres) ─────────────────────
-- NOTE on append-only vs retention: run_steps, approvals, and product_events
-- are operational/analytics records governed by the §6.11 retention clocks
-- (run logs 90d, account ≤30d post-deletion), NOT permanent ledgers like
-- credit_ledger/audit_log. They are tamper-evident (UPDATE blocked) but MUST
-- remain deletable so the retention purge jobs and account-deletion cascade
-- (issue #29) can run — blocking DELETE here would make the published clocks
-- structurally impossible (claims-auditor F-3/F-4). FKs therefore cascade.

create table public.product_events (
  id uuid primary key default gen_random_uuid(),
  account_id uuid references public.accounts (id) on delete cascade,
  user_id uuid references public.users (id) on delete set null,
  name text not null check (name ~ '^[a-z][a-z0-9_]{1,63}$'),
  props jsonb not null default '{}'::jsonb,
  at timestamptz not null default now()
);
create index product_events_name_idx on public.product_events (name, at);
create index product_events_account_idx on public.product_events (account_id, at);

-- tamper-evidence only: no in-place edits, but deletion (retention/erasure) is
-- allowed. Truncate stays blocked so a stray TRUNCATE can't wipe history.
create trigger product_events_no_update
  before update on public.product_events
  for each row execute function private.raise_append_only();
create trigger product_events_no_truncate
  before truncate on public.product_events
  for each statement execute function private.raise_append_only();

create trigger approvals_no_update
  before update on public.approvals
  for each row execute function private.raise_append_only();
create trigger approvals_no_truncate
  before truncate on public.approvals
  for each statement execute function private.raise_append_only();

create trigger run_steps_no_update
  before update on public.run_steps
  for each row execute function private.raise_append_only();
create trigger run_steps_no_truncate
  before truncate on public.run_steps
  for each statement execute function private.raise_append_only();

-- ── credit_ledger.run_id becomes a real FK (deferred from M1) ────────────────
-- No 'run'/'refund' writer existed before M4, so every existing run_id is null
-- and the type change is safe.

-- the M1 btrim() shape check is superseded by uuid typing + the FK below
alter table public.credit_ledger drop constraint if exists credit_ledger_run_id_check;
alter table public.credit_ledger
  alter column run_id type uuid using run_id::uuid;
alter table public.credit_ledger
  add constraint credit_ledger_run_fk
  foreign key (run_id) references public.runs (id) on delete restrict;

-- ── per-account serialization helper ─────────────────────────────────────────

create function private.lock_account(target_account uuid)
returns void
language sql
as $$
  select pg_advisory_xact_lock(hashtextextended('nibbin:account:' || target_account::text, 0));
$$;
revoke execute on function private.lock_account(uuid) from public, anon, authenticated;
grant execute on function private.lock_account(uuid) to service_role;

create function private.account_balance(target_account uuid)
returns integer
language sql
stable
as $$
  select coalesce(sum(delta), 0)::integer from public.credit_ledger where account_id = target_account;
$$;
revoke execute on function private.account_balance(uuid) from public, anon, authenticated;
grant execute on function private.account_balance(uuid) to service_role;

-- Shared admission gate (§6.2): cooldown + anomaly auto-pause. Both run_begin
-- and run_resume call it under the account lock, so a cap-queued run cannot
-- launch past the anomaly ceiling when it finally resumes. "Ran today" and the
-- cooldown clock key on started_at (queued runs have null started_at and never
-- count), so a run resumed today counts toward today's anomaly window, not the
-- day it was first queued. UTC day windows on purpose (user tz must not roll
-- the window — GOTCHAS). Returns 'cooldown' | 'anomaly_paused' | null (= admit);
-- on anomaly it pauses the Nibbin and audits, as a side effect.
create function private.run_admission_block(
  p_account uuid,
  p_nibbin uuid,
  p_cooldown_secs integer,
  p_anomaly_multiplier numeric,
  p_anomaly_floor integer
)
returns text
language plpgsql
as $$
declare
  v_last timestamptz;
  v_today integer;
  v_baseline numeric;
begin
  select max(r.started_at) into v_last
    from public.runs r
    where r.nibbin_id = p_nibbin and r.started_at is not null;
  if v_last is not null and v_last > now() - make_interval(secs => p_cooldown_secs) then
    return 'cooldown';
  end if;

  select count(*) into v_today
    from public.runs r
    where r.nibbin_id = p_nibbin and r.started_at >= date_trunc('day', now());
  select count(*) / 7.0 into v_baseline
    from public.runs r
    where r.nibbin_id = p_nibbin
      and r.started_at >= date_trunc('day', now()) - interval '7 days'
      and r.started_at < date_trunc('day', now());
  if v_today + 1 > greatest(p_anomaly_floor, ceil(p_anomaly_multiplier * v_baseline)) then
    update public.nibbins set status = 'paused', paused_reason = 'anomaly'
      where id = p_nibbin and status = 'active';
    insert into public.audit_log (account_id, actor, actor_id, action, subject, meta)
    values (p_account, 'system', 'runtime', 'nibbin.anomaly_paused', p_nibbin::text,
      jsonb_build_object('today', v_today, 'baseline_per_day', round(v_baseline, 2)));
    return 'anomaly_paused';
  end if;
  return null;
end;
$$;
revoke execute on function private.run_admission_block(uuid, uuid, integer, numeric, integer) from public, anon, authenticated;
grant execute on function private.run_admission_block(uuid, uuid, integer, numeric, integer) to service_role;

-- ── adoption (tier cap enforced here; spec validation happens app-side and
--    only the service role can reach this function) ──────────────────────────

create function public.adopt_nibbin(
  p_account uuid,
  p_actor_user uuid,
  p_template_key text,
  p_version integer,
  p_display_name text,
  p_tools_allowlist text[],
  p_required_connectors text[],
  p_triggers jsonb,
  p_curriculum jsonb,
  p_credit_profile jsonb,
  p_name text,
  p_species text,
  p_palette text,
  p_accessory text,
  p_marking text,
  p_seed integer
)
returns table (nibbin_id uuid, spec_id uuid)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_tier text;
  v_max integer;
  v_count integer;
  v_spec uuid;
  v_nibbin uuid;
begin
  perform private.lock_account(p_account);

  -- §6.4 tier caps: hatchling 2, grove 5, canopy unlimited. No subscription
  -- row means the free tier.
  select tier into v_tier from public.subscriptions where account_id = p_account;
  v_max := case coalesce(v_tier, 'hatchling')
    when 'hatchling' then 2
    when 'grove' then 5
    else null
  end;
  if v_max is not null then
    -- sleeping Nibbins (downgrade — they sleep, never deleted) don't occupy a
    -- slot; waking one re-enters through this same cap check.
    select count(*) into v_count
      from public.nibbins
      where account_id = p_account and kind = 'specialist' and status <> 'sleeping';
    if v_count >= v_max then
      raise exception 'nibbin limit reached for tier %', coalesce(v_tier, 'hatchling')
        using errcode = 'check_violation';
    end if;
  end if;

  insert into public.agent_specs (
    account_id, template_key, version, display_name, tools_allowlist,
    required_connectors, triggers, curriculum, credit_profile, validated_at
  ) values (
    p_account, p_template_key, p_version, p_display_name, p_tools_allowlist,
    p_required_connectors, p_triggers, p_curriculum, p_credit_profile, now()
  ) returning id into v_spec;

  insert into public.nibbins (
    account_id, kind, spec_id, name, species, stage, palette, accessory, marking, seed
  ) values (
    p_account, 'specialist', v_spec, btrim(p_name), p_species, 'egg',
    p_palette, p_accessory, p_marking, p_seed
  ) returning id into v_nibbin;

  insert into public.audit_log (account_id, actor, actor_id, action, subject, meta)
  values (
    p_account, 'user', coalesce(p_actor_user::text, 'service'), 'nibbin.adopted', v_nibbin::text,
    jsonb_build_object('template_key', p_template_key, 'version', p_version, 'species', p_species)
  );

  return query select v_nibbin, v_spec;
end;
$$;
revoke execute on function public.adopt_nibbin(uuid, uuid, text, integer, text, text[], text[], jsonb, jsonb, jsonb, text, text, text, text, text, integer) from public, anon, authenticated;
grant execute on function public.adopt_nibbin(uuid, uuid, text, integer, text, text[], text[], jsonb, jsonb, jsonb, text, text, text, text, text, integer) to service_role;

-- ── run admission + atomic charge (§6.2: pre-run budget check, debounce/
--    dedupe, per-Nibbin cooldown, anomaly auto-pause, at-cap queue) ───────────
-- One function under one per-account lock so none of these checks can race.
-- Outcomes: started | queued_cap | deduped | cooldown | anomaly_paused |
-- nibbin_unavailable.

create function public.run_begin(
  p_account uuid,
  p_nibbin uuid,
  p_trigger jsonb,
  p_weight text,
  p_dedupe_key text default null,
  p_debounce_secs integer default 300,
  p_cooldown_secs integer default 60,
  p_anomaly_multiplier numeric default 5,
  p_anomaly_floor integer default 10
)
returns table (run_id uuid, outcome text, balance integer)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_weight integer;
  v_status text;
  v_balance integer;
  v_block text;
  v_run uuid;
begin
  v_weight := case p_weight
    when 'standard' then 1
    when 'frontier' then 3
    when 'computer_use' then 10
  end;
  if v_weight is null then
    raise exception 'unknown weight class %', p_weight;
  end if;

  -- the dedupe key lives inside the stored trigger so the window check below
  -- works regardless of what shape the caller passed
  if p_dedupe_key is not null then
    p_trigger := coalesce(p_trigger, '{}'::jsonb) || jsonb_build_object('dedupeKey', p_dedupe_key);
  end if;

  perform private.lock_account(p_account);

  select n.status into v_status
    from public.nibbins n
    where n.id = p_nibbin and n.account_id = p_account
    for update;
  if not found then
    raise exception 'unknown nibbin % for account %', p_nibbin, p_account;
  end if;
  if v_status <> 'active' then
    return query select null::uuid, 'nibbin_unavailable'::text, private.account_balance(p_account);
    return;
  end if;

  -- trigger dedupe: same dedupe key inside the debounce window is one event
  if p_dedupe_key is not null then
    if exists (
      select 1 from public.runs r
      where r.nibbin_id = p_nibbin
        and r.trigger ->> 'dedupeKey' = p_dedupe_key
        and r.created_at > now() - make_interval(secs => p_debounce_secs)
    ) then
      return query select null::uuid, 'deduped'::text, private.account_balance(p_account);
      return;
    end if;
  end if;

  -- cooldown + anomaly auto-pause (§6.2), shared with run_resume
  v_block := private.run_admission_block(p_account, p_nibbin, p_cooldown_secs, p_anomaly_multiplier, p_anomaly_floor);
  if v_block is not null then
    return query select null::uuid, v_block, private.account_balance(p_account);
    return;
  end if;

  -- pre-run budget check against weighted credits (§6.2). At cap: queue the
  -- run, never silently degrade.
  v_balance := private.account_balance(p_account);
  if v_balance < v_weight then
    insert into public.runs (account_id, nibbin_id, trigger, status, queued_reason, weight_class)
    values (p_account, p_nibbin, coalesce(p_trigger, '{}'::jsonb), 'queued', 'cap', p_weight)
    returning id into v_run;
    return query select v_run, 'queued_cap'::text, v_balance;
    return;
  end if;

  insert into public.runs (account_id, nibbin_id, trigger, status, weight_class, credits_charged, started_at)
  values (p_account, p_nibbin, coalesce(p_trigger, '{}'::jsonb), 'running', p_weight, v_weight, now())
  returning id into v_run;

  insert into public.credit_ledger (account_id, delta, reason, run_id)
  values (p_account, -v_weight, 'run', v_run);

  return query select v_run, 'started'::text, v_balance - v_weight;
end;
$$;
revoke execute on function public.run_begin(uuid, uuid, jsonb, text, text, integer, integer, numeric, integer) from public, anon, authenticated;
grant execute on function public.run_begin(uuid, uuid, jsonb, text, text, integer, integer, numeric, integer) to service_role;

-- ── resume a cap-queued run once credits arrive (§6.2: queue, explain,
--    one-tap top-up) ──────────────────────────────────────────────────────────

create function public.run_resume(p_run uuid)
returns table (outcome text, balance integer)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_account uuid;
  v_nibbin uuid;
  v_status text;
  v_weight text;
  v_units integer;
  v_balance integer;
  v_nibbin_status text;
  v_block text;
begin
  select account_id, nibbin_id, status, weight_class into v_account, v_nibbin, v_status, v_weight
    from public.runs where id = p_run;
  if not found then
    raise exception 'unknown run %', p_run;
  end if;

  perform private.lock_account(v_account);

  select status into v_status from public.runs where id = p_run;
  if v_status <> 'queued' then
    raise exception 'run % is not queued', p_run;
  end if;

  -- a run cannot resume past the gates it would face fresh: a Nibbin paused
  -- (anomaly/user) or asleep since queuing must not launch, and the anomaly
  -- ceiling is re-evaluated as of NOW so a queue→top-up path can't blow past
  -- 5–10× baseline by draining the queue (logic-skeptic P1-1). Cooldown is a
  -- trigger-frequency control, not a queue gate — passing 0 lets backlogged
  -- work clear once the account can afford it; the anomaly ceiling still caps
  -- the daily volume.
  select status into v_nibbin_status from public.nibbins where id = v_nibbin for update;
  if v_nibbin_status <> 'active' then
    return query select 'nibbin_unavailable'::text, private.account_balance(v_account);
    return;
  end if;
  v_block := private.run_admission_block(v_account, v_nibbin, 0, 5, 10);
  if v_block is not null then
    return query select v_block, private.account_balance(v_account);
    return;
  end if;

  v_units := case v_weight when 'standard' then 1 when 'frontier' then 3 else 10 end;
  v_balance := private.account_balance(v_account);
  if v_balance < v_units then
    return query select 'still_capped'::text, v_balance;
    return;
  end if;

  update public.runs
    set status = 'running', queued_reason = null, credits_charged = v_units, started_at = now()
    where id = p_run;
  insert into public.credit_ledger (account_id, delta, reason, run_id)
  values (v_account, -v_units, 'run', p_run);

  return query select 'started'::text, v_balance - v_units;
end;
$$;
revoke execute on function public.run_resume(uuid) from public, anon, authenticated;
grant execute on function public.run_resume(uuid) to service_role;

-- ── run completion + auto-refund on failure ──────────────────────────────────
-- "An action is one completed task" (§6.4): failed/killed runs refund in the
-- same transaction, capped at the run's remaining charge (refund cap enforced
-- HERE, under the account lock — not in app code).

create function public.run_finish(
  p_run uuid,
  p_status text,
  p_model_mix jsonb default '{}'::jsonb
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_account uuid;
  v_old text;
  v_refundable integer;
begin
  if p_status not in ('awaiting_approval', 'completed', 'failed', 'killed') then
    raise exception 'run_finish cannot set status %', p_status;
  end if;

  select account_id, status into v_account, v_old from public.runs where id = p_run;
  if not found then
    raise exception 'unknown run %', p_run;
  end if;

  perform private.lock_account(v_account);

  if v_old not in ('running', 'queued') then
    raise exception 'run % is % — cannot finish', p_run, v_old;
  end if;
  -- a queued run never charged and never ran: it may only be cancelled
  -- (failed/killed), never marked completed/awaiting_approval — otherwise a
  -- free, unrun run could mint an approvable artifact (logic-skeptic P2-1).
  if v_old = 'queued' and p_status not in ('failed', 'killed') then
    raise exception 'queued run % can only be cancelled (failed/killed), not %', p_run, p_status;
  end if;

  update public.runs
    set status = p_status,
        queued_reason = null,
        model_mix = coalesce(p_model_mix, '{}'::jsonb),
        ended_at = case when p_status = 'awaiting_approval' then null else now() end
    where id = p_run;

  if p_status in ('failed', 'killed') then
    select coalesce(sum(case when reason = 'run' then -delta when reason = 'refund' then -delta end), 0)::integer
      into v_refundable
      from public.credit_ledger
      where run_id = p_run and reason in ('run', 'refund');
    if v_refundable > 0 then
      insert into public.credit_ledger (account_id, delta, reason, run_id)
      values (v_account, v_refundable, 'refund', p_run);
    end if;
  end if;
end;
$$;
revoke execute on function public.run_finish(uuid, text, jsonb) from public, anon, authenticated;
grant execute on function public.run_finish(uuid, text, jsonb) to service_role;

-- ── draft decision (the user's approve/edit/reject — §4.1 step 7) ────────────
-- Authenticated path: the caller must be an active member of the run's
-- account. One decision per run (unique run_id). Append-only approvals.

create function public.decide_run(
  p_run uuid,
  p_decision text,
  p_edit_distance integer default 0
)
returns table (decision text, decided_at timestamptz)
language plpgsql
security definer
set search_path = ''
as $$
declare
  uid uuid := (select auth.uid());
  v_account uuid;
  v_status text;
begin
  if uid is null then
    raise exception 'not authenticated';
  end if;
  if p_decision not in ('approved', 'edited', 'rejected') then
    raise exception 'unknown decision %', p_decision;
  end if;
  if p_edit_distance is null or p_edit_distance < 0 then
    raise exception 'edit distance must be >= 0';
  end if;
  -- the two decisions are kept honest at the data layer: an approved decision
  -- is unedited (distance 0); an edited one changed something (distance ≥ 1).
  -- This is the accuracy signal the promotion window reads — it must not be
  -- forgeable into "approved" when the user actually rewrote the draft.
  if p_decision = 'approved' and p_edit_distance <> 0 then
    raise exception 'an approved-unedited decision cannot carry edits';
  end if;
  if p_decision = 'edited' and p_edit_distance < 1 then
    raise exception 'an edited decision must carry a positive edit distance';
  end if;

  select account_id, status into v_account, v_status from public.runs where id = p_run;
  if not found or not (select private.is_account_member(v_account)) then
    -- same error for "missing" and "not yours": no existence oracle
    raise exception 'unknown run %', p_run;
  end if;
  if v_status <> 'awaiting_approval' then
    raise exception 'run % is not awaiting approval', p_run;
  end if;
  -- a decision must be ABOUT a drafted artifact — no minting approvals (which
  -- feed the promotion window) for runs with no draft step (logic-skeptic P3-9).
  if not exists (select 1 from public.run_steps s where s.run_id = p_run and s.kind = 'draft') then
    raise exception 'run % has no draft to decide on', p_run;
  end if;

  insert into public.approvals (run_id, account_id, user_id, decision, edit_distance)
  values (p_run, v_account, uid, p_decision, p_edit_distance);

  update public.runs
    set status = case when p_decision = 'rejected' then 'rejected' else 'completed' end,
        ended_at = now()
    where id = p_run;

  insert into public.audit_log (account_id, actor, actor_id, action, subject, meta)
  values (v_account, 'user', uid::text, 'run.' || p_decision, p_run::text,
    jsonb_build_object('edit_distance', p_edit_distance));

  return query select p_decision, now();
end;
$$;
revoke execute on function public.decide_run(uuid, text, integer) from public, anon;
grant execute on function public.decide_run(uuid, text, integer) to authenticated, service_role;

-- ── Agent School stage changes (§4.7) ────────────────────────────────────────
-- Promotion is verified accuracy re-checked in SQL — even the service role
-- cannot promote a Nibbin that hasn't earned it ("thresholds in spec config,
-- never time-served"; no badge/streak/mechanic may grant autonomy).

create function public.nibbin_promote(p_nibbin uuid)
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
  v_decided integer;
  v_approved integer;
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
    -- ≥95% approved-unedited over a rolling 25-run window (defaults; spec
    -- curriculum may set stricter values, never looser than 25/0.95).
    select greatest(coalesce((s.curriculum -> 'promotion' ->> 'windowRuns')::integer, 25), 25),
           greatest(coalesce((s.curriculum -> 'promotion' ->> 'minApprovedUneditedPct')::numeric, 0.95), 0.95)
      into v_window, v_min_pct
      from public.nibbins n join public.agent_specs s on s.id = n.spec_id
      where n.id = p_nibbin;

    -- window is scoped to THIS stage: only decisions made since the stage
    -- began count, so each promotion is earned fresh and a demotion resets the
    -- climb (logic-skeptic P1-2). 'edited' rows are decided-but-not-approved.
    select count(*), count(*) filter (where a.decision = 'approved')
      into v_decided, v_approved
      from (
        select a2.decision
        from public.approvals a2
        where a2.account_id = v_account
          and a2.decided_at > v_stage_since
          and a2.run_id in (select r.id from public.runs r where r.nibbin_id = p_nibbin)
        order by a2.decided_at desc
        limit v_window
      ) a;

    if v_decided < v_window or v_approved::numeric / greatest(v_decided, 1) < v_min_pct then
      raise exception 'nibbin % has not earned promotion (% approved of % in window, need % of %)',
        p_nibbin, v_approved, v_decided, v_min_pct, v_window;
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

-- Demotion is one click, instant, dignified ("back to drafts — good
-- instinct"). Members demote their own Nibbins directly.
create function public.nibbin_demote(p_nibbin uuid)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  uid uuid := (select auth.uid());
  v_account uuid;
  v_stage text;
  v_next text;
begin
  select n.account_id, n.stage into v_account, v_stage
    from public.nibbins n where n.id = p_nibbin for update;
  if not found or (uid is not null and not (select private.is_account_member(v_account))) then
    raise exception 'unknown nibbin %', p_nibbin;
  end if;
  if uid is null and current_setting('role', true) <> 'service_role' then
    raise exception 'not authenticated';
  end if;

  v_next := case v_stage
    when 'grad' then 'senior'
    when 'senior' then 'student'
    else null  -- student is the demotion floor; the egg is pre-output
  end;
  if v_next is null then
    raise exception 'nibbin % is already drafting everything', p_nibbin;
  end if;

  -- reset the climb: the next stage must be re-earned from scratch (§4.7)
  update public.nibbins set stage = v_next, stage_changed_at = now() where id = p_nibbin;
  insert into public.audit_log (account_id, actor, actor_id, action, subject, meta)
  values (v_account, coalesce(case when uid is null then 'system' end, 'user'),
    coalesce(uid::text, 'runtime'), 'nibbin.stage_demoted', p_nibbin::text,
    jsonb_build_object('from', v_stage, 'to', v_next));
  return v_next;
end;
$$;
revoke execute on function public.nibbin_demote(uuid) from public, anon;
grant execute on function public.nibbin_demote(uuid) to authenticated, service_role;

-- ── atomic send-velocity consume (RISKS §2; the TOCTOU-safe store the
--    connectors package contract demands of M4) ──────────────────────────────

create function public.send_velocity_consume(
  p_account uuid,
  p_provider text,
  p_hour_cap integer,
  p_day_cap integer
)
returns table (allowed boolean, reason text, retry_after_ms bigint)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_day integer;
  v_hour integer;
  v_oldest timestamptz;
begin
  -- serialize per account+provider so two concurrent sends cannot both pass
  perform pg_advisory_xact_lock(hashtextextended('nibbin:send:' || p_account::text || ':' || p_provider, 0));

  select count(*), min(sent_at) into v_day, v_oldest
    from public.send_records
    where account_id = p_account and provider = p_provider and sent_at > now() - interval '24 hours';
  if v_day >= p_day_cap then
    return query select false, 'daily-cap'::text,
      greatest(0, extract(epoch from (v_oldest + interval '24 hours' - now())) * 1000)::bigint;
    return;
  end if;

  select count(*), min(sent_at) into v_hour, v_oldest
    from public.send_records
    where account_id = p_account and provider = p_provider and sent_at > now() - interval '1 hour';
  if v_hour >= p_hour_cap then
    return query select false, 'hourly-cap'::text,
      greatest(0, extract(epoch from (v_oldest + interval '1 hour' - now())) * 1000)::bigint;
    return;
  end if;

  insert into public.send_records (account_id, provider) values (p_account, p_provider);
  return query select true, null::text, 0::bigint;
end;
$$;
revoke execute on function public.send_velocity_consume(uuid, text, integer, integer) from public, anon, authenticated;
grant execute on function public.send_velocity_consume(uuid, text, integer, integer) to service_role;

-- ── product event emission (§6.12) ───────────────────────────────────────────
-- Authenticated callers may only emit into accounts they belong to; the
-- service role emits freely (runtime/system events).
--
-- The event name is allowlisted IN SQL (mirrors packages/runtime PRODUCT_EVENT_
-- NAMES + the drip_<beat>_(sent|opened) pattern). The TS taxonomy guard alone
-- is bypassable by a direct RPC call, which would let a member poison the
-- §6.12 funnel (fake first_draft_approved / topup_purchased) on their own
-- account (red-team P3 / claims F-10).

create function public.emit_product_event(
  p_account uuid,
  p_name text,
  p_props jsonb default '{}'::jsonb
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  uid uuid := (select auth.uid());
begin
  if p_name not in (
    'account_created', 'connector_linked', 'scan_completed', 'scan_empty', 'nibbin_adopted',
    'first_draft_approved', 'run_approved', 'run_edited', 'run_rejected', 'stage_promoted',
    'stage_demoted', 'study_started', 'study_completed', 'study_aborted', 'diagnosis_viewed',
    'plan_upgraded', 'topup_purchased'
  ) and p_name !~ '^drip_[a-z0-9_]+_(sent|opened)$' then
    raise exception 'unknown product event %', p_name;
  end if;
  if uid is not null and (p_account is null or not (select private.is_account_member(p_account))) then
    raise exception 'cannot emit events for this account';
  end if;
  insert into public.product_events (account_id, user_id, name, props)
  values (p_account, uid, p_name, coalesce(p_props, '{}'::jsonb));
end;
$$;
revoke execute on function public.emit_product_event(uuid, text, jsonb) from public, anon;
grant execute on function public.emit_product_event(uuid, text, jsonb) to authenticated, service_role;

-- ── RLS: denial at the database layer regardless of application bugs ─────────

alter table public.agent_specs enable row level security;
alter table public.nibbin_write_grants enable row level security;
alter table public.nibbins enable row level security;
alter table public.runs enable row level security;
alter table public.run_steps enable row level security;
alter table public.approvals enable row level security;
alter table public.side_effects enable row level security;
alter table public.send_records enable row level security;
alter table public.scan_results enable row level security;
alter table public.product_events enable row level security;

create policy agent_specs_member_read on public.agent_specs
  for select to authenticated
  using ((select private.is_account_member(account_id)));

create policy nibbin_write_grants_member_read on public.nibbin_write_grants
  for select to authenticated
  using ((select private.is_account_member(account_id)));

create policy nibbins_member_read on public.nibbins
  for select to authenticated
  using ((select private.is_account_member(account_id)));

create policy runs_member_read on public.runs
  for select to authenticated
  using ((select private.is_account_member(account_id)));

create policy run_steps_member_read on public.run_steps
  for select to authenticated
  using ((select private.is_account_member(account_id)));

create policy approvals_member_read on public.approvals
  for select to authenticated
  using ((select private.is_account_member(account_id)));

create policy scan_results_member_read on public.scan_results
  for select to authenticated
  using ((select private.is_account_member(account_id)));

-- side_effects / send_records / product_events are server plumbing: no client
-- policies at all.

-- ── privilege hardening (RLS + grants: belt and suspenders) ──────────────────

revoke all on public.agent_specs, public.nibbins, public.nibbin_write_grants,
  public.runs, public.run_steps, public.approvals, public.side_effects,
  public.send_records, public.scan_results, public.product_events
  from anon;

revoke insert, update, delete, truncate, references, trigger
  on public.agent_specs, public.nibbins, public.nibbin_write_grants,
     public.runs, public.run_steps, public.approvals, public.scan_results
  from authenticated;

revoke all on public.side_effects, public.send_records, public.product_events from authenticated;
