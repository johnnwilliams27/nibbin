-- Task 1: add the reference_text column to grove_memory.
--
-- This is a purely additive, nullable change. No existing columns, policies,
-- or RPCs are touched. The Reference catch-all (Sources tab) writes through
-- the `save_reference` RPC added in Task 2 (same migration file by plan; kept
-- here in this file per Task 1's scope). The curated-field path
-- (save_grove_memory) is unchanged — spec §15.
--
-- Size cap matches `notes` (8000 chars) and the `sections` total cap (32KB).
-- The CHECK is written as IS NULL OR … so that NULL satisfies it (nullable).

alter table public.grove_memory
  add column reference_text text
    check (reference_text is null or char_length(reference_text) <= 8000);
