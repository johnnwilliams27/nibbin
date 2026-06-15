-- 20260615130000_diagnoses_kind_label.sql
-- Phase 3: quick scans coexist with the 14-day study. Tag each diagnosis with
-- its study kind + optional task label so the web history can badge + name them.
alter table public.diagnoses add column if not exists kind text not null default 'full_study'
  check (kind in ('full_study', 'quick_scan'));
alter table public.diagnoses add column if not exists label text
  check (label is null or char_length(label) <= 120);
