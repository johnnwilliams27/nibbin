# Finer Re-mining — Design

**Date:** 2026-06-15
**Branch:** feature/nibbin-desktop-unified-app
**Status:** Design — approved (directive: "do the finer re-mining")
**Follows:** `2026-06-15-packet-enrichment-design.md`

## Goal

The enrichment pass retained `urlTemplates` and `dailyMinutes` but only *consumed* `sequences` (the
`automatable` score). This pass consumes the other two — server-side, deterministic — to sharpen
`automatable` and `friction`. Single file: `apps/web/lib/diagnosis/synthesize.ts`. No packet, schema,
desktop, or UI change (the reveal already renders `automatable` + `friction`).

## Refined `automatable` (0–100)

Repetition stays the **gate** (no repeated step-chain → 0, unchanged). Within that, two factors sharpen:

- `repetition = strength / (strength + 24)` where `strength = top.count × top.steps.length` (the prior
  saturating curve, now normalized to 0–1).
- `narrowness` (from `urlTemplates`) — concentrated in few screens ⇒ cleaner to automate:
  `templates > 0 ? 1 / (1 + max(0, templates − 1) / 4) : 1`. 1 template → 1.0; 5 → 0.5; 21 → ~0.17.
- `regularity` (from `dailyMinutes`) — active across more of the window ⇒ more a routine:
  `activeDays > 0 ? min(1, activeDays / studyDays) : 1`.
- `automatable = clamp(round(100 × repetition × (0.6 + 0.25 × narrowness + 0.15 × regularity)))`.

**Backward-compatible by construction:** with no `urlTemplates` and no `dailyMinutes`,
`narrowness = regularity = 1` and the expression collapses to `round(100 × repetition)` — the exact
prior formula. So existing `automatable` tests (e.g. strength 24 → 50, no-seq → 0, clamp → 100) still
pass, and enrichment can only *lower* the score for broad/sporadic workflows (sharper discrimination).
Marked a v0 heuristic; representative values pinned in tests.

## Refined `friction`

When a dominant sequence exists, replace the segment's one-liner with a richer factual line built from
the signals; otherwise fall back to `w.friction` (the on-device note, which is also null when there's
no sequence):

`"a {steps}-step pattern repeated {count}×[, across {N} view(s)][, on {D} day(s)]"`

Factual and deterministic; the Opus labeling pass (`label.ts`) warms it into prose as before (it
already receives the map). The `recommendedNibbin`, `hoursPerWeek`, `frequency` logic is unchanged.

## Testing

- `automatable` unchanged when no enrichment (existing tests stay green).
- narrowness lowers a broad workflow (strength 24 + 21 templates → < 50).
- regularity lowers a sporadic workflow (strength 24 + active 1 of 7 days → < 50).
- a narrow + regular + repetitive workflow stays at the repetition ceiling.
- `friction` composes the factual line when sequences present; falls back to `w.friction` otherwise.

## Out of scope (follow-ups)

- Splitting coarse keys (`email.general` → `email.inquiries`/`overdue`/`newsletter`) — a separate
  finer-mining pass.
- Consuming top-level `dailyAppMinutes` (cross-workflow time allocation).
