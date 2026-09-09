# Trust Index handoff: first review

Historical first-pass record. The subsequent pre-merge review, additional fixes,
CI wiring and validation are in [the detail-evidence review](gates/2026-09-09-detail-evidence.md).

Reviewed against main `f46af9b2`, pending handoff branch `99343154`, and the
committed marketplace snapshot dated `2026-09-09T05:37:50Z`. These are local
artifact findings, not a new live population measurement.

## Working state

The Windows checkout at `C:/Nibbin` was on the archived product's
`feature/footer-social` branch with 959 deleted files. It was preserved.
Current work is isolated at `C:/Nibbin/.worktrees/trust-index-handoff`, branch
`codex/trust-index-handoff`. The five pending commits from
`fix/detail-fetch-retry-cap` were fast-forwarded into this local branch.
No merge to main or deployment has occurred. No PR existed for the pending
branch when checked.

The Linux detail cache and detached refetch job described in the handoff are
not present in this worktree. The committed snapshot has 1,474 rows labelled
unread. This review cannot establish whether the remote job subsequently
closed that gap. Do not regenerate the production dataset from this empty cache.

## Initial independent findings

| Artifact measurement | Result |
|---|---:|
| Indexed registrations | 10,041 |
| Listed registrations | 230 |
| Distinct listed owners | 142 |
| Distinct listed description strings | 134 |
| Distinct nonempty listed endpoints | 40 |
| Listed rows with unknown interface declaration | 11 |
| Rows with assessments | 3,204 |
| Distinct assessed endpoints | 111 |
| Published composites | 0 |
| Endpoint results containing MCP transcripts | 65 |
| Endpoint results containing A2A transcripts | 84 |

The two transcript counts overlap. The handoff's claim of zero MCP probes
is incorrect for the committed probe file. A transcript is an attempt, not
proof of a successful handshake.

`fetch_candidates.py` explicitly caps its A2A stream at 3,000 and each keyword
search at 500 rows. This is a selective candidate frame, not an independent
or complete census. Coverage of BSC DeFi agents cannot be inferred from it.

All 3,204 assessments are thin. `merge-marketplace-assessments.mts` hardcodes
thin coverage and null composites, without running a behavioural battery.
That explains why this pipeline cannot publish scores; it does not establish
whether the battery itself is correctly calibrated. Known-good controls are
still needed before changing any thresholds.

4,883 registrations declare `https://q402.quackai.ai/api/mcp/info`.
Across the snapshot, 2,716 assessments mention HTTP 405. These are different
counts and must not be substituted for one another. Descriptor interpretation
and behavioural probing remain separate work.

## Corrections made during review

The pending detail fix had an important publication-order defect: it replaced
`agents.json` before rejecting unexplained missing details. The builder now
validates first and leaves the prior snapshot intact on rejection.

Its failure-record check also accepted any failure as evidence of rate limiting.
A 404 or timeout could therefore become `unread_rate_limited`. It now requires
an explicit rate-limit status or the fetcher's recorded HTTP 429 error.
Other failures stop publication until their cause is represented correctly.

Presentation now uses `unread_unknown` for absent or invalid detail statuses.
The homepage, assessment and hire panel preserve that uncertainty without
inventing a quota failure. The frozen contract records this additive state.
Shared predicates only count an absent declaration when detail is explicitly
`read`. The summary generator also reports unrecognised statuses separately.

## Verification and remaining work

- Clean marketplace `npm ci` from its committed lockfile.
- Five offline Python regressions, including reproduction of the pre-fix
  publication defect and false throttle classification.
- Four frontend detail-state regressions, including a partition check over
  every committed row.
- Marketplace TypeScript check and Next static export: 240 pages generated.
- Marketplace source and regression tests pass the repository's ESLint config,
  installed from the frozen ops lockfile with pnpm 10.33.0.
- Exported HTML checked on all 11 affected agent pages: unknown hiring state
  present, false "cannot be hired" claim absent. Old homepage claim absent.

The required pnpm typecheck/test/build jobs exclude the marketplace; its
source is covered by the workspace-wide ESLint job. New regression commands
are documented but still need CI wiring. This review is not a milestone gate.

The index is useful as a disclosed set of candidate registrations, but not as
evidence of 230 independently functioning agents. Keep category matching as a
labelled claim-derived discovery hint until it has stronger validation. Shared
endpoints are a measured relationship, not proof of a common owner or a Sybil
attack. Preserve registration identities and report endpoint clusters separately.

Next: review and land the corrected detail fix; recover the raw cache before
rebuilding; then handle stdio descriptors and endpoint-level evidence before
expanding probes. Keep the current withholding thresholds unchanged. Broader
taxonomy, independent frame construction, wallet work and hackathon fit remain
open work, not completed by this first review.
