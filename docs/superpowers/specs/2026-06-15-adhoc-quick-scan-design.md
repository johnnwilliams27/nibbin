# Ad-hoc Quick Scan (Phase 3) — Design

**Date:** 2026-06-15
**Branch:** feature/nibbin-desktop-unified-app
**Status:** Design — scope approved (full quick-scan; unified history + badges)
**Follows:** Phase 2 (field-study cloud sync) + packet enrichment + finer re-mining.

## Goal

Let a user capture and diagnose **one workflow on demand** — a "quick scan" — outside the 14-day field
study, reusing the entire existing pipeline (consent → capture → review → segment → upload → synthesize
→ delete). Surface quick scans + the full study together in a web **diagnoses history**.

## Key architectural decisions

1. **Sequential studies, unique IDs (no multi-study-local refactor).** Today the daemon hardcodes
   `studyId = "study_local"` and supports exactly one study lifetime (no transition out of
   `Complete`). With Phase 2's idempotent upsert on `(account_id, study_id)`, **every study overwrites
   the same diagnosis row** — a latent bug. Fix: each study gets a **unique id**; a study runs to
   completion (upload + raw deletion), then a fresh study (quick or full) can be created locally,
   overwriting `study.json`. Only ONE study exists locally at a time (sequential), so no plural-study
   store is needed. The **cloud accumulates** all diagnoses (distinct `study_id`s).
2. **`kind` + `label` on the study.** Add `StudyKind { FullStudy, QuickScan }` and an optional `label`
   (the task name, e.g. "Send weekly invoices") to the study snapshot; both ride the packet to the
   diagnosis so the web can badge + name each.
3. **Per-kind auto-stop backstop.** Full study keeps the 14-day hard stop (C2). A quick scan gets a
   short backstop (6 hours) so an abandoned scan can't capture indefinitely; it's normally
   user-stopped. Same `ends_at`/`deadline_passed` machinery, just a per-kind duration.

## Privacy invariants — unchanged

C1/C3/C7 (on-device segmentation, delete-raw-after-upload, pixels never leave) and the consent claims
apply identically. The only relaxations for a quick scan: the auto-stop is 6h not 14d, and the consent
copy is a short variant ("this scan stops when you tell it to, or after a few hours"). The verified
deletion (C3) and the day-N daemon-enforced stop (C2, now per-kind) are unchanged in mechanism.

## Components & changes

### A. Daemon + study machine (Rust + TS twin) — the riskiest piece
`apps/desktop/src-tauri/crates/nibbin-study/src/lib.rs` and its TS twin
`apps/desktop/src/core/study-machine.ts` (the corpus pins both — they MUST stay identical):
- Add `StudyKind { FullStudy, QuickScan }` (serde `SCREAMING_SNAKE_CASE`, default `FullStudy` so
  existing `study.json` loads) and `label: Option<String>` (`#[serde(default)]`) to `StudySnapshot`.
- `new_study(id, kind, label)` signature; `Start` sets `ends_at = started_at + window(kind)` where
  `window = QuickScan ? Duration::hours(6) : Duration::days(STUDY_DAYS)`. **Full-study behavior is
  byte-identical** (still 14 days) — the `json_shape_matches_the_ts_twin` + day-14 tests must stay green.
- New command/transition `CreateStudy { id, kind, label }`: valid only from `NotStarted | Complete |
  Deleted` (never mid-capture); resets to a fresh `NotStarted` snapshot with the new id/kind/label.
- `observerd` (`src/lib.rs`): on boot with no `study.json`, mint a `FullStudy` with a unique id
  (timestamp-based) instead of `"study_local"`; handle the `create_study` control line (clear the
  observer-store, write the fresh snapshot).
- `commands.rs`: add `create_study` to `ALLOWED_CONTROL` and a typed `create_study(id, kind, label)`
  bridge command (the frontend generates the id via `crypto.randomUUID()` and passes kind/label).

### B. Packet + contract carry kind/label
- `packages/redaction/src/segment.ts` `segmentStudy(studyId, events, now, meta?)` — accept optional
  `{ kind, label }`, emit them on the packet (bounded: label ≤120 chars, kind ∈ enum).
- `apps/web/lib/diagnosis/types.ts` — add `kind?: 'full_study' | 'quick_scan'` + `label?: string` to
  `SynthesisPacket`.
- `validateSynthesisPacket` — validate/clamp/pass through (`kind` defaults to `full_study` if absent
  or not in the enum; `label` clamped to 120).

### C. Endpoint + migration store kind/label
- Migration `2026XXXX_diagnoses_kind_label.sql`: `add column kind text not null default 'full_study'`
  (check in the two values), `add column label text` (≤120 via check). Apply to **dev only**.
- `apps/web/app/api/study/packet/route.ts` — write `kind`/`label` from `packet.kind`/`packet.label`
  into the diagnoses row (insert + upsert paths).

### D. Desktop UI — quick-scan entry + flow
`apps/desktop/src/ui/views/field-study.ts` (+ consent + observer.css):
- The Field Study tab gains two entries when no study is running: **"Start 14-day field study"** and
  **"Quick scan a task"**. Quick scan: a small label input ("What are you about to do?") → a short
  consent variant → `bridge.createStudy(crypto.randomUUID(), 'quick_scan', label)` → `consent` →
  `start` → a capturing card with a **"Stop scan"** button (no 14-day countdown; a 6h backstop note)
  → on stop, the existing Review → Synthesizing (Phase 2 upload, now passing `{kind,label}`) flow.
- After a study reaches `Complete`/`Deleted`, the UI offers **"Start another"** (create a new study) —
  the path that was previously a dead end.

### E. Web — unified diagnoses history
`apps/web/app/app/diagnosis/`:
- `page.tsx` — select ALL diagnoses for the account (newest first), not `.limit(1)`. Render the newest
  as the existing hero reveal; below it a **History** list of the rest as compact cards: a `Quick scan`
  / `14-day study` badge (from `kind`), the `label` (if any), date, total hours, workflow count. Each
  card links to a detail route.
- New `page` at `apps/web/app/app/diagnosis/[id]/page.tsx` — the full reveal for one diagnosis by id
  (RLS-scoped via `is_account_member`), reusing the same render as the hero.
- Factor the reveal render into a shared component so hero + detail share it (DRY).

## Testing

- **Study machine (Rust + TS twin):** `CreateStudy` transitions only from terminal/NotStarted; quick
  scan `ends_at = start + 6h`; full study still `+14d`; the existing day-14 + json-twin tests stay green;
  the TS twin mirrors every new behavior (a twin-parity test if one exists).
- **segmenter:** emits `kind`/`label` when given; omits when not (back-compat).
- **validator:** clamps `label`, defaults `kind`, rejects bad `kind`.
- **endpoint:** stores `kind`/`label`; upsert keeps them.
- **web:** the history query returns multiple; the detail route renders by id; badge maps kind → label.
- **migration:** dev apply verified.

## Out of scope (follow-ups)

- Concurrent studies (a quick scan while a 14-day study runs) — stays sequential.
- Per-diagnosis delete from the web history (the #29 account-deletion path still covers bulk erasure).
- Scheduling/automation of scans.
