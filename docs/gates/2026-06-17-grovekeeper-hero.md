# Adversarial gate — grovekeeper-hero (2026-06-17)

- **Branch / PR:** `feature/grovekeeper-hero` → `main` (PR pending)
- **Reviewed diff:** `git diff origin/main..HEAD` after rebasing onto `origin/main`
  (the pre-rebase review was discarded — it was 12 commits stale and conflated
  main's Connections work with this branch's).
- **Gate run by:** Claude (4 `.claude/agents` reviewers) on 2026-06-17
- **Scope of branch:** creature SVG engine restyle (`@nibbin/creatures`), email
  header PNG rasterization (`@nibbin/email` + `tools/raster-email-creatures.mts`),
  nibbin configurator (RPC + UI), Shellback→Capling rename, Grovekeeper hero,
  brand/logo rollout.

## CI step
- typecheck (16 projects): PASS · tests: PASS (862 passed / 3 skipped — DB-gated integration) ·
  lint: PASS · audit: PASS (no high vulns) · SAST/redaction/trigger-graph: covered by `ci.yml`.

## Adversarial reviewers
| Reviewer | Verdict | P0 | P1 | P2 | P3 |
|---|---|---|---|---|---|
| red-team | findings, all resolved | 0 | 1 | 2 | 2 |
| claims-auditor | net-conservative; no overpromise | 0 | 0 | 0 | 2 (copy coherence) |
| logic-skeptic | findings, P1 resolved | 0 | 1 | 1 | 1 |
| cost-auditor | no COGS/routing surface | 0 | 0 | 0 | 0 |

## Findings & disposition
- **P1 (red-team) — configurator RPC: unscoped cross-account write via `service_role`
  grant + auth-after-lock ordering.** FIXED in `20260617160000_nibbin_configurator.sql`
  / `20260617170000_shellback_to_capling.sql`: authenticate first, membership checked
  unconditionally, `service_role` grant dropped (no in-tree caller used it).
- **P1 (logic-skeptic) — ABBA deadlock vs `run_begin` (row lock taken before the
  per-account advisory lock).** FIXED: advisory lock now precedes any row lock;
  the initial resolve is lock-free.
- **P2 — audit-log actor mislabeled (`'user'`/`'runtime'`) on the system path.** FIXED:
  uid is now guaranteed non-null, so the actor is always the real user.
- **P2 — lock-before-auth.** FIXED by the auth-first reorder above.
- **P2 (logic-skeptic) — an un-migrated `'Shellback'` row makes `buildCreature` throw on
  the roster render (deploy-ordering coupling).** ACCEPTED: the throw is the intended
  fail-loud invariant (engine test asserts it); the rename migration converts all rows
  and the CHECK blocks new ones. Mitigation = migrate-before-code deploy order.
- **P3 — `kind <> 'specialist'` editability gate.** Confirmed SAFE (only specialists
  editable; keeper + future kinds blocked); comment clarified.
- **P3 — `slug` interpolated unescaped into email `<img src>`.** FIXED: `esc(slug)` in
  `creature-image.ts` (was not reachable today; defence-in-depth).
- **P3 — latent email 404 if a user-customized creature is passed to transactional mail.**
  ACCEPTED/tracked: no caller does this today; `creature-assets.test.ts` covers the
  static set.
- **P3 (claims) — invite/welcome/settings copy references the Connections flow.** Pre-existing
  on main, not introduced here; flagged for merge-sequencing.
- **Held (verified):** SVG injection chokepoint (`safeColor`/`shade`-throws/safe enum
  defaults), C10 Grovekeeper immutability, determinism/seed, raster coverage, secrets/SSRF,
  COGS.

## Migrations
- Renumbered above main's latest (`…150000`): configurator `…160000`, capling `…170000`
  (order preserved; capling depends on the configurator RPC). Both made idempotent
  (`create or replace`, `drop constraint if exists`) for safe re-apply.
- **Deploy note:** the pre-renumber `…120000`/`…130000` versions were already applied to
  dev+prod; before deploying, inspect/reconcile the live `supabase_migrations` tracker for
  the orphaned rows (the changes are already live; the renumbered files re-apply safely).

## Disposition
- Blocking (P0/P1) resolved: ☑  Non-blocking tracked: ☑
- **Gate verdict:** PASS (pending re-confirmation of the RPC fixes + John's sign-off)
- **Signed:** ____________ (John) on __________
