-- Top-up grants must be idempotent under webhook retry/replay, exactly like
-- subscription grants (red-team PR #12 P0). The original unique index only
-- covered reason='grant'; top-ups (reason='topup') had no idempotency guard, so
-- a redelivered checkout.session.completed minted credits again. This adds the
-- matching guard keyed to the Stripe payment id (source_id).
create unique index credit_ledger_one_topup_per_payment
  on public.credit_ledger (account_id, source_id)
  where reason = 'topup';
