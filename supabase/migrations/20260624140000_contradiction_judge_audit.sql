-- C2 follow-up: LLM-judged semantic contradiction audit trail.
--
-- The collate pass now runs an LLM judging pass over each heuristic conflict
-- candidate (conflict-judge.ts). Record the judge's verdict + short reason on
-- the resulting flag so the Memory UI can show WHY two values are believed to
-- conflict, and so the decision is auditable. Both columns are nullable and
-- additive — existing rows and the heuristic-only / no-API-key path are
-- unaffected (they leave both null). No RLS change: field_flags is already
-- member-read, service/RPC-write.
--
-- NOT applied to any remote DB by this branch — application is left to merge
-- time (idempotent DDL; safe to re-run).

alter table public.field_flags
  add column if not exists judge_verdict text
    check (judge_verdict is null or judge_verdict in ('contradiction','compatible','uncertain'));

alter table public.field_flags
  add column if not exists judge_reason text
    check (judge_reason is null or char_length(judge_reason) <= 240);

-- ─────────────────────────────────────────────────────────────────────────────
-- Extend flag_field_conflict with two optional trailing params so the collate
-- pass can persist the judge verdict/reason. Additive overload (established
-- pattern): drop the prior 6-arg signature, recreate as 8-arg with defaults so
-- the new params are back-compatible (an old caller omitting them lands null).
-- ─────────────────────────────────────────────────────────────────────────────
drop function if exists public.flag_field_conflict(uuid, text, uuid[], text, text, uuid);

create or replace function public.flag_field_conflict(
  p_account              uuid,
  p_field_key            text,
  p_competing_source_ids uuid[],
  p_detail               text,
  p_stakes               text    default 'normal',
  p_suggested_source_id  uuid    default null,
  p_judge_verdict        text    default null,
  p_judge_reason         text    default null
) returns uuid language plpgsql security definer set search_path = '' as $$
declare
  v_id uuid;
begin
  if p_stakes not in ('normal', 'high') then
    raise exception 'stakes must be normal or high, got %', p_stakes;
  end if;
  if p_judge_verdict is not null
     and p_judge_verdict not in ('contradiction','compatible','uncertain') then
    raise exception 'judge_verdict must be contradiction/compatible/uncertain, got %', p_judge_verdict;
  end if;

  -- Upsert: update if an open flag exists, else insert.
  update public.field_flags
  set competing_source_ids  = p_competing_source_ids,
      detail                = p_detail,
      suggested_source_id   = p_suggested_source_id,
      judge_verdict         = p_judge_verdict,
      judge_reason          = p_judge_reason,
      detected_at           = now()
  where account_id = p_account
    and field_key  = p_field_key
    and status     = 'needs_review'
  returning id into v_id;

  if v_id is null then
    insert into public.field_flags
      (account_id, field_key, competing_source_ids, detail, suggested_source_id, judge_verdict, judge_reason)
    values
      (p_account, p_field_key, p_competing_source_ids, p_detail, p_suggested_source_id, p_judge_verdict, p_judge_reason)
    returning id into v_id;
  end if;

  perform public.insert_system_notification(
    p_account,
    'review_item',
    v_id::text,
    'A conflict needs your review',
    p_detail,
    jsonb_build_object('field_flag_id', v_id, 'field_key', p_field_key, 'kind', 'conflict'),
    p_stakes
  );

  return v_id;
end; $$;
revoke execute on function public.flag_field_conflict(uuid, text, uuid[], text, text, uuid, text, text) from public, anon, authenticated;
grant  execute on function public.flag_field_conflict(uuid, text, uuid[], text, text, uuid, text, text) to service_role;
