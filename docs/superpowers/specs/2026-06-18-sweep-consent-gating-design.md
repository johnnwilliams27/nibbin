# Sweep Consent-Gating — Design (2026-06-18)

## Goal

The Gmail onboarding sweep — a one-time read of the user's recent sent + inbox
mail that sends sent-mail bodies to an LLM to seed the Nibbin's voice/FAQ/facts —
must never run without the user's **affirmative, informed opt-in**. Today
(`apps/web/app/api/connect/google/callback/route.ts:21-40`) it fires
automatically on Gmail connect, gated only by `SWEEP_HMAC_SECRET` (currently
unset → dark) and the tester allowlist. The OAuth `gmail.readonly` grant
authorizes *read access for the agent*; it is not informed consent for "read ~12
months of history and process it through a model." This adds that consent gate.

## Principles (from the Trust & Controls spec)

- **TC-P1 — promise = behavior.** The consent copy states exactly what happens.
  In particular it does NOT repeat the standing privacy-page overclaim (issue
  #132: "not the raw messages" is false for sent Pass-1) — it says plainly that
  **sent-message bodies are processed by the model**, the inbox is reduced to
  subjects + previews, and only short derived notes are kept.
- **TC-P2 — controls reachable.** The ongoing control lives in the Data & Privacy
  panel, where a user looks for it.
- **TC-P7 — say exactly what flows where.** No conflation of "learn from my mail"
  with training/fleet contribution; the copy is sweep-specific.
- **Affirmative consent (GDPR Recital 32 / Planet49).** Default **off**; the
  checkbox ships **unchecked**. No pre-ticked consent. (Owner-confirmed.)

## Decisions (locked in brainstorming)

| Decision | Choice |
|---|---|
| Capture surfaces | **Both**: a pre-connect checkbox **and** a Data & Privacy panel toggle |
| Default | **Off** everywhere; checkbox unchecked (affirmative opt-in) |
| Panel toggle "off" | **Simple on/off, no forget** — off prevents a future learn; already-derived notes remain (editable in the grove-memory editor) |
| Seed window | **~12 months** (`SWEEP_WINDOW_DAYS` 90 → 365); caps unchanged (`MAX_SENT_MESSAGES`=200, `MAX_INBOX_THREADS`=300) |

Rationale for the window: Gmail returns newest-first and the per-message caps
bind before the window for any active mailbox, so 90→365 is free for busy users
(still the newest 200/300) and strictly better for sparse ones. The sweep is the
**cold-start seed only** — ongoing learning accrues from new mail via the agent
memory/RAG work (#135).

## Components

1. **Migration** (`supabase/migrations/<ts>_sweep_consent.sql`, applied
   dev/staging/prod):
   - `public.connections` += `sweep_consent_at timestamptz` (null = no consent)
     and `sweep_consent_by uuid references public.users(id)` (nullable; who
     consented). No backfill — existing rows = null = no consent (safe default).
   - `public.oauth_pending_authorizations` += `sweep_consent boolean not null
     default false` — carries the checkbox choice through the OAuth redirect.

2. **Pending threading** (`apps/web/lib/connections/pending.ts`): add
   `sweepConsent` to `StorePendingInput` and `PendingAuth`; `storePending` writes
   the `sweep_consent` column, `consumePending` reads it back. Default `false`.

3. **Begin** (`apps/web/lib/connections/begin.ts`): `beginConnect` accepts
   `sweepConsent?: boolean` and passes it into `storePending`. Only meaningful for
   Gmail; ignored otherwise.

4. **Dispatch helper** (new `apps/web/lib/sweep/dispatch.ts`): extract
   `makeSweepHmac` + `dispatchSweepFireAndForget` out of the callback route into a
   reusable unit. The fire condition becomes: `provider === 'gmail'` **AND** HMAC
   available **AND** the connection's `sweep_consent_at` is set. (Adds to — does
   not replace — the existing `SWEEP_HMAC_SECRET` + tester-allowlist gates.)

5. **Callback** (`apps/web/app/api/connect/google/callback/route.ts`): after the
   connection is completed, if `pending.sweepConsent` is true, stamp
   `connections.sweep_consent_at = now()`, `sweep_consent_by = userId`, then call
   the dispatch helper. If false, do nothing (no stamp, no sweep).

5b. **Worker-level enforcement** (`apps/web/app/api/sweep/gmail/onboarding/route.ts`):
   consent is authoritative at the worker, not only the dispatcher. After the HMAC
   check and **before** claiming, the route loads the connection and refuses
   (`{ status: 'skipped', reason: 'no_consent' }`, 200) when `sweep_consent_at` is
   null — so a replayed/forged HMAC cannot sweep a connection the user never opted
   in. Fail-closed: a missing/invalid connection also refuses. The dispatch
   helper's consent check (§4) is the cheap pre-filter; this is the boundary.

6. **Connect UI** (`apps/web/app/app/connections/page.tsx` + `actions.ts`): an
   unchecked checkbox beside the Gmail "Connect" control; its value flows into the
   connect server action → `beginConnect({ sweepConsent })`. Checkbox copy (TC-P1)
   is in §Copy below. Shown only for Gmail.

7. **Data & Privacy panel** (`apps/web/app/app/settings/privacy/page.tsx` +
   `apps/web/lib/privacy/panel.ts` view-model + a `setSweepConsentAction`): a
   "Learn from my Gmail history" toggle per active Gmail connection, reflecting
   `sweep_consent_at != null`. Turning **on**: set `sweep_consent_at`/`_by`, then
   if the connection has not yet been swept (no complete/partial row in
   `gmail_sweep_log`), call the dispatch helper. Turning **off**: clear
   `sweep_consent_at` (no data deletion — "no forget"). Once a sweep has run, the
   toggle is informational ("Learned on <date>"); it cannot re-run (the #112
   `gmail_sweep_log` claim blocks a second sweep, and there is no re-run path).

8. **Window** (`apps/web/lib/sweep/gmail-onboarding.ts`): `SWEEP_WINDOW_DAYS`
   90 → 365. Caps unchanged.

## Data flow

```
CONNECT PATH
 connections page  ──(sweepConsent: bool)──▶ connect action ──▶ beginConnect
   └ checkbox (unchecked)                                          └ storePending(sweep_consent)
 Google OAuth redirect ──▶ callback
   └ consumePending → pending.sweepConsent?
        true  → stamp connections.sweep_consent_at/_by → dispatchSweep (if HMAC + gmail)
        false → nothing

PANEL PATH
 Data & Privacy toggle ──▶ setSweepConsentAction
   on  → set sweep_consent_at/_by → (if not yet swept) dispatchSweep
   off → clear sweep_consent_at  (no forget; derived notes stay)

DISPATCH GATE (lib/sweep/dispatch.ts)  — pre-filter
 fire iff provider=gmail AND SWEEP_HMAC_SECRET set AND sweep_consent_at set

WORKER GATE (api/sweep/.../route.ts)  — authoritative, fail-closed
 after HMAC, before claim: if connection.sweep_consent_at is null → skipped:no_consent
```

## Copy (TC-P1 / TC-P7)

Checkbox label + helper (connect screen):

> ☐ **Let my Nibbin learn my style from my mail.**
> It reads about your last **12 months** of sent + inbox mail, once. Your sent
> messages are **processed by the model** to learn your voice; your inbox is
> reduced to subjects and previews. Only short derived notes are saved — the raw
> mail isn't kept. You can turn this off anytime in Data & Privacy.

Panel toggle label: **"Learn from my Gmail history"** with the same one-line
disclosure; post-sweep state: "Learned from your mail on <date>."

## Testing

- **Pending threading** (`pending.test.ts`): `sweepConsent` round-trips through
  store → consume; defaults false when absent.
- **Begin** (`begin.test.ts`): `sweepConsent` reaches `storePending`.
- **Dispatch helper** (new `dispatch.test.ts`): fires only with all three gates
  true; no-ops when consent absent, when HMAC unset, or when non-gmail.
- **Callback**: consent true → stamps + dispatches; false → neither. (Extend the
  callback's existing test surface or the dispatch seam.)
- **Worker enforcement** (sweep route test): a request for a connection with
  `sweep_consent_at` null → `skipped: 'no_consent'`, the claim RPC and
  `gmailOnboardingSweep` are NOT called (no budget spent); consent present →
  proceeds to claim.
- **Panel action**: on sets consent + dispatches once when unswept; on when
  already swept does not re-dispatch; off clears consent and deletes nothing.
- **Window**: `SWEEP_WINDOW_DAYS === 365`; `buildSentQuery`/`buildInboxQuery`
  reflect the wider cutoff.

## Gate

Sensitive surface (touches `apps/web/app/api/`, `packages/connectors` is not
touched here but `connections` + a migration are) → requires an **adversarial
gate** pass (red-team / claims-auditor / logic-skeptic / cost-auditor) and a
committed `docs/gates/2026-06-18-sweep-consent-gating.md` before the PR can merge
(enforced by `adversarial-gate.yml`). The claims-auditor will specifically check
the consent copy against behavior (the #132 overclaim must NOT be reproduced).

## Notes / dependencies

- **Overlaps PR #131** (open) on `apps/web/lib/sweep/gmail-onboarding.ts`
  (#114 changed Pass-1; this changes `SWEEP_WINDOW_DAYS`). Rebase onto `main`
  after #131 merges; the edits are in different regions but the file conflicts are
  trivial.
- The feature stays **dark** until `SWEEP_HMAC_SECRET` is set (unchanged); this
  spec does not enable the sweep, it gates it.
- Out of scope: a "forget what it learned" deletion path (explicitly deferred —
  the grove-memory editor already lets users clear derived notes); re-running the
  sweep; raising the volume caps (a separate batched/background-learning effort).
