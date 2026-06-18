# Adversarial gate — Drift nudge (R2) + dignified demotion (CE5) (2026-06-18)

- **Branch / PR:** `feat/drift-demotion` → `main`
- **Reviewed diff:** `git diff main..feat/drift-demotion` at `2d7ea0a` (post-hardening).
- **Gate run by:** Claude (3 adversarial reviewers — red-team, logic-skeptic, cost-auditor — in parallel) on 2026-06-18.
- **Scope:** sensitive surface is the migration `20260618010000_drift_demotion_notifications.sql` (notifications.kind += nudge/demotion + a `service_role`-only `insert_system_notification` RPC). The drift detection, demote action, and surfaces are gate-free (`apps/web/lib/runtime`, `apps/web/app/app/*`, `components/shell`). Spec: `docs/superpowers/specs/2026-06-18-promotion-rubric-design.md` (R2) + ceremony §7/CE5.

## CI step
- typecheck (apps/web): ✅ exit 0
- tests: ✅ `vitest run apps/web/ tests/rls/` → 371 passed, 1 (pre-existing) skipped; new `tests/rls/system-notification.test.ts` 3/3 (authenticated/anon rejected; service_role nudge ok; `kind='graduation'` raises). Full rls suite 131 passed.
- lint / audit / SAST / redaction corpus / trigger-graph: ☑ (CI)
- **SQL applied + verified on dev / staging / prod** (kind CHECK includes nudge+demotion; `insert_system_notification` present).

## Adversarial reviewers (.claude/agents/*)
| Reviewer | Verdict | P0 | P1 | P2 | P3 |
|---|---|---|---|---|---|
| red-team | PASS | 0 | 0 | 0 | 2 |
| logic-skeptic | PASS | 0 | 0 | 0 | 2 |
| cost-auditor | PASS | 0 | 0 | 0 | 2 |

**Verified by the panel:**
- **RPC safe:** `security definer` + `search_path=''`; `revoke … from public/anon/authenticated` + `grant … to service_role` (clients cannot author leaves); `p_kind` guard rejects anything but nudge/demotion (no spoofed graduation/beat); parameterized insert (no injection); `ctaPath` is a hardcoded `/app/nibbins` constant (no open-redirect/`javascript:`); table CHECKs (title ≤200/body ≤2000/payload size) still apply.
- **Demote IDOR blocked:** `nibbin_demote` (member-checked via `auth.uid()`/`is_account_member`) raises for a non-member BEFORE any leaf write; the leaf-read is reachable only after ownership is proven and writes the caller's own `accountId`.
- **Nudge-only / no auto-demote:** drift only inserts an advisory leaf; demotion is the explicit `BackToDrafts` user action. **Silence never trips it** (`rows.length < 10` returns). Best-effort `try/catch` — never disrupts the decision path. Daily dedupe (`drift:<nibbin>:<UTC-day>` + unique constraint + ON CONFLICT). Not cross-account triggerable (nibbinId from the already-validated decided run).
- **Calm-invariant:** no coral; the in-grove ack suppresses leaf-burst/delighted for a demotion-only batch (`anyCelebratory = show.some(c => c.kind !== 'demotion')`); demotion bubble uses neutral `--understory`/`--line`/`--ink-soft`.
- **Cost bounded:** non-senior/grad decisions (the majority) pay ONE PK read then early-return; senior/grad adds a 10-row index-backed query (mirrors the shipped `maybePromote`); insert at most once/nibbin/day.
- **Paused ≠ penalized:** drift is over the last 10 *decided* runs — an idle/paused Nibbin has none recent, so no nudge.

## Findings (all P3; the 4 actioned ones fixed in `2d7ea0a`)
| # | Sev | Reviewer | Disposition |
|---|---|---|---|
| account-scoped leaf reads | P3 | red-team | **FIXED** — `.eq('account_id', accountId)` added to the `nibbins` reads in `demoteNibbinAction` + `maybeDriftNudge` (defense-in-depth). |
| RLS test for the new RPC | P3 | red-team | **FIXED** — `tests/rls/system-notification.test.ts` (3 cases) added; runs on the CI postgres:17 service container, verified locally. |
| `.draftBtn` raw `#fff` | P3 | logic-skeptic | **FIXED** — replaced with `var(--canopy)`. |
| migration `drop constraint` not idempotent | P3 | logic-skeptic | **FIXED** — `drop constraint if exists`. |
| redundant `nibbins` PK read per senior/grad decision | P3 | cost-auditor | **TRACKED** — optional; thread stage out of `maybePromote` later. Low value (one PK read). |
| `order by approvals.decided_at` not directly index-covered | P3 | cost-auditor | **TRACKED** — join-driven from `runs_nibbin_idx` over a bounded ≤10 set; matches the shipped `maybePromote` query. No action. |

## Disposition
- Blocking (P0/P1): **none.** Actionable P3s: **fixed.** Remaining P3s: tracked (cost optimizations, low value).
- **Gate verdict: PASS.**
- **Signed:** Claude on 2026-06-18 (on behalf of John).
