# Permission Model: User-Granted Action Levels + Agent School as a Grade

**Date:** 2026-06-20
**Status:** Design — pending user review
**Supersedes:** the draft "uniform write model" spec (binary grant) — folded into this.

## Summary

Today a Nibbin's autonomy is **gated by its Agent School stage** (a sub-Graduate Nibbin *cannot* act, even if permitted). This redefines the model: **Agent School becomes a competency *grade* that informs the owner; the owner grants what a Nibbin may do via a single per-Nibbin control — Observe / Draft / Send.** The grant is the sole gate; the grade never gates.

> "Actions are granted by the end user, and Agent School reflects the competency of the agent. We shouldn't gatekeep a user from granting a lower-graded Nibbin as many permissions as they want." — owner

## The model

Two independent things, identical for every connector (Gmail, Calendar, Stripe, all future apps):

| | What it is | Who sets it | Gates behavior? |
|---|---|---|---|
| **Agent School grade** (Egg→Student→Senior→Graduate) | how well the Nibbin is doing, by performance | automatic | **No** — advisory only |
| **Action level** (Observe / Draft / Send) | the owner's permission for this Nibbin | **the user**, in the UI, per Nibbin, revocable | **Yes — the only gate** |

**Action levels:**
- **Observe** — runs and learns, produces no drafts and no actions.
- **Draft** — produces drafts for the owner's approval; never acts on its own.
- **Send** — acts on its own **immediately, regardless of grade** (sends the email, creates the event, …).

**No gatekeeping.** Any level may be granted to any Nibbin at any grade. When the owner sets **Send** on a low-graded Nibbin, the UI **warns** ("Still a Student — 60% draft accuracy. Let it act on its own?") but **never blocks**. Default for a new Nibbin is **Draft** (Observe for a fresh Egg with nothing to draft yet); **Send is always an explicit choice**.

**What this changes vs today:** it **retires the structural stage-gate** (`gateSideEffect`) that prevented sub-Graduate Nibbins from acting. Safety now rests on: the owner's informed grant (guided by the grade + the warning), per-action approval while in **Draft**, and **all the non-stage walls that remain unchanged** — write scope held at connect, idempotency, send-velocity caps, resource-claim conflict locks, same-origin redirects, vault-only tokens, quarantine. Only the *stage-based* gate is removed.

## Goals / Non-Goals

**Goals**
- Replace stage-gating with a per-Nibbin **action-level** control (Observe/Draft/Send) as the sole execution gate.
- Reposition Agent School as an advisory **grade** (keep the promotion/demotion math; stop gating on it).
- Collapse email's two write capabilities (`email.draft`+`email.send`) into one; everything is `read` or `write`, the action level decides draft-vs-act.
- Uniform draft rendering: proposal always in Nibbin; mirrored to the app's native draft where one exists (Gmail); deleting the Nibbin draft deletes the native draft.
- **Sweep all copy/content** across every surface to describe the new model.

**Non-Goals**
- The calendar-write *primitive* + Composer/hatch/field-study authoring exposure (separate follow-up; the model here makes any such Nibbin behave correctly).
- Removing the non-stage safety walls (idempotency, velocity, claims, vault) — all retained.

## Runtime change — the gate

`packages/runtime/src/runner.ts` (`dispatchStep`) + `packages/runtime/src/school.ts`:
- **Remove** the stage decision from the execute path. `gateSideEffect(stage, …)` no longer determines draft-vs-execute.
- The decision becomes the Nibbin's **action level** for the relevant connection/capability:
  - `observe` → produce nothing (record an observation only; no draft, no effect).
  - `draft` → record the Nibbin draft (+ native-app draft for `nativeDraft` capabilities); never call the effects executor.
  - `send` → call the effects executor (perform the action), behind the unchanged idempotency/claim/velocity walls.
- The old `hasGrant` check folds into this: holding "Send" for a (nibbin, connection) **is** the grant. Reads are always allowed (action level applies to writes only).
- `school.ts` keeps computing the grade (promotion/demotion math) for display; it is no longer consulted by `dispatchStep`.

## Action-level data model

- Per-Nibbin action level, default `draft`. The user-facing control is one selector per Nibbin; under the hood **Send** materializes/maintains the write grants the Nibbin needs on its write-connections (reusing `nibbin_write_grants`), **Draft** clears them, **Observe** sets a per-Nibbin observe flag that suppresses output.
- `nibbins.action_level` enum(`observe`,`draft`,`send`) (migration), OR derive Draft/Send from grant presence + an `observe` flag — decided in the plan; the spec mandates the three-state per-Nibbin control as the source of truth.
- Revocable any time (drop to Draft/Observe); revoking does **not** touch the grade.

## Capability collapse + native draft (folded in)

- `capabilities.ts`: drop the `draft` value from the `sideEffect` union (everything `read`|`write`); remove the standalone `email.draft` capability; `email.send` becomes the single email write with `nativeDraft: true`; `calendar.event-create` gets `nativeDraft: false`. Email/Stripe primitives that yielded a draft-type capability now yield the write capability — behavior is preserved because the **action level** still drafts unless the owner chose Send.
- Executor (`engine.ts`): at the **draft** action level, for `nativeDraft` capabilities, create the native draft (Gmail `drafts.create`, compose scope held at connect — **no grant needed to draft**) and store its id on the Nibbin draft row; on **Send**, send the existing native draft if present (`drafts.send`) and clear the id. Non-native (Calendar/Stripe) draft is Nibbin-only.
- Deleting/dismissing a Nibbin draft deletes the linked native draft (Gmail `drafts.delete`); best-effort, logged on failure, never blocks dismissal.
- `grants.ts`: `WriteCapability` loses `email.draft`; `CapabilityTier` collapses; tier derivation reflects the action level.
- Gmail client gains `createDraft`/`deleteDraft`/`sendDraft`.

## UI

- A single **Observe / Draft / Send** selector on each Nibbin (the Nibbin card / detail page), replacing the Gmail-specific "grant write" button and any tier UI.
- **Pattern:** three mutually-exclusive states → a **segmented control** (3-segment pill), *not* a binary toggle/checkbox (those are 2-state and would misrepresent the model). The component must **conform to the existing design system** — reuse the project's UI kit primitives and `DESIGN.md` tokens (spacing, type, color, motion); do not introduce a new visual style. Run the design-review pass against the implemented control before merge.
- Selecting **Send** on a Nibbin whose grade is below Graduate shows a **non-blocking warning** with the current grade/accuracy; confirm proceeds.
- The grade is shown as an informational badge ("Student · 72% approved-as-is") — clearly advisory, styled per the design system.
- **Copy review:** every string in this control + the warning + the grade badge is reviewed for brand-voice and cross-surface consistency (it must read the same way as the help-center / landing copy produced by the sweep) — no drift between the control's wording and the rest of the rewritten content.

## Copy / content sweep (all surfaces, this PR)

Reframe everywhere from "the Nibbin *earns the right to act*, draft by draft" → "**you grant what a Nibbin may do (Observe / Draft / Send); Agent School grades how well it's doing to help you decide.**" Surfaces:
- Landing (`apps/web/app/page.tsx`), shop (`app/app/shop`), diagnosis, Grovekeeper runtime copy (`packages/keeper/src/copy.ts`), connections/privacy settings.
- Help center: `docs/help-compendium.md` + `apps/web/lib/help/content.ts` (every "earns the right / read-only / draft-then-send-ladder" string).
- Reference HTML (`reference/*.html` — demo, privacy, data-ai, subprocessors).
- `README`, `docs/**/*.md`, the connector-builder skill files.
- **`docs/INVARIANTS.md` C8 + `SPEC.md` C8**: rewrite to the action-level model (grant-gated, grade-advisory). Any claim that "untrained agents cannot act" must be removed/rewritten — it is no longer true by construction.
- The Agent School explainer copy: keep "School" as the grade/report-card; drop language implying School *unlocks* permissions.

## Migration & compatibility
- `nibbin_write_grants.capability='email.draft'` → `'email.send'`.
- Set each existing Nibbin's `action_level`: write-grant-holders → `send`; others → `draft` (preserves current effective behavior — today's drafting Nibbins stay drafting; today's granted ones keep acting). Paused Nibbins → `observe`.
- Spec `toolsAllowlist` `'email.draft'` → load-time shim to `'email.send'` + source updates to shop templates.
- `side_effects` table: add `native_draft_ref`.

## Error handling
- Native-draft create/delete failures: keep the Nibbin proposal as source of truth; soft-note + best-effort retry; never block.
- Connector auth/not-connected errors flow through `ConnectorRequestError` → `emitConnectorBlocked`.

## Testing
- Action-level matrix per capability: Observe→no output; Draft→draft(+native mirror for Gmail); Send→execute — **at every grade, including Egg/Student** (proving the stage no longer gates, and that an Egg+Send acts).
- Native-draft mirror + delete-sync (Gmail yes, Calendar no).
- Grade is computed + displayed but never consulted by `dispatchStep` (a test asserting `dispatchStep` outcome is invariant to stage given a fixed action level).
- The retained walls still hold under Send at low grade: idempotency, velocity, resource claims (an Egg+Send Nibbin still can't double-send, exceed velocity, or break a resource lock).
- Migration correctness; copy sweep leaves no "earns the right to act / untrained can't act / read-only" survivors (grep gate).
- **Adversarial gate** — the safety model changed materially; the 4-reviewer gate MUST re-evaluate (red-team: with the stage wall gone, confirm the *other* walls fully contain an Egg+Send Nibbin; claims-auditor: every surface's copy matches the new model; logic-skeptic: action-level transitions + observe suppression; cost-auditor: Send-at-Egg doesn't change routing tiers). Report to `docs/gates/`.

## Risk
This is **foundational** and changes a core safety stance plus a large amount of user-facing narrative. It removes the stage-based structural wall (deliberately, per owner). Controls: the non-stage walls remain and are explicitly tested under Send-at-low-grade; safe default (Draft) + non-blocking warning; the migration preserves current effective behavior; and the full adversarial gate re-runs. The copy sweep is a large workstream bundled here by owner request — the claims-auditor enforces completeness.
