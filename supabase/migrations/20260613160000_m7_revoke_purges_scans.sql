-- M7 / issue #29 (scan-purge half): disconnecting a connection must take its
-- derived findings with it. scan_results.connection_id is `on delete set null`,
-- but connection_revoke does NOT delete the connection row (it flips status to
-- 'revoked' and empties the vault) — so without this, findings mined from a
-- now-revoked connection would linger, readable, after the user pulled access.
--
-- The purge lives INSIDE the RPC, not in any one UI, so it fires on every
-- revoke path: the connector lifecycle (vault.revoke), a future settings
-- disconnect, and the account-deletion cascade (#29 other half). It is
-- unconditional and therefore idempotent — a double-revoke (or a revoke that
-- happens after a stray scan landed) simply deletes whatever is there.
--
-- C7/privacy: findings are study-derived data about the user's work; once the
-- source connection is severed, they have no basis to exist server-side.

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
  -- purge findings derived from this connection, regardless of whether the
  -- status flipped this call — pulling access leaves nothing mined behind.
  delete from public.scan_results where connection_id = p_connection;
end;
$$;

revoke execute on function public.connection_revoke(uuid, uuid) from public, anon, authenticated;
grant execute on function public.connection_revoke(uuid, uuid) to service_role;
