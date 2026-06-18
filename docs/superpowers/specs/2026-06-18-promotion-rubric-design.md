# Promotion Rubric — Design Note (richer success signal for Agent School)

**Date:** 2026-06-18
**Status:** Settled (design-only; all four §6 decisions locked) — ready for a gated implementation plan (R1/R3 = `nibbin_promote` SQL + `school.ts` + curriculum; R2 = `notifications.kind` CHECK migration + drift leaf). Not yet built.
**Scope:** How Agent School *quantifies success* for promotion (Student→Senior→Grad). Proposes adding **coverage**, **freshness**, and **severity** to today's single accuracy ratio. Does **not** touch the stage *behaviors* (Egg observes / Student drafts / Senior routine-autonomous / Grad in-spec) or the ceremony layer.

> Companion to [Agent Synthesis] (§4.7 Agent School) and the Ceremony spec (which *celebrates* promotions — see `2026-06-17-ceremony-reveal-design.md`). This note is the upstream "what is being earned."

---

## 1. Where we are today

The gate is one number, enforced in `nibbin_promote` (SQL, authoritative) and mirrored in `packages/runtime/src/school.ts` (`promotionCheck`):

- **≥ 95% approved-unedited over a rolling 25-run window**, **stage-scoped** (only decisions since `stage_changed_at`), **auto-fired** after every decision (`apps/web/lib/runtime/decide.ts` → `maybePromote`).
- Egg→Student is the one exception: context-observed (a scan or grove answers), not accuracy.
- Floors invariant (`PROMOTION = {windowRuns:25, minApprovedUneditedPct:0.95}`): curriculum may tighten, never loosen.
- Success = a draft the human **approved without editing**. Edited *and* rejected both count against. `edit_distance` is recorded (`decide.ts`) but the gate is **binary**.

This is honest and hard to game on *accuracy*. Its blind spots are about *what* the 25 runs were.

## 2. Guardrails any change MUST honor (INVARIANTS.md + this review)

- "Gamification **rewards accuracy only**; nothing decays, dies, or guilts; **no mechanic may grant or accelerate autonomy**." → New dimensions may only make autonomy **harder or equal** to earn — never a shortcut, never partial credit that loosens the 95%/25 spine.
- "Agent School gates side effects at the **runtime layer**, never the prompt layer." → All of this stays in SQL/runtime.
- "Promotion is verified accuracy over a rolling window — never time served." → Time may never *grant* a stage **and may never take one away** (see next).
- "Demotion is one click, instant, dignified." → The human pulls the trigger. The system may *point*, never yank.
- **Paused ≠ penalized — trust freezes, never decays (this review).** A Nibbin's earned progress is **banked**: a pause, a disconnected connector, the global capture pause, or a quiet stretch all produce *no new runs → no new evidence →* the state is **frozen, not eroded**. Trust is earned by evidence and is **never lost to silence** — only ever questioned by *new, contradicting evidence* (actual recent runs that were edited/rejected). No wall-clock decay anywhere.

## 3. Proposal — three additive dimensions (the 95%/25 ratio stays the spine)

Each is an **additional precondition to step *up*** — a Nibbin promotes only if the accuracy floor **and** the new gate(s) hold. **None can lower the bar, and none ever resets or subtracts accumulated approvals** (they gate the *next* stage; they never cause a fall-back). The default path is unchanged: a Nibbin doing consistent routine work still auto-promotes on the simple 95%/25 with nothing extra to clear. The new gates only bite where early promotion is genuinely risky.

**R1 — Coverage (Senior→Grad only).** Today a Nibbin can graduate to full in-spec autonomy on 25 near-identical easy runs. Add: the qualifying window must span **≥ K distinct routine patterns** (the same `RoutineStore` key Senior already uses for `routineMinApprovals`). Graduation then means *broad* verified accuracy, not a streak on one easy case. **Counts only currently-available patterns** — if a capability/trigger is paused, that pattern is simply not required, so a pause can never *block* graduation on the rest. `K` lives in curriculum (default proposed 3–4), tighten-only. (Coverage applies only to the step into full autonomy; Student→Senior is unchanged.)

**R2 — Drift nudge (human-triggered; NOT decay, NOT auto-demotion).** *Decided this review: nudge-only.* No wall-clock freshness (killed — it would penalize a pause). Instead, a quiet check keyed **only on new contradicting evidence**: if a Senior/Grad's **recent actual** runs degrade (proposed: <80% approved-unedited over the last 10 *decided* runs — silence produces zero, so an idle Nibbin never trips it), the system surfaces a **calm nudge** — *"Scribe's last few got edited — want to put her back to drafts while she re-learns?"* The human still performs the one-click dignified demotion. The system **points, never yanks** — chosen because demotion resets the stage-scoped climb, so an automatic downgrade over a couple of unlucky runs would itself destroy earned progress (the harm we're avoiding).

**R3 — Severity weighting.** Today a rejected external send weighs the same as a rejected internal draft. Weight each decision by **side-effect stakes** (reuse the weighted-credit tiers already in INVARIANTS — "Weighted credits 1/3/10"). Promotion numerator stays strictly *approved-unedited*; the denominator/threshold become stakes-weighted so high-stakes misses count more. Raises the bar only on consequential actions — invariant-aligned, and still no fall-back.

**Edit-distance (cross-cutting, diagnostic only).** Use the already-captured `edit_distance` to (a) grade *how far* a non-approval was (near-miss vs rewrite) for the freshness/early-warning signal and the Field-Notes surface, and (b) optionally make a heavy rewrite weigh more negatively. **Never** to count an edited run as a partial win toward promotion — that would loosen the floor (forbidden).

## 4. Phasing (smallest invariant-safe step first)

- **P1** — Drift nudge + edit-distance diagnostics. Data already exists; a recent-window accuracy read (no schema change) + a surfaced nudge on Grove Home / Field Notes. Ships the anti-drift safety win without touching the promote gate at all (it never demotes — it points).
- **P2** — Coverage gate at Senior→Grad (needs the per-pattern, available-only count in `nibbin_promote`).
- **P3** — Severity weighting (needs a small **stakes taxonomy** mapping tool/side-effect → weight; reuse 1/3/10).

## 5. Build surface & gating

All of R1–R3 land in **`supabase/migrations/` (new `nibbin_promote` revision) + `packages/runtime/src/school.ts` + curriculum config** — every one is in the **CI sensitive-path regex**, so the build will require a `docs/gates/<date>-promotion-rubric.md` adversarial-gate report and migration on dev/staging/prod. (This *design note* is docs/ — gate-free.) The SQL stays authoritative; `school.ts` stays its pure mirror for UI/runtime.

## 6. Decisions

**Settled this review:**
- **Drift handling — nudge-only.** No auto-demotion; the system surfaces a calm nudge, the human keeps the one-click demotion.
- **No wall-clock decay.** Freshness-by-clock is dropped; trust freezes on inactivity, never erodes. A pause never costs progress.
- **No fall-back from new gates.** R1/R3 gate the *next* stage only; they never reset or subtract accumulated approvals.

**Settled (this review — all four):**
1. **Coverage `K` = 4** distinct currently-available routine patterns for Senior→Grad.
2. **Drift nudge = <80% approved-unedited over the last 10 *decided* runs**, surfaced as a **notification leaf** (reuses the Notification Center; a new `nudge`/`drift` leaf kind with a "put back to drafts" CTA — silence never trips it, since fewer than 10 recent decided runs = no nudge).
3. **Severity = the existing 1/3/10 weighted-credit tiers** as the stakes weights (no separate scale).
4. **Build all three together** (R1 + R2 + R3 in one effort), not phased.

→ Ready for an implementation plan. Note the build is **gated** (R1/R3 touch `nibbin_promote` SQL + `school.ts` + curriculum; R2's leaf kind needs a `notifications.kind` CHECK migration) — so it needs migrations on dev/staging/prod, a `docs/gates/` report, and the CI adversarial gate. Security testing must assert the §2 guardrails (no fall-back/reset, paused≠penalized, nudge-only, floors only tighten).
