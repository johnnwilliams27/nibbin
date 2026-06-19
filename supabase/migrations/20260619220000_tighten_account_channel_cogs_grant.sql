-- Security: tighten account_channel_cogs to service-role only.
--
-- account_channel_cogs(uuid, text, integer) is SECURITY DEFINER and reads
-- public.model_calls (which revokes all from authenticated). It was granted to
-- `authenticated` in 20260618130000_model_calls_channel_origin.sql, so any
-- logged-in user could call it with an ARBITRARY p_account and read another
-- account's channel COGS — a cross-account leak of finance-sensitive aggregates.
--
-- It has no authenticated caller: the only caller is channel_turn_take (itself
-- service-role) via the now-superseded rolling read; admin COGS views run under
-- the service role. So restricting to service_role is safe. (The newer
-- account_channel_cogs_day was already service-role-only.)
revoke execute on function public.account_channel_cogs(uuid, text, integer) from public, anon, authenticated;
grant execute on function public.account_channel_cogs(uuid, text, integer) to service_role;
