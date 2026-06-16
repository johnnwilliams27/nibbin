-- Per-Nibbin "what {name} has learned about you" note (roster surface).
--
-- An Opus-generated, GROUNDED line about what a Nibbin has learned from working
-- with this person — written ONLY from real run/approval signals, never
-- fabricated. The note is cached on the nibbin row and regenerated OFF the
-- render path (a client island fires a best-effort server action for stale
-- rows), so the roster always paints fast with the cached value or an honest
-- deterministic fallback.
--
-- Columns:
--   learned_note       the cached sentence (<=240 chars; null = no note yet,
--                      the roster falls back to a deterministic grounded line)
--   learned_note_at    when it was last generated
--   learned_note_runs  the nibbin's run count at generation time — staleness is
--                      "materially more history since then" (see the roster's
--                      staleIds computation)
--
-- These are derived/display fields only: no RLS policy changes, and the existing
-- nibbins_member_read SELECT policy already covers reading them. Writes happen
-- through the service-role refresh path (authenticated already lacks
-- UPDATE on public.nibbins from the M4 hardening).

alter table public.nibbins
  add column if not exists learned_note text
    check (learned_note is null or char_length(learned_note) <= 240);

alter table public.nibbins
  add column if not exists learned_note_at timestamptz;

alter table public.nibbins
  add column if not exists learned_note_runs integer not null default 0;
