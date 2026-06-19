# Adversarial Gate — Help & Getting-Started Center

**PR:** Help & Getting-Started center (`feature/help-getting-started`)
**Date:** 2026-06-19
**Surface sensitivity:** privacy-claim copy + connection surfaces → full 4-reviewer gate required.
**Branch base:** rebased onto `origin/main` (post #165/#169).

## Scope reviewed
`apps/web/app/app/help/page.tsx`, `apps/web/components/help/*` (HelpHub, HelpSearch, HelpAccordion, GettingStartedChecklist, ConnectorDirectory, ConnectorLogo, help.module.css), `apps/web/lib/help/*` (content, types, checklist), `apps/web/lib/connections/catalog.ts` + `catalog-view.ts`, `apps/web/components/shell/AppShell.tsx` + `HelpButton.tsx`, `apps/web/app/app/connections/page.tsx`. Content authored from `docs/help-compendium.md`.

## Reviewers & verdicts

| Reviewer | Initial | After fixes |
|---|---|---|
| Claims-auditor | **FAIL** (4 P1, 4 P2, 3 P3) | **PASS** |
| Red-team | PASS (0 P1/P2, 2 P3) | — |
| Logic-skeptic | PASS-WITH-FIXES (1 P1, 1 P2, 3 P3) | P2/P3 fixed; P1 = pre-existing (see below) |
| Cost-auditor | PASS-WITH-FIXES (0 P1, 2 P2, 3 P3) | P2 fixed (1 deferred), P3 fixed |

## P1 findings — all resolved (fix commit `0aab62f9`)

- **Claims P1-1/P1-2 — connector status over-claim.** `catalog.ts` marked ~21 connectors (Calendar, Stripe, HoneyBook, Notion, QuickBooks, Outlook, Pixieset, Instagram, Drive, Sheets, Slack, generic rails…) as `early_access` ("Early access" badge), contradicting the prose + compendium (only Gmail connectable; rest "coming soon"). **Fix:** every non-Gmail entry → `coming_soon`; only `gmail` remains `live`. Catalog test asserts gmail is the sole `live` entry. The user-facing "early access / request access" framing is preserved as copy on Gmail (the tester-allowlist-gated connector).
- **Claims P1-3 — `conn-directory` copy** described the directory inaccurately. **Fix:** reworded to match the data + actual placement (inside the connections section).
- **Claims P1-4 — deletion-receipt over-claim.** Help claimed a server "deletion receipt" for the purely local "Delete instead"/raw-wipe path (which uploads nothing) — an action that contacts no server, and the receipt email is ⚠️-uncertain in the compendium. **Fix:** receipt sentence removed from local-delete paths; account-deletion language softened to "verified and recorded."
- **Logic P1 — pre-existing tsc errors (NOT this PR).** `npm run typecheck` reports ~39 errors in unrelated `channels`/`planner`/`telegram`/`sms` files (e.g. `@nibbin/channels` missing exports `SMS_START_REPLY`, `setTelegramWebhook`). These exist on `origin/main`, are untouched by this PR, and `next build` is unaffected (`typescript.ignoreBuildErrors: true`). **Out of scope** — surfaced to the owner; not fixed here. Our files contribute **0** tsc errors (verified).

## P2 findings — resolved (1 deferred)
- Claims: hard-rules wording softened (no "model-level guarantee"); anti-rollback "by changing the system date" dropped; channel-initiated work now carries a gating caveat.
- Cost: `ConnectorDirectory` `connectors` prop made required + module-level `CONNECTORS` import removed (51KB catalog no longer ships in the client bundle; `/app/connections` passes it server-side).
- Logic: `HelpButton` got `"use client"`.
- **Deferred:** collapsing directory categories by default to bound logo requests (logos are `loading="lazy"`; acceptable for now).

## P3 findings — resolved (2 noted)
- `#fff` → `var(--canopy)` (verified `--canopy` = `#FFFFFF`); third-party (Clearbit) logo-load privacy note added; `filterHelp` + group/sort wrapped in `useMemo`; `checklist.ts` `Promise.all` wrapped in try/catch (fail-safe); "request early access" → "request access".
- **Noted (not code):** Clearbit reveals client IP for logo loads (consider a server proxy later); add a DB composite index on `connections(account_id, status)`.

## Binding truths — verified intact
Model-training two-part framing + "Model improvement" toggle ON-by-default (opt-out); "off by default" only on the Gmail voice-sweep; pause "stops capture near-instantly" (no "<100ms"); secure fields "by construction, never by reading the picture"; only Gmail live among connectors; Lite default / Detailed + macOS capture = coming soon; agents (6 ready-mades, Egg→Student→Senior→Graduate, 95%/25-run gate).

## Tests
All help/connectors suites green: **19 files / 99 tests**. 0 tsc errors in PR files.

## Final verdict
**PASS** (after fixes). The only open item is the pre-existing, out-of-scope `npm run typecheck` failure in channels/planner — surfaced to the owner; it will gate CI for any PR until fixed on main, but is not introduced by this change.
