-- Channel → user attribution + service-role decision RPC (on-channel approval bridge).
-- Plan 05 Task 4b-i.
--
-- Security surface: decide_run_service lets a verified channel approve a real agent
-- run on a user's behalf. The app layer verifies channel binding + account ownership
-- before calling, but the SQL layer enforces all the same invariants as decide_run:
--   • run must be awaiting_approval
--   • a draft step must exist (no minting approval signals for undrafted runs)
--   • exactly one decision per run (approvals.run_id unique)
--   • run flips to completed (approved/edited) or rejected
--   • every call is audited
-- Only the service role can reach this function; anon and authenticated are explicitly
-- revoked so no PostgREST bypass is possible.

-- ── 1. Channel → user attribution ─────────────────────────────────────────────
-- Track WHICH authenticated user initiated the link/verify so that a channel
-- decision can be attributed to the real account member who owns the channel.
-- Additive columns — existing rows keep linked_by = null.

alter table public.channel_verifications
  add column linked_by uuid references public.users (id);

alter table public.notification_channels
  add column linked_by uuid references public.users (id);

-- ── 2. request_channel_link: same body + set linked_by in the insert ──────────

create or replace function public.request_channel_link(
  target_account uuid,
  channel text
)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  uid uuid := (select auth.uid());
  v_nonce text := encode(public.gen_random_bytes(18), 'hex');
begin
  if uid is null then
    raise exception 'not authenticated';
  end if;
  if not (select private.is_account_member(target_account)) then
    raise exception 'not a member of this account';
  end if;
  if channel not in ('push','email','sms','telegram','whatsapp') then
    raise exception 'unknown channel %', channel;
  end if;
  insert into public.channel_verifications (account_id, channel, nonce, expires_at, linked_by)
  values (target_account, request_channel_link.channel, v_nonce, now() + interval '30 minutes', uid);
  insert into public.audit_log (account_id, actor, actor_id, action, subject, meta)
  values (target_account, 'user', uid::text, 'channel.link_requested', target_account::text,
    jsonb_build_object('channel', request_channel_link.channel));
  return v_nonce;
end;
$$;
-- same grants as the original: authenticated only, service_role excluded
revoke execute on function public.request_channel_link(uuid, text) from public, anon, service_role;
grant execute on function public.request_channel_link(uuid, text) to authenticated;

-- ── 3. verify_channel_binding: carry v.linked_by into notification_channels ───
-- On first insert: linked_by = v.linked_by.
-- On conflict update (re-verify): linked_by is refreshed from the verification
-- that was consumed (preserves the originating user on re-link).

create or replace function public.verify_channel_binding(
  p_nonce text,
  p_external_id text,
  p_external_label text default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v record;
  v_channel_id uuid;
begin
  select * into v from public.channel_verifications
   where nonce = p_nonce and status = 'issued' and expires_at > now()
   for update;
  if not found then
    return null;
  end if;
  update public.channel_verifications
     set status = 'consumed', consumed_at = now()
   where id = v.id;
  insert into public.notification_channels
    (account_id, channel, external_id, external_label, status, verified_at, linked_by)
  values (v.account_id, v.channel, p_external_id, p_external_label, 'verified', now(), v.linked_by)
  on conflict (account_id, channel, external_id) where status <> 'revoked'
  do update set status = 'verified',
                verified_at = now(),
                external_label = coalesce(excluded.external_label, public.notification_channels.external_label),
                linked_by = v.linked_by
  returning id into v_channel_id;
  insert into public.channel_prefs (account_id, channel)
  values (v.account_id, v.channel)
  on conflict (account_id, channel) do nothing;
  insert into public.audit_log (account_id, actor, actor_id, action, subject, meta)
  values (v.account_id, 'system', 'service', 'channel.verified', v_channel_id::text,
    jsonb_build_object('channel', v.channel));
  return v_channel_id;
end;
$$;
-- same grants as the original: service_role only
revoke execute on function public.verify_channel_binding(text, text, text) from public, anon, authenticated;
grant execute on function public.verify_channel_binding(text, text, text) to service_role;

-- ── 4. decide_run_service: service-role-only approval path for channel replies ─
-- Mirrors all invariants of decide_run (20260611120000):
--   (a) select for update on the run — serialized, no TOCTOU
--   (b) must be awaiting_approval
--   (c) must have a draft step (no minting approval signals for undrafted runs)
--   (d) decision in ('approved','edited','rejected')
--   (e) insert into approvals — run_id unique enforces one-per-run atomically
--   (f) flip runs.status
--   (g) audit log with actor='user', actor_id=p_actor_user, action='run.decided_via_channel'
-- NOTE: NO auth.uid() check — the service role is the caller; the app layer is
-- responsible for verifying that p_actor_user owns a verified channel that matches
-- the inbound message before calling this function. That check cannot live in SQL
-- because the channel identity (Telegram chat id, phone number) is matched by the
-- app layer against notification_channels (linked_by = p_actor_user, status = 'verified').

create or replace function public.decide_run_service(
  p_run uuid,
  p_actor_user uuid,
  p_decision text,
  p_edit_distance integer default 0
)
returns table (decision text, decided_at timestamptz)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_account uuid;
  v_status text;
begin
  -- validate decision first so we fail fast before touching the run
  if p_decision not in ('approved', 'edited', 'rejected') then
    raise exception 'unknown decision %', p_decision;
  end if;
  if p_edit_distance is null or p_edit_distance < 0 then
    raise exception 'edit distance must be >= 0';
  end if;

  -- lock the run (serialized; mirrors decide_run and run_finish)
  select account_id, status into v_account, v_status
    from public.runs
   where id = p_run
   for update;

  if not found or v_status <> 'awaiting_approval' then
    raise exception 'run not awaiting approval';
  end if;

  -- a decision must be ABOUT a drafted artifact — same guard as decide_run
  -- (logic-skeptic P3-9: no minting approval signals for runs with no draft step)
  if not exists (
    select 1 from public.run_steps
     where run_id = p_run and kind = 'draft'
  ) then
    raise exception 'no draft step';
  end if;

  -- insert into approvals; the unique(run_id) on the table is the one-per-run
  -- enforcement — a concurrent or double call raises a unique-violation here
  insert into public.approvals (run_id, account_id, user_id, decision, edit_distance)
  values (p_run, v_account, p_actor_user, p_decision, p_edit_distance);

  -- flip run status (mirrors decide_run exactly)
  update public.runs
     set status = case when p_decision = 'rejected' then 'rejected' else 'completed' end,
         ended_at = now()
   where id = p_run;

  -- audit every channel decision with its own action so it is distinguishable
  -- from in-app decide_run decisions in the audit trail
  insert into public.audit_log (account_id, actor, actor_id, action, subject, meta)
  values (
    v_account,
    'user',
    p_actor_user::text,
    'run.decided_via_channel',
    p_run::text,
    jsonb_build_object('decision', p_decision)
  );

  return query select p_decision, now();
end;
$$;

-- SERVICE-ROLE ONLY. This is the inverse of the member RPCs: anon and
-- authenticated are explicitly revoked so PostgREST cannot reach this function
-- even through a crafted request.
revoke execute on function public.decide_run_service(uuid, uuid, text, integer) from public, anon, authenticated;
grant execute on function public.decide_run_service(uuid, uuid, text, integer) to service_role;
