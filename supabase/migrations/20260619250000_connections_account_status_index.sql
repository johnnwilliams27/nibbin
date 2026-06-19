-- Composite index supporting per-account active-connection lookups, e.g. the
-- Getting-Started checklist's "connection" step (WHERE account_id = $1 AND status = 'active')
-- and the connections page's status filtering. The existing connections_account_idx
-- is (account_id, provider) and doesn't serve status-filtered scans.
CREATE INDEX IF NOT EXISTS connections_account_status_idx
  ON public.connections USING btree (account_id, status);
