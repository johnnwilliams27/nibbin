# P3 — Passive-Capture Propose Loop — Design

**Date:** 2026-06-23
**Chunk:** P3 from the Company Brain parallel wave.
**Builds on:** F2 (`proposals`, `propose_memory_change`, `decide_memory_proposal`) and F1 (`sources`, `kind='observation'`).
**Canonical spec:** `docs/COMPANY-BRAIN.md` §5 input #3, §5.2.
**Status:** Design, pending plan.
**Headline:** "Learns by watching" — the path that makes passive capture finally write memory (gated by human approval).

---

## 1. Problem statement

Today the Field Study's end-state is a privacy review loop: the user deletes individual captured events they want removed, and everything that survives is silently discarded. Nothing flows from the review into Grove Memory. The brain watches but never learns.

P3 closes that gap. After the user's privacy review, surviving events are the consent signal: the user saw them and chose not to delete them. P3 derives a small set of structured memory proposals from that approved body of observations and adds them to the F2 review queue for the user to ratify into Grove Memory.

This is the "learns by watching" promise made real: capture → user privacy review → derivation → memory proposal → user memory ratification → Grove Memory.

---

## 2. Scope

**In scope:**
- The on-device derivation step that turns surviving post-review events into a structured `ObservationSummary`.
- The cloud upload path: what `ObservationSummary` is allowed to contain (privacy boundary).
- Writing a `sources` row (`kind='observation'`) and calling `propose_memory_change(origin='capture')`.
- How the memory proposal surfaces inside the existing F2 review queue / Memory page.
- UX for the capture-to-proposal handoff — what the user sees when a study completes and proposals are ready.

**Out of scope:**
- The privacy review UI itself (`/app/study/review`) — that surface exists and is unchanged by P3.
- The on-device observer, capture pipeline, or redaction layer — C1/C7 are not relaxed.
- Conflict detection when proposals contradict existing memory (C2).
- Periodic collate / overnight consolidation pass (C1).
- Synthesis / query layer (P5).

---

## 3. Privacy invariants (non-negotiable)

These constraints are inherited from the existing architecture (C1/C7) and must not be weakened by P3:

**C1 — Derived-not-raw:** no raw event content ever leaves the device. The AX label, window title, URL path, and keystroke content captured on-device are **not** uploaded even in redacted form. Only structural / statistical derivations cross the boundary.

**C7 — Cloud field-notes never ingest local observer events:** `packages/drip/src/field-notes.ts` is built from cloud data (Nibbin run summaries, connector insights) only. The on-device `apps/desktop/src/core/field-notes.ts` computes stats locally and they stay local. P3 follows this same split.

**Consent = survival:** an event that survived the user's privacy review is not affirmatively consented content — it just wasn't deleted. Derivation must treat it as a weak signal, not a transcript. The proposed Grove Memory entry must describe a *pattern* ("you work in Figma most mornings") not a moment ("at 9:14am on Tuesday you opened file X").

---

## 4. The privacy boundary fork (decision required)

This is the highest-stakes architectural decision in P3. Two options; the spec recommends Option A but calls it out because it has a real trade-off.

### Option A (recommended) — On-device derivation, ObservationSummary crosses the boundary

1. After the user completes the privacy review (events that survived deletion), the **Tauri process** runs a local derivation pass over the surviving events using the existing `computeFieldNotes` logic as a base, plus a small additional layer that maps stats to typed `ObservationSummary` slots (see §5).
2. The `ObservationSummary` — not the events — is then sent to the cloud (POST to a new `/api/brain/propose-from-capture` route) over the existing Tauri IPC / desktop-bridge.
3. The cloud route writes the `sources` row and calls `propose_memory_change`.

**Why:** the derivation runs inside the trust boundary. No event-level data crosses. The cloud only sees the summary: top apps, workflow shape, timing patterns, dominant activity categories — all of which are already in `FieldNotesDay` or one level above it.

**Trade-off:** the quality of proposals is limited to what a local JS derivation pass can infer without a frontier model. The summary is structural; the model runs on the cloud side but only sees the already-derived summary, not the raw events.

### Option B — Events sent to a secure on-device model, richer derivation

A local model (running inside the Tauri process or a sidecar) sees the surviving events and produces richer natural-language proposals before the summary crosses the boundary.

**Why not yet:** this requires bundling a model, increases binary size significantly, and couples P3 to local inference infrastructure that doesn't exist yet. Deferred as a future upgrade path; the `ObservationSummary` schema is designed to be replaced with a richer payload when a local model is available without changing the cloud-side contract.

**Decision the human must make:** whether Option A's proposal quality is good enough for the initial ship, or whether P3 should be deferred until Option B is available. This spec proceeds assuming Option A is sufficient and the value of closing the "learns by watching" loop outweighs the proposal richness gap.

---

## 5. ObservationSummary — the cross-boundary payload

This is the ONLY thing that leaves the device in the P3 flow. It is a typed, bounded struct. If a field cannot be derived without embedding raw content, it is omitted.

```
ObservationSummary {
  study_id: string                  // matches field_notes_sessions.id; links source back to the study
  study_period: { start: string; end: string }   // ISO dates; establishes recency
  total_events_reviewed: number     // how many events the user saw and kept
  active_ms: number                 // total active time observed
  top_apps: Array<{
    name: string                    // e.g. "Figma", "Gmail", "Notion"
    durationMs: number
    category?: string               // if derivable: "design", "communication", "writing"
  }>
  busiest_hour: number | null       // 0-23 UTC
  workflow_shapes: Array<{
    pattern: string                 // e.g. "email→calendar→doc", "figma→slack→figma"
    frequency: number               // how often seen in the study period
  }>
  gap_count: number                 // capture gaps (privacy pauses) count
  // nothing from ax.label_redacted, window.title_redacted, url.path, or any keystroke content
}
```

`workflow_shapes` is derived by looking at transitions between `e.app.name` across the surviving events in temporal order, collapsing runs of the same app, and counting patterns of length 2-3. This is purely structural (app names only, no content) and is already less sensitive than what `computeFieldNotes` returns.

The server-side route validates that `ObservationSummary` contains no unexpected fields (strict schema parse) before accepting it.

---

## 6. Cloud-side flow

### 6.1 New route: `POST /api/brain/propose-from-capture`

- Auth: `requireSession` (same as all study IPC endpoints).
- Body: `ObservationSummary` (validated against a Zod schema).
- Runs redaction check (`isClean`) on the stringified payload — quarantine and reject if anything pattern-matches raw content.
- Calls `propose_from_capture(account_id, summary)` — a **service-role** function that:
  1. Inserts a `sources` row: `kind='observation'`, `title='Field Study — {study_period.start}'`, `origin={study_id, active_ms, top_apps, workflow_shapes}`, `source_tier=40` (observations below documents, above casual; C2 can learn adjustments), `redaction_status='clean'`.
  2. Calls the **on-cloud derivation step** (see §6.2) to turn the `ObservationSummary` into 1–3 typed proposals.
  3. For each proposal: calls `propose_memory_change(account_id, field_key, op='append', proposed_value, rationale, source_id, origin='capture')`.
- Returns: `{ source_id, proposal_ids }`.

### 6.2 On-cloud derivation step

This is a lightweight Claude call (via the existing Nibbin agent infrastructure) that takes the `ObservationSummary` and produces structured proposals, strictly constrained to the `MEMORY_SECTIONS` field namespace.

**System prompt directive (summarized):** "Given this structural summary of observed work patterns, propose 1–3 brief additions or updates to the user's business memory. You may only reference patterns (recurring apps, timing, workflow shapes), never specific moments. Output must be JSON: `[{ field_key, value, rationale }]`. Never propose to Hard Rules. Never propose raw content. If the summary is too thin to produce a confident proposal, return []."

**Proposal quality floor:** if the derivation returns [], no proposal is created and no `review_item` notification fires. The `sources` row is still written (it's evidence that a study ran, useful for staleness).

**Cost note:** this is one small, constrained call per completed study. Studies are infrequent (one every N days/weeks per the field-study spec). Cost is negligible.

**Why not deterministic rules instead of a model call?** The app-name→field-key mapping is fuzzy ("Figma" → `voice`? `policies`?). The model handles ambiguity and gracefully returns [] for thin data. A rule table would need ongoing maintenance and would miss cross-app pattern signals.

---

## 7. The propose → ratify path (F2 integration)

P3 is a producer of the F2 loop. It calls the same `propose_memory_change` RPC that P2 (doc ingestion) and any other producer calls. No new approval primitive is needed.

### 7.1 What the user sees

When `propose_memory_change` is called with `origin='capture'`, a `review_item` notification fires per the F2 design. The proposal surfaces in the F2 review queue on the Memory page with:

- **Origin badge:** "From your Field Study" (not "from a doc") — distinct visual tag so the user understands where this came from.
- **Rationale:** the model-generated rationale string (e.g. "You spent 62% of observed time in Figma across 4 morning sessions — looks like design work is your primary focus.").
- **Proposed value:** the value to append/replace, shown clearly.
- **The linked study:** a link or affordance pointing back to the study in Field Study history (so the user can verify what observation this derived from before approving).

### 7.2 Approve / reject

Unchanged from F2: `decide_memory_proposal('approved')` writes to the curated field, appends `grove_memory_history(change_source='proposal', origin='capture')`, links `field_evidence(field_key, source_id='observation')`, logs `audit_log(kind='memory_ratification')`. Reject writes nothing curated. Both resolve the `review_item` notification.

### 7.3 Timing (when does the proposal appear?)

The propose-from-capture call is triggered at the end of the **privacy review**, not at the end of the study.

Flow:
1. Study completes → state transitions to `REVIEW`.
2. User works through `/app/study/review` (delete unwanted events).
3. User taps a new **"Done reviewing"** button (see §8 UX). This call:
   a. Calls the existing review-finalize path (raw deletion, study state → `COMPLETE`).
   b. Calls the new Tauri command `deriveObservationSummary()` which runs the on-device derivation.
   c. Posts the `ObservationSummary` to `/api/brain/propose-from-capture`.
4. The user lands back on Grove Memory or the study summary page, where a nudge card says "N memory suggestion(s) ready to review" if proposals were generated.

This sequencing ensures the proposal is computed only over what the user explicitly kept — the privacy review is the consent gate.

---

## 8. UX additions

### 8.1 "Done reviewing" button on `/app/study/review`

Today the review page has no explicit completion action — it's unclear when the user is finished. P3 requires adding a primary CTA at the bottom of the review page:

**Label:** "Done — save what I kept"
**Behavior:**
- Calls the Tauri command `finalizeReview()` (new, wraps existing raw-deletion + study-complete + observation-derivation + upload).
- Shows an inline loading state ("Learning from your study…") while the cloud derivation runs.
- On success: navigates to Memory page (or a post-study summary micro-surface, see §8.2) with a banner: "Your Nibbin found N thing(s) to add to your memory — ready when you are."
- On derivation returning [] or on error: navigates normally with no memory nudge; silently no-ops (no error surfaced to user — the study still completed successfully).

**Important:** the current delete-individual-event interactions are unchanged. "Done reviewing" is additive.

### 8.2 Post-study memory nudge (optional micro-surface)

If proposals were generated, after "Done reviewing" the user may see a lightweight interstitial (not a modal, a full-width card or a brief route `/app/study/summary`) showing:

- "Your Nibbin noticed a few patterns in your work. Here's what it wants to add to your memory."
- Inline proposal cards (field, proposed value, rationale) with Approve / Skip inline — so the user can ratify without navigating to the full Memory page.
- "Review all in Memory" link for anything skipped.

This is optional at ship. The minimum viable path is: proposals in the F2 queue on the Memory page, with the "N suggestion(s) ready" banner after review completion. The micro-surface is a P1 co-design decision.

### 8.3 Memory page — origin tag

In the F2 review queue, proposals from capture are tagged with a visual origin indicator: a small "Field Study" label (distinct from "Document" for P2 proposals). This is a low-cost addition to the proposal card rendering that P1 implements.

---

## 9. New Tauri command: `deriveObservationSummary`

The desktop bridge (`apps/desktop/src/`, Tauri command layer) gets one new command:

```
deriveObservationSummary() → Promise<ObservationSummary | null>
```

- Reads surviving events from the local store (the events that were NOT deleted in the privacy review — the same set `reviewData()` returns before deletion).
- Runs the derivation (re-uses `computeFieldNotes` plus the workflow-shape pass — pure, local, no IO).
- Returns the `ObservationSummary` struct, or `null` if there are too few events to produce a meaningful summary (threshold: < 10 surviving events or < 5 minutes active).

This is pure computation over already-redacted data. It does not read the raw event store; it reads the already-reviewed survivor set. The existing `reviewData()` / `reviewDelete()` Tauri commands handle the event store; `deriveObservationSummary` is read-only over the post-review state.

`finalizeReview()` — the new Tauri command that sequences:
1. Flush any pending deletions (same as today's manual delete path, now atomic).
2. Mark the study `COMPLETE` (existing IPC).
3. Call `deriveObservationSummary()`.
4. Upload the result via the web app's `/api/brain/propose-from-capture` if non-null.

The web app calls `desktopBridge.finalizeReview()` from the review page's "Done" button handler.

---

## 10. Schema additions (minimal)

P3 requires no new tables beyond what F1/F2 ship. The additions are:

**`sources.kind`** already allows `'observation'`; no migration needed.

**`proposals.origin`** already allows `'capture'`; no migration needed.

**`notifications.kind`** — the F2 design extends this to include `'review_item'`; P3 rides that extension.

The only new migration artifact is the `propose_from_capture` server-side function (a thin wrapper that creates the source + calls `propose_memory_change` in one transaction). This can be either:
- A new security-definer Postgres function (keeping it in the same migration file as F1/F2 RPCs), or
- A Next.js route-level transaction (keeping schema migrations minimal, runtime logic in the app layer).

**Recommendation:** route-level (option b) — the F1/F2 RPCs already exist; `propose_from_capture` is orchestration (source insert + n × propose_memory_change calls), not a primitive. Avoids an additional PL/pgSQL function for what is essentially application logic.

---

## 11. Security and privacy review (every new data path)

- **ObservationSummary schema validation:** the API route parses against a strict Zod schema; any extra fields → 400. Prevents future additions to the client payload from accidentally including raw content.
- **Redaction scan on upload:** `isClean()` from `@nibbin/redaction` is called on the stringified `ObservationSummary` before it is written to any database table.
- **No raw events stored cloud-side:** the `sources.origin` JSONB contains only what is in `ObservationSummary`; the server never receives event IDs, `ax.label_redacted`, `window.title_redacted`, URL paths, or keystroke data.
- **Service-role RPC for source + proposal writes:** same as all F2 producers. Only the authenticated session triggers the upload; the service-role function cannot be called directly by the client.
- **RLS on `sources` and `proposals`:** inherited from F1/F2; member-scoped reads, no cross-account leakage.
- **Proposal quality quarantine:** if the cloud derivation step (§6.2) returns a proposal whose `proposed_value` fails `isClean()`, it is dropped silently (logged to `audit_log`), not written to `proposals`. The source row is still retained.
- **Thin derivation ceiling:** the `system_prompt` for the cloud derivation step specifies output is `[]` when the summary is ambiguous. Ambiguous proposals that still get generated are surfaced for human ratification — they are never auto-applied.

---

## 12. Decision log

| # | Decision | Rationale |
|---|----------|-----------|
| PD1 | On-device derivation (Option A): `ObservationSummary` crosses the boundary, not events | Preserves C1/C7; local model unnecessary to ship the loop; summary is sufficient for pattern-level proposals |
| PD2 | Consent gate = "Done reviewing" button, not study completion | Proposal must derive from what the user kept, not what was raw-captured; privacy review is the natural consent gate |
| PD3 | Cloud derivation step uses a small model call, not a rule table | App-name → field-key mapping is fuzzy; model handles gracefully; returns [] on thin data |
| PD4 | `propose_from_capture` is route-level orchestration, not a new PL/pgSQL primitive | Keeps schema migrations minimal; orchestration belongs in app layer; F1/F2 RPCs already handle the primitives |
| PD5 | Proposals surface in the existing F2 review queue on Memory page | One approval surface, one review queue; don't build a separate "study proposals" UI — reduces UI surface and enforces the single-queue principle (§10, COMPANY-BRAIN) |
| PD6 | `source_tier=40` for observations (below documents at ~60, above casual chat) | Reflects that an observation summary is derived/structural signal, not authoritative documentation; C2 can learn adjustments |
| PD7 | [] proposals = no notification, no user-facing error | Studies with thin data still complete; the brain learns to surface nothing rather than surfacing noise |

---

## 13. Open questions for John (before plan)

1. **Option A vs B (§4):** Is pattern-level proposal quality (app names, timing, workflow shapes) sufficient to close the "learns by watching" loop at ship, or should P3 wait for a local-model path?
2. **Post-study micro-surface (§8.2):** Ship the inline interstitial after review completion, or land straight on Memory page with just the banner and rely on the F2 queue? The interstitial is faster to ratify but adds a net-new route/component.
3. **`finalizeReview` sequencing:** should the derivation and upload happen synchronously (user waits for "Learning…" spinner, max ~5 seconds) or fire-and-forget (study completes instantly, proposals arrive asynchronously and the banner appears next time the user opens Memory)? Synchronous is simpler and the user gets immediate confirmation; async is more resilient to network issues.

---

## 14. Acceptance criteria

- [ ] `deriveObservationSummary()` Tauri command exists; output contains no raw event content; validated against a Zod schema server-side.
- [ ] `finalizeReview()` Tauri command sequences: flush deletions → mark complete → derive → upload (if non-null).
- [ ] `/api/brain/propose-from-capture` validates, redaction-scans, writes a `sources(kind='observation')` row, calls `propose_memory_change(origin='capture')` for each proposal.
- [ ] Cloud derivation returns [] for thin summaries and no proposals or notifications fire.
- [ ] Proposals from capture appear in the F2 review queue with an "From your Field Study" origin tag and the linked-study affordance.
- [ ] `decide_memory_proposal` approve path writes `grove_memory_history(change_source='proposal')` + `field_evidence` link + `audit_log` ratification (inherited from F2; verified in a P3 end-to-end test).
- [ ] "Done reviewing" button on the review page calls `finalizeReview()` and navigates with the proposal banner.
- [ ] No raw event content in any database table, network payload, or log line (verified by security review).
- [ ] Existing privacy review (delete individual events, add exclusions) is unchanged and green.
- [ ] Migration applied to dev/staging/prod (only if any schema change is required — target: none beyond F1/F2).

---

*End of spec. Implement after F1 + F2 are built and green. Where a decision above needs to change, record it in §12 with rationale — not silently in code.*
