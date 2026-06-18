-- Capture depth (Lite a11y-only vs Detailed +screenshots) recorded on each diagnosis.
alter table public.diagnoses
  add column if not exists depth text not null default 'lite'
  check (depth in ('lite', 'detailed'));
