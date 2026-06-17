-- Patch a single key in connections.webhook_state without overwriting sibling
-- keys. Required by advanceGmailCursor (Spec 3 liveness/eventing) so the
-- historyId cursor can be updated without clobbering webhook_state.email that
-- Spec 1 wrote during the connect callback.
--
-- DO NOT APPLY manually — the controller applies migrations in sequence.

create or replace function jsonb_merge_connection_state(
  p_connection uuid,
  p_patch jsonb
) returns void
language sql
security definer
set search_path = public
as $$
  update connections
  set webhook_state = coalesce(webhook_state, '{}'::jsonb) || p_patch
  where id = p_connection;
$$;

-- Only the service role may call this function; revoke public access.
revoke all on function jsonb_merge_connection_state(uuid, jsonb) from public;
grant execute on function jsonb_merge_connection_state(uuid, jsonb) to service_role;
