-- Spec 2 security fix: guarantee nibbin_write_grants are suspended atomically
-- inside connection_revoke, regardless of caller (FIX 3).
--
-- Previously, grant suspension lived only in the application-layer
-- revokeAndSuspend() helper, so the connection_revoke RPC itself (called by
-- account purge, direct RPC invocations, etc.) left nibbin_write_grants active.
-- hasGrant() would then still return true after a connection was gone.
--
-- This migration replaces connection_revoke with the CURRENT (M7) body —
-- preserving M7's scan_results purge (#29 privacy guarantee) — plus one
-- additional UPDATE that suspends all active grants for the revoked connection.
-- Suspension is now guaranteed at the DB layer regardless of which code path
-- triggers the revoke. (CREATE OR REPLACE overwrites the live function, so the
-- M7 purge line MUST be carried forward here or it silently regresses.)

create or replace function public.connection_revoke(p_connection uuid, p_actor_user uuid default null)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  ref uuid;
  changed int;
begin
  select token_ref into ref from public.connections where id = p_connection for update;
  if not found then
    raise exception 'unknown connection %', p_connection;
  end if;
  if ref is not null then
    delete from vault.secrets where id = ref;
  end if;
  update public.connections
    set token_ref = null, status = 'revoked', revoked_at = now()
    where id = p_connection and status <> 'revoked';
  get diagnostics changed = row_count;
  if changed > 0 then
    insert into public.audit_log (account_id, actor, actor_id, action, subject)
      select account_id,
             case when p_actor_user is null then 'system' else 'user' end,
             coalesce(p_actor_user::text, 'service'),
             'connection.revoked', p_connection::text
      from public.connections where id = p_connection;
  end if;

  -- FIX 3 (Spec 2): suspend all active nibbin_write_grants for this connection.
  -- Guaranteed at the DB layer so revoke paths that bypass the app layer
  -- (account purge, direct RPC calls, etc.) also close the write gate.
  update public.nibbin_write_grants
    set revoked_at = now()
    where connection_id = p_connection
      and revoked_at is null;

  -- Carry forward M7 (#29): purge findings derived from this connection on
  -- revoke. CREATE OR REPLACE overwrites the live M7 body, so this line MUST be
  -- preserved here or the scan-purge privacy guarantee silently regresses.
  delete from public.scan_results where connection_id = p_connection;
end;
$$;

-- Preserve the same privilege configuration as the original function.
revoke execute on function public.connection_revoke(uuid, uuid) from public, anon, authenticated;
grant execute on function public.connection_revoke(uuid, uuid) to service_role;
