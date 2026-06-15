-- 20260615120000_diagnoses_study_id.sql
-- Phase 2 (field-study cloud sync): make packet upload idempotent. The desktop
-- may retry an upload (200 returned but the app died before advancing the study),
-- so key the diagnosis to its study and upsert instead of duplicating. Nullable +
-- partial unique index so existing rows (study_id null) are untouched and any
-- future web caller without a study id still inserts.
alter table public.diagnoses add column if not exists study_id text;
create unique index if not exists diagnoses_account_study_idx
  on public.diagnoses (account_id, study_id) where study_id is not null;
