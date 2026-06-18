# Adversarial gate — connections P3 follow-ups #112/#113/#114 (2026-06-18)

- **Branch / PR:** `fix/connections-p3-followups` → `main`
- **Reviewed diff:** `git diff origin/main..7568a44` (the 3 fixes), then gate findings addressed in a follow-up commit on the same branch and re-verified.
- **Gate run by:** Claude (multi-agent gate: the 4 `.claude/agents/*` reviewer personas over the diff, each finding adversarially verified by an independent skeptic) on 2026-06-18.

## CI step
- typecheck (connectors + web): ☑  tests (950: 947 pass / 3 skip): ☑  lint: ☑  audit: ☐ (CI)  SAST: ☐ (CI)  redaction corpus: ☐ (CI)  trigger-graph: ☐ (CI)

## Adversarial reviewers (.claude/agents/*)
| Reviewer | Verdict | P0 | P1 | P2 | P3 |
|---|---|---|---|---|---|
| red-team | reviewed | 0 | 0 | 0 | 5 (RT-1,3,4,5,6); RT-2 refuted |
| claims-auditor | reviewed | 0 | 0 | 0 | 1 (faqCandidates); copy-overclaim refuted (out-of-scope) |
| logic-skeptic | reviewed | 0 | 0 | 1 (L1) | 2 (L3,L4); L2/L5 refuted |
| cost-auditor (≥M2) | reviewed | 0 | 0 | 2 (finalize, route-test) | 1 (read-cost) |

**Result: 12 confirmed (0 P0, 0 P1, 3 P2, 9 P3); 4 refuted.** No blocker. Of the 12, **7 fixed in this PR**, 2 P2 **mitigated**, 4 **tracked** (P2/P3 do not block per docs/AGREEMENTS.md).

## Findings (severity-ranked)

### P2
- **CA-1 [cost] success-path finalize error was unchecked → silent re-spend path — FIXED.** `apps/web/app/api/sweep/gmail/onboarding/route.ts`. The finalize UPDATE dropped its error; a transient failure left the row `running`, and the 15-min stale-reclaim would re-run the whole sweep (re-spend). Now captures the error, **retries once**, and logs if it still fails (symmetric with the failure path). Covered by the new route test.
- **CA-3 [cost] zero unit coverage on the claim→sweep→finalize orchestration — FIXED.** Added `apps/web/app/api/sweep/gmail/onboarding/route.test.ts` (6 cases): null-claim skip spends no budget, claim-RPC error → 500, success finalizes by id, finalize-failure retries (CA-1), sweep-throw → `failed`, bad HMAC → 401.
- **L1 [logic] sweep is serialized but not idempotent across a finalize-fail → stale-reclaim re-run — MITIGATED; residual TRACKED.** The CA-1 fix (check + retry finalize) removes the common transient-failure trigger. Residual: a hard process-kill between the `grove_memory` write and the finalize leaves a `running` row that the 15-min reclaim re-runs (budget re-spend; `voice`/`faq` are write-once so they don't compound, but the `facts` append dedup is exact-substring). Bounded, and dark today (`SWEEP_HMAC_SECRET` unset). Tracked as a follow-up: gate the derived-memory write on a sweep-provenance marker so a reclaim no-ops when already populated.

### P3
- **RT-5 hasRecord was fail-loud → a transient read error parked the cursor — FIXED.** `connector-poll/route.ts` now wraps `alreadyDispatched` to **fail open** (catch → `false`), so a blip falls through to `triggerRun` + the authoritative `recordOnce` instead of aborting the connection.
- **RT-3 sent-mail sensitive gate only screened `To` — FIXED.** Now screens `['to','cc']` (the reply-all case where an institution is Cc'd); added `Cc` to `getMessageMetadata`'s fetched headers (`packages/connectors/src/connectors/gmail.ts`) + a test. `Bcc` deferred (tracked).
- **RT-6 migration dropped the CHECK without `IF EXISTS` — FIXED.** `…drop constraint if exists gmail_sweep_log_status_check` for replay safety on fresh bootstraps. (Already applied to dev/staging/prod; this is file hygiene.)
- **CA-2 [claims] `faqCandidates` skipped the `isSensitiveSample` output guard — FIXED.** `derive.ts` `parsePass2` now filters `faqCandidates` like `voiceSamples`/`inferredFacts`, closing the asymmetry the #114 comment promises. Test added.
- **L4 hasRecord was connection-scoped while recordOnce is provider+event-scoped — FIXED.** `hasRecord` now keys on `(provider, provider_event_id)` only — exactly the `webhook_events` unique constraint the claim is enforced by — removing the latent divergence if a future `dedupeKey` stopped embedding the connection.
- **RT-1 `claim_gmail_sweep` writes the caller's account/connection with no DB-level ownership check — TRACKED.** Defense-in-depth: ownership is enforced by the HMAC + a downstream `.eq('account_id')` check in `gmailOnboardingSweep`, and the poison case is self-healing (mismatch → `failed`, clears the index). Verified self-mitigating + dark. Follow-up: add a correlated `EXISTS(connections WHERE id=… AND account_id=… AND status='active')` to the RPC (needs a `create or replace` migration).
- **L3 stale-reclaim has no attempt counter; resets `messages_read=0` — TRACKED.** Only affects a genuinely orphaned `running` row (hard kill); the 45s budget makes large mailboxes exit gracefully as `partial` (never reclaimed). Follow-up: add a reclaim counter + give up after N.
- **CA-2 [cost] `alreadyDispatched` reads run for every eligible Nibbin before the ceiling check — TRACKED.** O(eligible Nibbins × events) reads/cycle, not bounded by the ceiling. Trivial at current scale (1–2 Nibbins); a real lever once counts grow. Deliberately not re-touching the just-stabilized dispatch ordering now.
- **RT-4 crash window between the derived-memory write and finalize — MITIGATED (= L1 residual).** Write-once guards prevent voice/faq compounding; the CA-1 fix covers transient finalize failures. Residual hard-kill case folds into L1.

### Refuted (verified real=false)
- **RT-2** stale-reclaim attacker re-spend — a completed sweep moves to `complete`/`partial` (outside the reclaim predicate), so only a genuinely-orphaned `running` row reclaims; the static HMAC is pre-existing, not in this diff.
- **CA-1 [claims] privacy-copy overclaim** — REAL but **out-of-scope**: `reference/data-ai.html:55` / `privacy.html:71` say the sweep "sends the model only short derived notes … not the raw messages," but Pass-1 sends raw *sent* bodies to the LLM. Both the copy and the body-fetch predate this PR; this PR only *reduces* what reaches the model. **Flagged as a standalone privacy-copy backlog item** (file an issue against the privacy pages; not attributable to this branch).
- **L2** test for the L1 non-idempotency — premised on pre-existing append code; the in-scope change is covered.
- **L5** "over-stated guarantee" on `alreadyDispatched` — the comments already scope it to the sequential re-poll case and state recordOnce is the authority.

## Disposition
- Blocking (P0/P1) resolved: ☑ (none found)
- Non-blocking: 7 fixed in-PR, 2 P2 mitigated, 4 tracked (RT-1, L1-residual, L3, CA-2/cost) + 1 standalone backlog item (privacy-copy overclaim).
- **Gate verdict:** PASS (0 P0; 0 P1)
- **Signed:** _pending John_
