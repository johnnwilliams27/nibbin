# Synthesis Packet Enrichment — Design

**Date:** 2026-06-15
**Branch:** feature/nibbin-desktop-unified-app
**Status:** Design — approved 2026-06-15 (scope: **retain + consume now**)
**Follows:** `2026-06-15-field-study-cloud-sync-design.md` (Phase 2)

## Goal

The v0 synthesis packet retains only coarse per-category aggregates (`minutesObserved`, `sessions`,
`apps`, a one-line `friction`). Since raw events + frames are auto-deleted at study end (the trust
anchor — decision 2026-06-15), that coarse summary is *all that survives*. Enrich the retained packet
with **re-minable redacted structure** so future/better models can re-derive sharper workflows,
automatability, and friction **without raw** — within the 256KB `diagnoses.packet` cap.

## Constraints (verified)

- `diagnoses.packet` is `jsonb` with `check (pg_column_size(packet) <= 262144)` (256KB). The enriched
  packet must stay comfortably under this for a full 14-day study.
- Nothing reads `diagnoses.packet`'s *shape* today — the reveal UI (`/app/diagnosis`) consumes the
  synthesized `map` (`DiagnosisMap`), not the packet. So enrichment fields are **retained, not
  consumed** (yet). This keeps the change low-risk: no UI or synthesis behavior changes.
- `validateSynthesisPacket` (in `apps/web/lib/diagnosis/synthesize.ts`) is the **only** gate — it
  whitelist-rebuilds the packet, so any field it doesn't explicitly pass through is **dropped before
  storage**. Enrichment therefore requires the validator to validate + bound + pass through each new
  field. The packet is untrusted external input, so every new field must be length/count/range-clamped.
- `segmentStudy` already re-scans the full serialized packet with `batteryStillMatches` and throws
  `PacketLeakError` on residual PII — the new fields are covered automatically.
- `sequenceCandidates(events, minN, maxN, minCount)` is already exported from
  `packages/redaction/src/packet.ts` (returns `{ steps: string[]; count: number }[]`). Reuse it.

## What gets retained (the enrichment payload)

All derived from each workflow's already-redacted events — no new data category, just more *structure*:

**Per `PacketWorkflow` (new optional fields):**
- `sequences?: { steps: string[]; count: number }[]` — the **re-minable core**: the top-N repeated
  `role_path#action` step-chains within the workflow (the actual automatable patterns). Cap **10 per
  workflow**, each `steps` capped at **12** entries, each step string clamped to **80** chars.
- `urlTemplates?: string[]` — distinct redacted `url.path_template`s observed in the workflow (which
  concrete sub-tasks ran, e.g. `/invoices/:id`). Cap **20**, each clamped to **120** chars.
- `dailyMinutes?: Record<string, number>` — minutes observed per ISO day (`YYYY-MM-DD`), the workflow's
  time distribution across the study. Cap **31** day-keys, values rounded to 0.1.

**Top-level (new optional field):**
- `dailyAppMinutes?: Record<string, Record<string, number>>` — overall minutes per day per app (the
  study's time-allocation shape). Cap **31** days × **20** apps; app keys clamped to **60** chars.

## Consumption — `automatable` in the v0 diagnosis (scope: consume now)

Beyond retaining the structure, v0 synthesis now **uses `sequences`** to produce a visible signal:

- **`DiagnosisWorkflow.automatable: number`** (0–100) — computed **server-side** in
  `synthesizeDiagnosis` from the workflow's `sequences` (a deterministic v0 heuristic; computing it
  server-side, not on-device, means the formula can improve later without a desktop release). Heuristic:
  `strength = top.count × top.steps.length` (the dominant repeated chain; `count ≥ 3`, `steps ≥ 3`),
  `automatable = clamp(round(100 × strength / (strength + 24)))`. No sequences → 0. Marked a v0
  heuristic; a unit test pins representative values (e.g. strength 24 → 50).
- **Friction is already sequence-derived** on-device (the "Repeated N-step sequence observed K×" note),
  so no change there — `synthOne` keeps passing `w.friction` through. The new *consumption* is the
  automatability score.
- **Reveal UI** (`apps/web/app/app/diagnosis/page.tsx`): add a per-workflow badge in the existing
  `wfMeta` row — `~{automatable}% automatable` (only when `automatable > 0`), reusing the existing
  `Badge` component + a tone. No layout restructure.
- The Opus labeling pass already receives the synthesized `map`, so it naturally sees `automatable`
  with no change to `label.ts`.

This advances Maya-demo parity **Group A** (the demo's "automatable %"). Finer per-step automatability
and friction *re-mining from `sequences`* remain follow-ups.

## Size budget (worst case, 14-day power user)

7 categories present, each maxed: sequences 10×12 steps×80ch ≈ 9.6KB/wf → ~67KB; urlTemplates
20×120ch ≈ 2.4KB/wf → ~17KB; dailyMinutes 31×~20ch → ~4KB total; top-level dailyAppMinutes 31×20×~15ch
≈ 9KB. JSON overhead ~1.5×. **Total ≈ 150KB** worst case, comfortably under 256KB. The per-field caps
are the hard ceiling; a final `segmentStudy` guard logs (and trims sequences first) if a pathological
packet still approaches the cap — see Error handling.

## Components & changes

1. **`packages/redaction/src/segment.ts`** — emit the new fields.
   - Per workflow: `sequences = sequenceCandidates(evs).slice(0, 10)` (already scoped to the workflow's
     events); `urlTemplates` = distinct `e.url?.path_template` (bounded); `dailyMinutes` = sum
     `duration_ms` grouped by `ts.slice(0,10)`.
   - Top-level: `dailyAppMinutes` = minutes per day per app over all exportable events (bounded).
   - Keep the existing coarse fields and the re-scan unchanged.
2. **`apps/web/lib/diagnosis/types.ts`** — add the optional enrichment fields to `PacketWorkflow` +
   `SynthesisPacket`; add `automatable: number` to `DiagnosisWorkflow`.
3. **`apps/web/lib/diagnosis/synthesize.ts`** — `validateSynthesisPacket` validates, **clamps**, and
   passes through each new enrichment field (security-critical: bound counts, array lengths, string
   lengths, numeric ranges; drop anything malformed). `synthesizeDiagnosis`/`synthOne` now also compute
   `automatable` from `w.sequences` (the v0 heuristic above).
4. **`apps/web/app/app/diagnosis/page.tsx`** — render the `~X% automatable` badge per workflow.
5. **Tests** — segmenter emits + bounds the fields; validator clamps oversized/garbage input;
   `synthesizeDiagnosis` produces the expected `automatable` values; the drift-guard test still passes
   (enriched output validates); a size-bound test asserts a maxed fixture's
   `JSON.stringify(packet).length` stays under the cap.

## Error handling

- **Approaching the cap:** the per-field caps make 256KB unreachable in practice, but `segmentStudy`
  ends with a guard: if `JSON.stringify(packet).length` exceeds a safety threshold (e.g. 230KB), trim
  `sequences` (lowest-count first) across workflows until under it, and `log`-equivalent a note in the
  packet (`manifestNote`) so the server knows it was trimmed. (No silent truncation.)
- **Malformed enrichment from an untrusted caller:** the validator clamps/drops per field; a bad field
  never throws — it's coerced to a safe bounded value or omitted, exactly like the existing workflow
  validation.
- **Re-scan:** unchanged — covers the new fields; a residual PII shape still throws `PacketLeakError`
  before upload.

## Out of scope (follow-ups)

- Finer per-step automatability + re-mining friction from `dailyMinutes`/`urlTemplates` (this pass
  consumes only `sequences` → one `automatable` score per workflow).
- Packet gzip/compression (the caps make it unnecessary for now).
- Ad-hoc capture (Phase 3).
