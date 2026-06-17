# Adversarial gate — <feature/branch> (<date>)

> Copy to `docs/gates/<YYYY-MM-DD>-<slug>.md`. Required for any PR touching a
> security-sensitive surface (see docs/AGREEMENTS.md). Rebase onto the merge
> target BEFORE reviewing, so the diff is your work only.

- **Branch / PR:** `<branch>` → `<base>` (#<PR>)
- **Reviewed diff:** `git diff <base>..<head>` at `<head-sha>`
- **Gate run by:** <who> on <date>

## CI step
- typecheck: ☐  tests (count): ☐  lint: ☐  audit: ☐  SAST: ☐  redaction corpus: ☐  trigger-graph: ☐

## Adversarial reviewers (.claude/agents/*)
| Reviewer | Verdict | P0 | P1 | P2 | P3 |
|---|---|---|---|---|---|
| red-team | | | | | |
| claims-auditor | | | | | |
| logic-skeptic | | | | | |
| cost-auditor (≥M2) | | | | | |

## Findings (severity-ranked)
<!-- P0/P1 block merge. Each: id, severity, file:line, impact, fix, status. -->

## Disposition
- Blocking (P0/P1) resolved: ☐  Non-blocking tracked: ☐
- **Gate verdict:** PASS / FAIL
- **Signed:** <John> on <date>
