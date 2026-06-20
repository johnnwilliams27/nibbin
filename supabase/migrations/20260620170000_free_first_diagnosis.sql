-- Free first field-study diagnosis (funnel hook) — anti-abuse entitlement.
--
-- Product: a user's FIRST 14-day field study + its diagnosis is free (no plan,
-- no credits). Every subsequent diagnosis falls through to the credit gate
-- (that gate is the anti-abuse mechanism). A per-diagnosis hard cost cap
-- bounds even the free one so it can never run away.
--
-- first_diagnosis_consumed is the entitlement flag: false = the free diagnosis
-- is still available; true = it has been spent. It is consumed ATOMICALLY by
-- the diagnosis path:
--
--   update public.accounts
--      set first_diagnosis_consumed = true
--    where id = $1 and first_diagnosis_consumed = false;
--
-- If that updates a row, this run is free (skip the credit charge). If it
-- updates nothing, the free entitlement is already gone — apply the credit
-- gate. The WHERE-guarded update is the race winner: two concurrent firsts can
-- only have ONE of them update a row, so only one runs free.

alter table public.accounts
  add column if not exists first_diagnosis_consumed boolean not null default false;

comment on column public.accounts.first_diagnosis_consumed is
  'Free-first-diagnosis entitlement. false = the account''s first field-study diagnosis is still free; true = it has been spent (consumed atomically by the diagnosis path; subsequent diagnoses require credits).';

-- Partial index: the consume update only ever targets rows still eligible
-- (first_diagnosis_consumed = false), and that set shrinks monotonically over
-- an account's lifetime — a tiny, cheap index for the WHERE-guarded consume.
create index if not exists accounts_first_diagnosis_unconsumed_idx
  on public.accounts (id)
  where not first_diagnosis_consumed;
