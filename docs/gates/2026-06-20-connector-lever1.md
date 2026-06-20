# Adversarial gate — Connector Lever 1 + write-at-connect (2026-06-20)

- **Branch / PR:** `feature/connector-lever1` → `main` (#217)
- **Reviewed diff:** `git diff origin/main..HEAD` (rebased onto `origin/main`); two review rounds (read/sync/scan surface, then the write surface).
- **Gate run by:** Claude (Opus 4.8), orchestrating the four `.claude/agents/*` reviewers as isolated subagents, on 2026-06-20.

## Scope
Generic `[provider]` OAuth callback core + Google Calendar lit up (read + diagnosis findings + cron-poll `nextSyncToken` liveness) + 12-month scan-window unification + front-end connect-error states + **write opened at connect for Gmail and Calendar** (read+write scopes in one consent; calendar `event-create` wired through the same gated execution path as `email.send`).

## CI step (verified)
- typecheck: ☑ (CI; local shows known `@nibbin/*` stale-dist false-positives from the cross-worktree node_modules symlink — CI fresh install is the authority)  tests: ☑ (1952+ pass locally; only pre-existing `@sparticuz/chromium` failures, untouched by this PR)  lint: ☑ (green)  audit: ☑ (CI pass)  SAST: ☑ (CI pass)  redaction corpus: ☑  trigger-graph: ☑

## Adversarial reviewers (.claude/agents/*)

### Round 1 — read / sync / scan surface
| Reviewer | Verdict | P0 | P1 | P2 | P3 |
|---|---|---|---|---|---|
| red-team | PASS | 0 | 0 | 0 | 3 |
| claims-auditor | PASS-w/-fixes | 0 | 1 | 2 | 1 |
| logic-skeptic | FAIL→fixed | 0 | 1 | 2 | 1 |
| cost-auditor | PASS-w/-fixes | 0 | 0 | 1 | 2 |

### Round 2 — write-at-connect surface
| Reviewer | Verdict | P0 | P1 | P2 | P3 |
|---|---|---|---|---|---|
| red-team | PASS | 0 | 0 | 0 | 2 |
| claims-auditor | FAIL→fixed | 1 | 4 | 4 | 0 |
| logic-skeptic | FAIL→fixed | 0 | 1 | 1 | 0 |

## Findings (severity-ranked) — all blocking findings resolved

### Round 1 (fixed in `6b99fb82`)
- **P1 (logic-skeptic) — calendar sync pagination sent `syncToken` + `pageToken` together.** Google rejects the combination → dup/missing events / 410 on multi-page deltas. The unit mock hid it. Fix: send `syncToken` only on page 1. Status: **resolved** + regression test asserts page 2 sends no syncToken.
- **P1 (claims-auditor) — derived-not-raw was discipline, not structure.** Calendar API returned event `summary` + attendee emails into memory. Fix: `fields` param restricts the API response to `id/status/start/end/attendees(responseStatus)` (scan) and `id/status` (delta) — raw titles/emails never fetched. Status: **resolved** (structural).
- **P2 (logic/red/cost ×3) — `hoursPerWeek` divisor still `/13` (90-day weeks).** The 12-month window made it 4× inflated. Fix: `SCAN_WINDOW_WEEKS` SSOT, `/13`→`/SCAN_WINDOW_WEEKS` in `payments.ts`+`crm.ts`. Status: **resolved** + test.
- **P2 (logic-skeptic) — empty sync token could persist `''` → permanent 410 loop.** Fix: never persist an empty token; skip cursor advance instead. Status: **resolved** + test.
- **P2 (cost-auditor) — calendar SCAN path had no page cap** (only the delta path did). Fix: `MAX_SCAN_PAGES` cap. Status: **resolved** + test.
- P3s (red-team SSRF-comment / write-grant copy; cost-auditor projection notes): non-blocking; addressed or tracked.

### Round 2 (fixed in `5b206e3d`, lint follow-up `829e2e9e`)
- **P0 (claims-auditor) — `SPEC.md` C8 still asserted "read-only at connect / write at adoption."** Authoritative register contradicted shipped code. Status: **resolved** (C8 + onboarding line rewritten to write-at-connect + earned-autonomy execution gate).
- **P1 (claims-auditor) — stale "read-only" copy** in `docs/submissions/google-oauth-verification.md` (external — to Google), `reference/nibbin-demo.html`, `docs/help-compendium.md` (Help Center source), `packages/keeper/src/copy.ts` (Grovekeeper live copy). Status: **resolved** (all swept to the accurate model; remaining grep hits confirmed legitimate — IMAP protocol layer, Meta/Instagram submission, historical plan docs).
- **P1 (logic-skeptic) — overstated approval copy vs earned-autonomy code.** Comments/copy claimed "per-event approval always / never auto-fires," but a Graduate / proven-Senior auto-executes (same as email — the intended model). Resolved by correcting copy to the earned-autonomy framing **and** adding the missing senior+proven-routine test that locks the behavior. Status: **resolved**.
- **P2 (logic-skeptic) — `deriveCapabilityTier` returned `draft_only` (hiding calendar)** when a Nibbin held both `email.draft` + `calendar.event-create` (UI display only; runtime grant check correct). Status: **resolved** + regression test.
- **P2 (claims-auditor) — secondary stale copy** (`help/content.ts`, `privacy/panel.ts` comment, `subprocessors.html`, connector-builder SKILL ×2). Status: **resolved**.
- **P3 (red-team) — `deriveResourceClaim` had no calendar case** (§18.3 multi-agent resource lock skipped; two different runs could create the same event — idempotency only stops same-run double-fire). Status: **resolved** (calendar resource claim keyed on stable event identity).
- **P3 (red-team) — stale `createEvent` scope-check comments** (the connection now holds `calendar.events` from connect; the local check is defense-in-depth, not the primary gate). Status: **resolved** (comments point at the runtime grant gate).

## Key safety verdict (verified, not claimed)
Both red-team and claims-auditor confirmed the **write execution wall is enforced by construction**: a below-Graduate or ungranted Nibbin **cannot** create a calendar event or send email. `dispatchStep` (runner.ts) gates every side-effect step in order — allowlist → `gateSideEffect` (Agent School stage) → write-grant `hasGrant` → idempotency claim — before the effects executor runs; the gate is capability-agnostic so calendar rides the identical wall as `email.send`. No cross-account IDOR, no forged-nibbinId grant minting (grants derive from server-stored pending, not the callback URL), connect ≠ grant, idempotency intact, Planner path refuses write capabilities. Tokens remain vault-only (C9). The calendar write path is wired+gated but **inert** until a calendar Nibbin program + the per-Nibbin grant UI ship (tracked follow-up).

## Disposition
- Blocking (P0/P1) resolved: ☑  Non-blocking tracked: ☑ (calendar program + grant UI; `beginWriteConnectAction` already provider-generic)
- **Gate verdict:** PASS (after fixes)
- **Signed:** pending John's merge approval on 2026-06-20
