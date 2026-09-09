# GOTCHAS

## Measuring subjects

- A validation failure must happen before publishing the replacement snapshot.
  The first detail-status fix returned an error for unexplained gaps only after
  replacing `agents.json`. It also accepted every fetch failure as evidence of
  throttling. Check the recorded cause, preserve the prior artifact on rejection,
  and never give an old snapshot an invented rate-limit reason at presentation.
- M7 trap: the diagnosis (Opus, ~$0.025/call, ~37x a draft) is an UNMETERED pipeline splurge
  today (once per study, subscription-absorbed). If M7 makes it a user-triggerable metered action
  it must be charged FRONTIER (3 credits) — STANDARD (1 credit) is −147% margin, a guaranteed
  loss (#52).
- An MCP server's "HTTP 404" is not evidence the server is gone. MCP has two HTTP transports:
  `streamable-http` (POST, reply in the response) and `sse` (GET opens a stream, an `event:
  endpoint` frame names a SECOND url to POST to). Probing an `sse` server with a POST earns
  404/405/400, which reads as dead. Measured over the full registry: sse failed at 74% against
  16% for streamable-http — the gap was our client, not their servers. Judge these by the body
  and the transport, never by the status alone.
- Worse, the SSE path hid TWO more signals inside that fake 404. `pinnedFetch` does not follow
  redirects (only `guardedFetch` does), so a server answering `GET /sse` with `307 -> /sse/` —
  one trailing slash — was filed as a 404; and a `401` on the stream GET was filed as "no
  reading" rather than as the auth wall it is. An auth wall is a KNOWN, rateable state; a 404 is
  not. Whenever a probe reports "gone", check that we knocked on the right door, followed the
  redirect, and read the challenge.
- Calibrate a hunch on the population before believing it. Hand-checking 5 SSE failures found 3
  auth walls and suggested a large misclassification; run against all 1,930, the corrected probe
  still could not reach 1,888 of them — the real wall rate was ~1%. A 5-server sample is a
  hypothesis, not a rate.
- An uncapped `Retry-After` is a self-inflicted hang. 8004scan answers every 429 with
  `retry-after: 3600`, so `time.sleep(max(retry_after, backoff))` parks a worker for a full
  hour on its FIRST throttle; with a 16-thread pool and 8 retries the run goes silent for
  hours and reads as crashed rather than throttled. A 90s cap still admitted every queued
  identity and retried too early. Stop admitting requests across the shared pool on the
  first 429, record queued work as deferred by that quota, and rerun after it resets.
  Already-running requests can finish and valid cached files are still reused.
- Recording a gap correctly is only half of rule 1; the CONSUMER has to carry it. `fetch_details`
  wrote all 1,476 unfetched agents to `detail_failures.json` as `rate_limited` (correct), but
  `build_dataset.py` loaded that set and used it in a single `print()` — it never reached the
  agent record, and there is no `detail_status` field. So "we were rate-limited" and "declares no
  endpoint" both ship as `endpoint: null`, and downstream `len([a for a in agents if not
  a["endpoint"]])` turned 232 real facts into a published 1,708. Whenever a gap is recorded in a
  side file, grep for every place the null it produces is COUNTED — the violation appears there,
  not where the gap was written.
- The probe observer's own track record (`total_observations`, `distinct_subjects`,
  `max_observations_single_day` in daily.mts) was hardcoded to the 600-subject pilot and is
  covered by `inputs_hash`. Stale values put a false claim about our own coverage into the very
  field a reader uses to audit it. They do NOT feed the velocity penalty (that is `reviewer`/
  `publisher` only), so fixing them moves hashes without moving composites — but they must be
  measured from the sweep, never asserted.

## General engineering traps (carried over, still apply)

- Parallel feature branches can mint identical migration timestamps (M4 and M5 both chose
  20260611120000). The harness applies in filename order, so the collision stays silent until
  the second branch rebases. Renumber at rebase; grep for the old filename in code comments.
- `next build` (15.3) regenerates next-env.d.ts with a routes.d.ts triple-slash reference that
  @typescript-eslint/triple-slash-reference rejects — reverting the file cannot stick because
  every build rewrites it. Add the generated file to the eslint ignore list per app.
- A REQUIRED status check whose workflow is `paths:`-filtered is a deadlock, not an
  optimisation. GitHub does not synthesise a result for a workflow that never triggered: the
  check sits at "expected" forever, the PR stays `blocked`, and there is no run to re-run. Any
  PR outside the filtered paths becomes permanently unmergeable, and nothing on the PR page
  explains why — it just shows pending checks that never start. Path filters and required
  checks are mutually exclusive; if a job is required, it must trigger on every PR. (Cost us
  #268. `skipped` counts as success for a required check, so job-level `if:` guards are the
  safe way to make required work conditional — see the `presence` job.)
- Git worktrees opened with different path casing (C:/Nibbin vs /c/nibbin) make tsc fail with
  TS1149 "differs only in casing" errors that do not reproduce in CI. cd with the canonical
  casing before typechecking on Windows.
- Happy-shape test seeds mask window math: seeding only `approved` decisions hid that
  nearGraduation counted rejections as graduation progress (gate P1). When testing anything
  windowed/thresholded, seed the adversarial decision mix, not just the shape the query expects.
- semgrep `p/default` is a floating ruleset: a branch green last week can fail SAST today with
  unchanged code. Fix findings at the root (the rules are usually right) rather than pinning.
- The block-no-verify hook scans the whole bash command STRING, not just the git invocation:
  any `-n` flag (or the literal "no-verify") elsewhere in a compound command containing a git
  commit trips it. Keep commits as standalone `git commit -F <file>` calls, and don't chain a
  `-n`-bearing command (grep -n, sed -n, heredocs quoting these) onto the same line.
- Anthropic prompt caching (cache_control ephemeral) is SILENTLY IGNORED below the model's
  minimum cacheable prefix (~1-2k tokens depending on class). A flagged-but-short stable block
  returns cache_creation=0, cache_read=0 and bills at full input rate — no error, no warning.
  Don't assume a cached prefix is saving money until you've measured cache_read_input_tokens > 0.
  Nibbin's voice prompts (~200-500 tokens) are below the floor today; caching activates when
  Grove Memory grows the prefix (SPEC §4.8).
- Token accounting for run ceilings MUST include cache tokens (cache_creation + cache_read), not
  just input + output — cached tokens are real consumption (billed, just discounted), and
  omitting them lets a run slip past its §6.2 token ceiling in real-token terms (M6.5 gate P1).
- When a model call is routed then comes back empty/failed, the user-facing decision degrades to
  the scripted floor (tier t0) but a real T1/T2 call may already be billed — record COGS on the
  DISPATCHED tier (keeperChat returns dispatchedTier/dispatchedModel), never the user-facing
