# Detail-evidence pre-merge review — 2026-09-09

Scope: `origin/main` at `f46af9b2` through `461be71a` on
`codex/trust-index-handoff`. Includes the five pending handoff commits and the
additional detail-correctness fixes. This is a bounded PR review, not approval
of the whole Trust Index methodology or an archived v1 milestone.

## Reviewer findings and resolution

| Reviewer | Initial finding | Resolution after independent re-review |
|---|---|---|
| claims-auditor | P1: historical failures counted as current gaps | Summary uses snapshot statuses; 1,474 current gaps and 1,483 historical records remain distinct. Cleared. |
| claims-auditor | P1: null-endpoint copy claims an agent cannot be hired anywhere | Copy states only that the registry detail provides no endpoint and leaves other hiring routes unknown. Cleared. |
| logic-skeptic | P1: invalid cache treated as read; stale 429 hides corrupt cache | Shared identity/schema validator; actual invalid-cache cases reject publication and preserve the prior bytes. Cleared. |
| red-team | Same invalid-detail P1 independently reproduced | Malformed/foreign-identity responses rejected before caching and publishing; valid null services accepted. Cleared. |
| cost-auditor | P2: cap90 still permits multi-day retry storms | Shared quota-stop defers queued requests at the first 429 without sleeps; cached detail is still reused. Cleared. |

Three distinct P1 findings and one P2 were fixed. Final reviewer status: no
remaining P0/P1 in this patch; cost reviewer also reports its P2 resolved.
Archived C1–C11 privacy promises, billing, Agent School and capture are not
changed by this static marketplace patch and are N/A to this review.

## Acceptance evidence

- Full workspace typecheck passes from a frozen pnpm 10.33.0 install.
- Full workspace tests: 991 passed, 25 skipped. The skipped tests are 23
  database-dependent cases without a local Docker/Postgres service and two
  existing optional web cases; they are not claimed as tested.
- Marketplace: clean `npm ci`, 12 Python pipeline regressions and four frontend
  detail-state regressions pass; TypeScript check passes.
- Repository-wide ESLint passes using the frozen ops lockfile and existing config.
- Full workspace build passes; existing web-app dynamic-import and local Next
  lint-discovery warnings remain. Standalone repository ESLint passes separately.
  Deterministic fixture regeneration produces no diff.
- Marketplace static build emits 240 pages. Post-build assertions check all
  112 listed null-endpoint pages and the homepage for evidence-limited copy.
- Required `typecheck`, `test`, and `build` CI jobs now install the excluded
  marketplace through its own npm lockfile and run its corresponding checks.
  The build job checks the actual exported HTML. Workflow permissions unchanged.
- The cached snapshot itself is not regenerated during this review. The
  committed summary correction is derived from its stored detail statuses.
- No scorer weights, publication thresholds, credentials, paid probes or
  on-chain transactions change.

## Limits and follow-up

The ignored Linux raw cache is not present here. Nine detail records changed in
the inherited handoff snapshot cannot be replayed from their original source
files on this machine. A single public registry detail read confirmed the
expected identity fields, nullable `services`, and protocol-list shape; it does
not prove compatibility of every historical cached response. Unknown shapes
fail closed and preserve the old snapshot.

The fetcher still has no full-response deadline or response-size limit, and its
failure manifest writes at completion. These pre-existing operational limits
remain; the socket timeout is not a total run bound. Already-running requests
may complete after quota exhaustion, while queued requests are deferred.

Next work remains stdio descriptor interpretation and explicit endpoint-level
evidence. Nothing in this review turns declarations into behavioural evidence.
