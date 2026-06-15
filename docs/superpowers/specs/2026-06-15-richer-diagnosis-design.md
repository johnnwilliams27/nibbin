# Richer Diagnosis (Wave 1) — Design + Plan

**Date:** 2026-06-15
**Branch:** feature/nibbin-desktop-unified-app
**Status:** approved (part of the "everything" backlog pass; concurrent studies excluded)

Three tightly-related backend follow-ups that make the diagnosis richer and feed the Group-A reveal.
All deterministic + unit-testable; no new packet field leaves the device beyond what already does.

## 1. Split coarse workflow keys (segment.ts)

Today every category collapses to one `${category}.general` workflow. Subdivide a category into finer
keys when a clear, deterministic signal exists in the already-redacted fields (`url.path_template`,
`url.host`), so the workflow hits the finer `KEY_TEMPLATE` (better `recommendedNibbin`) and matches the
demo's `payments.invoices` / `email.newsletter` granularity.

- Per event, compute a `subkey` within its category from a small rule table:
  - payments: path_template contains `invoice` → `invoices`; `overdue`/`past-due`/`reminder` → `overdue`; else `general`.
  - email: host contains `mailchimp`/`substack`/`beehiiv` OR path contains `newsletter`/`campaign` → `newsletter`; path contains `overdue`/`reminder` → `overdue`; else `general`.
  - calendar: path/host contains `confirm`/`booking` → `confirmations`; else `general`.
  - other categories: always `general`.
- Group events by `(category, subkey)` → one `PacketWorkflow` per group, key `${category}.${subkey}`,
  label from a `KEY_LABEL` table (e.g. `payments.invoices` → "Sending invoices"; fall back to the
  category label for `.general`). All existing aggregation (minutes, sessions, apps, sequences, etc.)
  is per-group. Conservative: only the listed strong signals split; everything else stays `.general`,
  so behavior is unchanged for events without those signals.

## 2. Consume `dailyAppMinutes` → app allocation (synthesize.ts)

`dailyAppMinutes` is captured + validated but never used. Derive a top-level **app allocation** for the
"where your desktop time goes" view:
- `appAllocation: { app: string; hoursPerWeek: number }[]` on `DiagnosisMap` — sum each app's minutes
  across all days in `packet.dailyAppMinutes`, convert to hours/week (`/ studyDays * 7 / 60`, round 0.1),
  sort desc, top 8. Empty array when `dailyAppMinutes` absent.

## 3. Time-saved metric (synthesize.ts)

The headline Group-A number. Deterministic derivation from the per-workflow automatability:
- `timeSavedPerWeek: number` on `DiagnosisMap` = `round1(Σ workflow.hoursPerWeek × automatable/100)` —
  "hours an adopted grove could take off your plate each week." (The live "today / this week" numbers in
  the Today feed come from real `runs`, separate — Group D.)

## Type changes (`apps/web/lib/diagnosis/types.ts`)
- `DiagnosisMap` gains `timeSavedPerWeek: number` and `appAllocation: { app: string; hoursPerWeek: number }[]`.
- (Workflow keys/labels are strings already — no type change for the split.)

## Testing
- segment: events with an `/invoices` path → a `payments.invoices` workflow (key + label); a newsletter
  host → `email.newsletter`; events without signals stay `${category}.general`; multiple subkeys in one
  category yield multiple workflows; the drift guard (`validateSynthesisPacket`) still passes.
- synthesize: `timeSavedPerWeek` = Σ hours×automatable% (pin a value); `appAllocation` sums + ranks
  `dailyAppMinutes`, top 8, empty when absent.
- Both typechecks clean; existing diagnosis + study-packet + drift tests stay green.

## Out of scope
- Opus-driven finer keys (label.ts can refine further later); per-day "today" time-saved (Group D, from runs).
