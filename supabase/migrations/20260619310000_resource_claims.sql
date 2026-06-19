-- Multi-agent conflict detection Slice 1 (SPEC §18.3 / R53): a Nibbin claims the
-- resource it is about to IRREVERSIBLY act on (a Gmail thread, an invoice, a
-- calendar event) so two Nibbins on one account never both act on the same
-- resource. Claim at the auto-execute/send point (the app-side runner); the
-- claim is released automatically when the run reaches a terminal state.
--
-- Slice 1 scope: the claim/release substrate + the claim-or-conflict RPC. The
-- runner integration (claim before the send, skip on conflict) ships with this
-- migration. Drafts that pause for human approval are NOT claimed here — the
-- human is the dedup; only the irreversible send is gated.

create table if not exists public.resource_claims (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references public.accounts (id) on delete cascade,
  nibbin_id uuid not null references public.nibbins (id) on delete cascade,
  run_id uuid not null references public.runs (id) on delete cascade,
  resource_type text not null check (btrim(resource_type) <> ''),
  resource_id text not null check (btrim(resource_id) <> ''),
  claimed_at timestamptz not null default now(),
  released_at timestamptz
);

-- At most ONE active (unreleased) claim per resource per account — the conflict
-- invariant, enforced at the DB layer.
create unique index if not exists resource_claims_active_uniq
  on public.resource_claims (account_id, resource_type, resource_id)
  where released_at is null;
create index if not exists resource_claims_run_active_idx
  on public.resource_claims (run_id) where released_at is null;

alter table public.resource_claims enable row level security;
-- Members can SEE who is working on what (for a future "another agent is on this"
-- surface); no client writes — claims are made only by the service-role RPC.
drop policy if exists resource_claims_member_read on public.resource_claims;
create policy resource_claims_member_read on public.resource_claims
  for select to authenticated using ((select private.is_account_member(account_id)));
revoke insert, update, delete, truncate, references, trigger
  on public.resource_claims from authenticated;
revoke all on public.resource_claims from anon;

-- ---------------------------------------------------------------------------
-- claim_resource: atomic claim-or-conflict under the account lock.
--   granted=true  → this run now holds the resource (fresh, idempotent re-claim,
--                   or a reclaim of a dead/stale holder).
--   granted=false → another ACTIVE run holds it; holder_run/holder_nibbin name it
--                   so the caller can skip + explain. The caller must NOT act.
-- A holder is reclaimable when its run is already terminal (ended_at set — a
-- missed release) or the claim is older than 24h (an abandoned awaiting-approval
-- run); a live approval wait legitimately keeps the claim (ended_at stays null).
-- ---------------------------------------------------------------------------
create or replace function public.claim_resource(
  p_account uuid,
  p_nibbin uuid,
  p_run uuid,
  p_resource_type text,
  p_resource_id text
) returns table (granted boolean, holder_run uuid, holder_nibbin uuid)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_claim public.resource_claims%rowtype;
  v_holder_ended timestamptz;
begin
  perform private.lock_account(p_account);

  select * into v_claim
  from public.resource_claims
  where account_id = p_account
    and resource_type = p_resource_type
    and resource_id = p_resource_id
    and released_at is null
  limit 1;

  if not found then
    insert into public.resource_claims (account_id, nibbin_id, run_id, resource_type, resource_id)
    values (p_account, p_nibbin, p_run, p_resource_type, p_resource_id);
    return query select true, p_run, p_nibbin;
    return;
  end if;

  -- Same run already holds it → idempotent grant (a retry of the same send).
  if v_claim.run_id = p_run then
    return query select true, p_run, p_nibbin;
    return;
  end if;

  -- Held by another run — reclaim only if that run is terminal or the claim is stale.
  select ended_at into v_holder_ended from public.runs where id = v_claim.run_id;
  if v_holder_ended is not null or v_claim.claimed_at < now() - interval '24 hours' then
    update public.resource_claims set released_at = now() where id = v_claim.id;
    insert into public.resource_claims (account_id, nibbin_id, run_id, resource_type, resource_id)
    values (p_account, p_nibbin, p_run, p_resource_type, p_resource_id);
    return query select true, p_run, p_nibbin;
    return;
  end if;

  -- Live conflict: another active run holds this resource.
  return query select false, v_claim.run_id, v_claim.nibbin_id;
end;
$$;
revoke execute on function public.claim_resource(uuid, uuid, uuid, text, text) from public, anon, authenticated;
grant execute on function public.claim_resource(uuid, uuid, uuid, text, text) to service_role;

-- Explicit release of all active claims for a run (the trigger below is the
-- primary path; this is for callers that want to release early).
create or replace function public.release_run_claims(p_run uuid) returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_n integer;
begin
  update public.resource_claims set released_at = now()
  where run_id = p_run and released_at is null;
  get diagnostics v_n = row_count;
  return v_n;
end;
$$;
revoke execute on function public.release_run_claims(uuid) from public, anon, authenticated;
grant execute on function public.release_run_claims(uuid) to service_role;

-- Auto-release when a run reaches a terminal state. run_finish sets ended_at to
-- now() for completed/failed/killed and leaves it null for awaiting_approval, so
-- a claim is held across an approval wait and released the moment the run ends.
-- Path-independent + crash-safe (fires in the same txn that ends the run).
create or replace function private.release_claims_on_run_end() returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if old.ended_at is null and new.ended_at is not null then
    update public.resource_claims set released_at = now()
    where run_id = new.id and released_at is null;
  end if;
  return new;
end;
$$;

drop trigger if exists trg_release_claims_on_run_end on public.runs;
create trigger trg_release_claims_on_run_end
  after update of ended_at on public.runs
  for each row execute function private.release_claims_on_run_end();
