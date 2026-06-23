-- 20260623130000_memory_extensible_and_sources_library.sql
-- Extends Foundation's field_meta with section identity/order/visibility (custom
-- + renamed/hidden defaults), and sources with file metadata + extraction state
-- for the Sources file library. Purely additive; nullable or defaulted columns.

alter table public.field_meta
  add column label      text    check (label is null or char_length(label) <= 60),
  add column sort_order integer not null default 1000,
  add column is_custom  boolean not null default false,
  add column is_hidden  boolean not null default false;

alter table public.sources
  add column mime_type       text   check (mime_type is null or char_length(mime_type) <= 255),
  add column byte_size       bigint check (byte_size is null or byte_size >= 0),
  add column extraction_state text not null default 'pending'
    check (extraction_state in ('pending','extracting','extracted','unsupported','failed'));

create index sources_account_state_idx on public.sources (account_id, extraction_state);
