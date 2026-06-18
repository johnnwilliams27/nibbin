# Adversarial gate — connections remediation (2026-06-17)

- **Branch / PR:** `fix/connections-gate-remediation` → `main` (#110)
- **Reviewed diff:** the connections surface (Spec 1-4 + #106/#107/#108 + the gmail-watch bootstrap fix)
- **Gate run by:** Claude (multi-agent adversarial gate workflow) on 2026-06-17

## CI step
- typecheck: ☑  tests (893): ☑  lint: ☑  audit: ☑  SAST: ☑  redaction corpus: ☑  trigger-graph: ☑

## Adversarial reviewers (.claude/agents/*)
| Reviewer | Verdict | P0 | P1 | P2 | P3 |
|---|---|---|---|---|---|
| red-team | reviewed | 0 | 2 | 0 | 3 |
| claims-auditor | reviewed | 0 | 0 | 3 | 4 |
| logic-skeptic | reviewed | 0 | 0 | 5 | 2 |
| cost-auditor | reviewed | 0 | 1 | 0 | 2 |

**Totals: 0 P0 · 3 P1 · 8 P2 · 11 P3 — 22 confirmed (each independently verified by a skeptic).**

## Findings (severity-ranked)

All findings are RESOLVED in this PR (#110). id · severity · file:line · impact → fix.

- **P1.1 [security]** `apps/web/app/app/connections/actions.ts:105-109` — revokeConnectionAction is an exported server action that revokes ANY connection by id with no account-ownership check
  - Fix: Either delete revokeConnectionAction (disconnectAction already covers the UI), or scope it to the caller's account exactly like disconnectAction: before calling revokeAndSuspend, SELECT the connection by id AND account_id (from appSession) and 404/no-op if it does not belong to the caller. **Status: FIXED.**
- **P1.2 [security]** `apps/web/lib/connections/push-verify.ts:8-10` — Pub/Sub OIDC push verification fails OPEN on service-account identity when PUBSUB_SA_EMAIL is unset
  - Fix: Make the SA email fail-closed, matching the existing fail-closed treatment of expectedAudience: in push-verify.ts (or the push route) reject the request when PUBSUB_SA_EMAIL is unset/blank — `const email = process.env.PUBSUB_SA_EMAIL; if (!email?.trim()) return 401;` — and pass it as a required string. **Status: FIXED.**
- **P1.3 [cost]** `apps/web/app/api/sweep/gmail/onboarding/route.ts:9-33` — Onboarding sweep endpoint has no idempotency/budget gate and a replayable static HMAC — unbounded model spend
  - Fix: Make the sweep idempotent + budgeted: (1) Before running, check gmail_sweep_log for an existing complete/partial row for (account_id, connection_id) within a recent window and short-circuit (return 200 'already_swept') — this also closes the replay amplification. **Status: FIXED.**
- **P2.1 [privacy]** `apps/web/lib/sweep/gmail-onboarding.ts:111-160 (sweep loop), 119/150 (getMessageBody), reference/data-ai.html:53` — Onboarding sweep bulk-reads the inbox, contradicting the published "the model sees only the thread being answered, not your inbox" Limited-Use claim
  - Fix: Reconcile claim and behavior: either (a) update data-ai.html / privacy.html to explicitly disclose the one-time onboarding inbox+sent sweep, what it reads, how many messages, that derived snippets (incl. **Status: FIXED.**
- **P2.2 [privacy]** `apps/web/app/app/connections/page.tsx:(whole file — no sweep copy); apps/web/app/api/sweep/gmail/onboarding/route.ts:20-33` — No in-app disclosure or consent for the onboarding sweep before it bulk-reads Gmail and sends bodies to the LLM
  - Fix: Add a plain-language disclosure + explicit opt-in checkpoint in the connect/onboarding flow before the sweep runs (e.g. **Status: FIXED.**
- **P2.3 [privacy]** `supabase/migrations/20260612120000_m65_budget_cogs.sql:155; docs/INVARIANTS.md:15; SPEC.md:62` — C11 invariant says training is opt-OUT (on by default); the implementation is opt-IN (off by default) — the stated invariant is not upheld
  - Fix: Decide the real product stance and make code + INVARIANTS + SPEC + privacy.html + nibbin-demo.html agree. **Status: FIXED.**
- **P2.4 [correctness]** `apps/web/lib/connections/dispatch.ts:54-68` — Fan-out cap consumes recordOnce for deferred Nibbins → they are never triggered (breaks documented convergence)
  - Fix: Only consume recordOnce for Nibbins that will actually be triggered. **Status: FIXED.**
- **P2.5 [correctness]** `apps/web/lib/connections/dispatch.ts:55-68` — recordOnce consumed before triggerRun → a triggerRun failure permanently drops the trigger
  - Fix: Record-once should be claimed and only 'committed' after a successful triggerRun, or use triggerRun's own idempotency (it already dedupes on dedupeKey per the test RunOutcome 'deduped'). **Status: FIXED.**
- **P2.6 [correctness]** `apps/web/lib/connections/gmail-delta.ts:24-29` — Expired Gmail historyId (404) permanently wedges the connection — no re-sync path
  - Fix: In the historyList dep wrapper (or fetchGmailDelta), catch a 404/'provider' status from history.list, call getProfile() to obtain the current historyId, advance the cursor to it (skipping the unrecoverable gap), and return zero events for that cycle so the connection resumes tracking from now.. **Status: FIXED.**
- **P2.7 [correctness]** `apps/web/app/api/cron/gmail-watch-renew/route.ts:55-64` — Gmail push delivery is inert — webhook_state.email is never seeded so connection lookup never matches
  - Fix: In the watch-renew loop (and/or on connect), call client.getProfile() once and merge `{ email: profile.emailAddress }` into webhook_state alongside historyId/watchExpiry, so the push handler's lookup can resolve the connection.. **Status: FIXED.**
- **P2.8 [correctness]** `apps/web/app/api/sweep/gmail/onboarding/route.ts:32-33` — Onboarding sweep has no idempotency guard — re-runs on callback retry / reconnect
  - Fix: Before running, check gmail_sweep_log for an existing complete/partial row for the connection and short-circuit if present; or add a unique partial index and treat the conflict as 'already swept'.. **Status: FIXED.**
- **P3.1 [security]** `apps/web/app/app/connections/actions.ts:57-85` — Write-scope grant attaches to an attacker-supplied nibbinId with no ownership validation (cross-account grant-table pollution)
  - Fix: Before granting, verify the nibbin belongs to the caller's account: `const { data: n } = await svc.from('nibbins').select('id').eq('id', nibbinId).eq('account_id', accountId).maybeSingle(); if (!n) throw new Error('not found');`. **Status: FIXED.**
- **P3.2 [security]** `apps/web/app/api/connect/google/callback/route.ts:55-62` — OAuth state is checked against itself in exchangeCode — the timing-safe state comparison is a tautology on the callback path
  - Fix: Thread the genuinely-returned state into the exchange so the guard is meaningful: pass returnedState: <the state query param from the callback request> (the value already used to look up the pending row) while keeping expectedState: pending.state. **Status: FIXED.**
- **P3.3 [security]** `packages/connectors/src/oauth/flow.ts:121-142` — OAuth nonce is generated and sent but never verified (no openid scope / id_token), leaving dead anti-replay scaffolding
  - Fix: Either remove the nonce from the authorization URL and pending row (since no id_token is consumed), or — if id_token validation is intended — add the `openid` scope, parse the id_token at exchange, and verify id_token.nonce equals the stored nonce with a timing-safe comparison. **Status: FIXED.**
- **P3.4 [cost]** `apps/web/app/api/cron/connector-poll/route.ts:71-96` — connector-poll re-fires full delta work every 5 min while any event is capped (cursor not advanced) — repeated fan-out + DB amplification per cycle
  - Fix: Advance the cursor up to the last fully-drained event and persist a per-connection 'deferred Nibbin' pointer, instead of replaying the entire delta. **Status: FIXED.**
- **P3.5 [cost]** `apps/web/app/api/cron/connector-poll/route.ts:32-101` — connector-poll processes every active Gmail connection in one 60s function with no per-cycle connection or event cap
  - Fix: Add a deterministic ordering (e.g. **Status: FIXED.**
- **P3.6 [privacy]** `supabase/migrations/20260612120000_m65_budget_cogs.sql:152-179; reference/privacy.html:79` — C11 "honored everywhere" cannot be verified — training_opt_in is read nowhere and there is no Settings → Privacy switch
  - Fix: Either build the Settings → Privacy toggle that calls set_training_opt_in and wire training_opt_in into any pipeline that would contribute content to training (fail-closed when off), or remove the "in Settings → Privacy" promise from privacy.html until the switch ships. **Status: FIXED.**
- **P3.7 [privacy]** `apps/web/lib/connections/tester-allowlist.ts:19-23; packages/connectors/src/oauth/flow.ts:104-110` — Tester-allowlist cap counts allowlisted emails, not users who actually connected — weakens the Google 100-unverified-user cap
  - Fix: Count distinct users who have actually completed an OAuth consent for the provider (e.g. **Status: FIXED.**
- **P3.8 [privacy]** `apps/web/lib/sweep/gmail-onboarding.ts:150-151; packages/connectors/src/connectors/gmail.ts:142-145` — Inbox-thread pass fetches full message bodies (format=full) only to keep a 200-char first line — over-reads content versus what it stores
  - Fix: For Pass 2 use the Gmail `snippet` field (returned by messages.get with format=metadata or the list response) instead of fetching the full body, so only the short preview that is actually kept is ever read.. **Status: FIXED.**
- **P3.9 [privacy]** `apps/web/lib/sweep/gmail-onboarding.ts:17-25 (queries); apps/web/lib/sweep/derive.ts:103-112` — Sweep applies no sensitive-category filter before sending email bodies (banking/health/legal) to the LLM processor
  - Fix: Add a category/keyword pre-filter (or rely on Gmail category negations for finance/health where available) to skip obviously sensitive threads before body fetch, and add an output guard so voiceSamples that look like account numbers / health terms are dropped. **Status: FIXED.**
- **P3.10 [correctness]** `apps/web/app/api/connect/google/callback/route.ts:86-90` — Write-scope upgrade overwrites the vault token unconditionally — wipes refresh token if the provider omits it
  - Fix: Before overwriting on the upgrade path, if the new token has no refreshToken, read the existing vaulted token and carry its refreshToken forward into the stored payload (or have connection_token_store preserve a non-null prior refresh token when the new payload omits it).. **Status: FIXED.**
- **P3.11 [correctness]** `apps/web/app/api/cron/gmail-watch-renew/route.ts:57-65` — watch-renew re-registers the watch every cron run when watch() returns no expiration
  - Fix: When watch() succeeds but returns no expiration, set a conservative default watchExpiry (Gmail watches last ~7 days) so the connection is not re-registered every run, or record a 'lastWatchedAt' and throttle on that.. **Status: FIXED.**

## Disposition
- Blocking (P0/P1) resolved: ☑  Non-blocking tracked: ☑ (all fixed in-PR)
- **Gate verdict:** PASS (0 P0; all 3 P1 + all P2/P3 resolved in #110; full report with evidence + verifier rationale archived with the run)
- **Signed:** _pending John_
