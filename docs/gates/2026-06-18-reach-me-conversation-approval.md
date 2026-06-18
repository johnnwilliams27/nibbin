# Adversarial Gate — Reach-Me Conversation + On-Channel Approval (Plan 05)

**Date:** 2026-06-18
**Branch:** `feature/reach-me-channels`
**Surface reviewed:** Plan 05 (§11 cost/abuse controls + the two-way conversation layer + the on-channel approval bridge). Diff range `7810940..eb2ac27` (13 commits); fixes `888c7b6`, `dc0793e`.
**Process:** 4 independent opus reviewers (red-team / claims-auditor / logic-skeptic / cost-auditor), each with a distinct lens, per the project's adversarial-gate convention. This is a privilege-sensitive surface: a verified channel message can approve a real, money-movement-class agent run.

## Result: **PASS (after fixes)**
Two genuine **P1** findings were caught by the gate (and missed by the per-task reviews); both are fixed and re-verified by a focused red-team pass. The P2 code items are fixed; the remaining P2/P3 items are documented design decisions below.

## Reviewer verdicts (initial)
| Reviewer | Verdict | Headline finding |
|---|---|---|
| claims-auditor | PASS | All 6 privacy/safety claims hold in enforcing code; one robustness note (privacy seam was convention, not type-enforced). |
| red-team | FAIL → fixed | **P1:** empty/unset webhook secret fails OPEN → full cross-account approval forge. Configured-secret forge BLOCKED by two layers. |
| logic-skeptic | FAIL → fixed | **P1:** turn-gate RPC arg `p_account_id` ≠ SQL param `p_account` → gate inert (fails closed). |
| cost-auditor | FAIL → fixed | Same **P1** (`p_account`), independently. Metering design sound. |

## P1 findings — fixed
1. **Webhook verifiers failed OPEN on an empty secret** (red-team). `verifyTelegramSecret('', '')` → `timingSafeEqual` over two empty buffers → `true`; an unset `TELEGRAM_WEBHOOK_SECRET` (Telegram has no enable-gate) let an attacker forge an inbound — including a victim's `chat_id` and a `<victim-run>:approve` callback — bypassing the signature gate and approving the victim's run. SMS/WhatsApp were forgeable too (HMAC with empty key), behind their enable flags.
   **Fix (`888c7b6`):** each verifier returns `false` as its first check when the configured secret/key is empty (`if (!expected/!authToken/!appSecret) return false`). Empty-secret forge tests added (RED→GREEN) for all three channels.
2. **Conversation turn gate was inert** (logic-skeptic + cost-auditor). The `channel_turn_take` RPC was called with `p_account_id`, but the SQL parameter is `p_account` → PostgREST couldn't resolve the function → `take()` errored → **failed closed**, denying every channel turn (a dead-feature/DoS bug, not an enforcement bypass — confirmed by re-verify). The per-task unit test had codified the wrong name; the RLS test used positional args, so neither crossed the named-arg boundary.
   **Fix (`888c7b6`):** renamed to `p_account`; corrected the test; rpc name-parity audit of all `svc.rpc` call sites (only this one was wrong; `verify_channel_binding` matches).

## P2 findings — fixed
3. **Approval `runId` reached the decision path unvalidated** (red-team). Fixed (`dc0793e`): the `decide` dep short-circuits to `null` on a non-UUID `runId` (anchored UUID regex) before any DB call.
4. **Privacy seam was convention, not type-enforced** (claims-auditor). Fixed (`dc0793e`): `HandleInboundDeps.answer` dropped its `text` parameter — the quarantined text is closure-bound; passing raw `inbound.text` to the model is now a **compile error**, not a convention.

## Re-verification (red-team, fix delta `eb2ac27..dc0793e`): **PASS**
All four holes confirmed closed, no residual bypass (whitespace-only secret / decode-to-empty header checked), no new hole, no weakened guard. The two-layer ownership defense + SQL self-defense (`decide_run_service`: service-role-only, `for update`, membership re-check, one-per-run, draft-step, edit-distance parity) remain intact. Full suite: 116 tests green; tsc clean.

## Confirmed-sound mechanisms (attacks attempted, blocked)
- Cross-account forge **under a configured secret** — blocked: the relay sets `external_id`, so the binding resolves to the attacker's own account; `decideViaChannel` rejects `run.account_id !== binding.account`, and `decide_run_service` re-checks membership against the run's account.
- Bind attacker chat to a victim account without the victim's nonce — blocked (`request_channel_link` requires `is_account_member` + records `linked_by = auth.uid()`).
- Direct call of `decide_run_service` / `channel_turn_take` / `account_channel_cogs` by anon/authenticated — blocked (revoked; service-role only; RLS suite asserts permission-denied).
- Replay / double-approval / TOCTOU — blocked (`for update`, `awaiting_approval` re-check, `approvals.run_id` unique).
- Edited-decision forgery — blocked (edit-distance parity).
- Prompt injection reaching an action — mitigated (approval branch never calls the model; status/work feed the model only quarantined/redacted text; keeper has no tools).
- Unmetered free path / unbounded spend — bounded (gate before every channel-initiated LLM call; turn-count cap is the atomic hard backstop; fail-closed take).

## Accepted / documented (P2/P3 — not blocking; follow-ups)
- **Spend cap is a rolling-soft monitor; the per-day turn-count cap is the hard backstop.** `account_channel_cogs` sums committed `model_calls` and the gate runs before the turn's own cost lands, so concurrent turns can overshoot the spend cap by ~(in-flight turns × per-turn COGS); total daily spend is still bounded by `turnLimit × max-per-turn-COGS`. If the spend cap must be hard, pre-debit an estimate at gate time and reconcile. **Follow-up.**
- **Window mismatch:** spend uses a rolling-24h window; the turn counter uses the calendar `day_key`. Align both to one window. **Follow-up.**
- **SMS delivery COGS is metered for visibility (`channel_messages.cost_microusd`) but not folded into the spend cap** (cap sums `model_calls` only). Confirm intended.
- **`.maybeSingle()` on `(channel, external_id)`** in `decideViaChannel`/`resolveAccount`: a chat verified to two accounts errors → fails closed (no breach; an availability edge for multi-bound users). Decide single-account-per-chat policy or handle multi-row. **Follow-up.**
- **On-channel SMS approval is currently inert** (`parseTwilioInbound` sets `action` but not `inReplyTo`, and `classifyIntent` needs both). SMS is inert until 10DLC anyway. **Follow-up when SMS goes live.**
- **Anomaly auto-pause is a v1 fixed-threshold** (hourly inbound count); the AS-§18.4 per-account adaptive baseline is a follow-up. Anomaly fails open while `take` fails closed (advisory + hard-stop split).

## Sign-off
Gate **PASS** after the two P1 fixes + two P2 hardenings + red-team re-verification. The documented P2/P3 items are non-blocking follow-ups (recorded here and in the plan ledger). Awaiting human gate sign-off per `docs/AGREEMENTS.md`.
