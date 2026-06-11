-- M1 gate hardening (red-team + logic-skeptic P3s).

-- A top-up must carry its Stripe payment id, mirroring the grant period
-- requirement — without it the (account_id, source_id) topup idempotency index
-- doesn't apply to a NULL-keyed row, so a future direct writer could double-credit.
alter table public.credit_ledger
  add constraint credit_ledger_topup_ref check (reason <> 'topup' or source_id is not null);

-- credit_balances inherited Supabase's default write grants to `authenticated`
-- (harmless today — the GROUP BY view rejects writes and is security_invoker —
-- but the base tables were hardened to SELECT-only and the view should match).
revoke all on public.credit_balances from authenticated;
grant select on public.credit_balances to authenticated;
