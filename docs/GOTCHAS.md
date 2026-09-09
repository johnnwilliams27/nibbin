# GOTCHAS

## Measuring subjects

- A shared URL can back thousands of registrations. Exact-URL evidence replay
  must preserve the original check time and source hash; the replay clock is not
  a new measurement. An empty gate list is not proof a safety battery ran.
- Static A2A cards and stdio descriptors are declarations. Never promote their
  capability names to executed behavior or offer a descriptor URL as HTTP MCP.

## Public ERC-8183 hiring

- SDK0.5.5 registers a job on the **router**, not commerce. A zero-budget job
  still needs setBudget(0); read jobHasBudget instead of inferring it from budget.
- Public BNB RPC endpoints may reject the SDK's funding-event log range. Use a
  successful canonical funding receipt and verify its event and block timestamp.
- SDK receiptTimeout is measured in seconds. Serverless work must be awaited;
  detached delivery promises may be discarded as soon as a response is sent.
- Never replace a stable testnet seller origin with mainnet configuration.
  Historical delivery URLs include the chain and must keep resolving.
- The browser and sponsored CLI runner have different gas behavior. Do not
  promise gas-free browser hiring because the SDK smoke runner used MegaFuel.
- An ambiguous wallet transport error may follow a broadcast. Preserve its
  unknown outcome and require checking wallet activity; never silently resend.

## Parallel local previews

- next dev and next build cannot safely share .next. Use NIBBIN_DEV_PREVIEW=1
  for the marketplace's isolated .next-preview output while building in parallel.
- A shared unlayered `padding: 0 32px` overrides Tailwind route `py-*` classes.
  Set `padding-inline` only on page wrappers; check main/header/footer geometry
  rather than hiding overflow. Replace live-preview files atomically with Update
  patches, not separate delete/add calls that leave imports missing.
- Unlayered heading resets also override utility margins. Keep defaults in the
  base layer. A transform on an animated results wrapper can become the containing
  block for absolutely positioned screen-reader text; position the inner table
  scroll region relatively so hidden captions cannot widen the document.

## Earlier measurement and pipeline traps

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
  hours and reads as crashed rather than throttled. A 90s cap was the first fix and was NOT
  enough: it still admitted every queued identity and retried too early. Stop admitting
  requests across the shared pool on the first 429, record queued work as deferred by that
  quota, and rerun after it resets. Already-running requests can finish and valid cached files
  are still reused.
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
- The rating engine strips an OBSERVATION key at its first colon (`observationCheck`) but takes
  a GAP's `check` field verbatim. Scoping both per item therefore counts one unscoped attempt
  against N scoped blocks, and probing MORE of a subject reports it LESS completely assessed —
  measured on a2a_agent.v1: three skills gave completeness 0.825 where one gave 0.9125. Scope
  observation keys (identity is observer+dimension+key+ts, so unscoped keys collide and results
  vanish); do NOT scope gap check names — put the item id in `detail`.
- A gate's `observation_key` is matched literally, so a gate observation must be emitted
  UNSCOPED even in a collector whose other keys are scoped. A per-item gate key never matches
  and the cap becomes dead code with no error.
- `probeSeed()` returns `{ seed, reproducible }` and never null. `score-marketplace.mts` guarded
  it with `if (seed === null) process.exit(1)`, which is unreachable — every run without a
  configured seed passed silently and produced ratings nobody can replay. Check `.reproducible`.
- Comparing two agent replies with `JSON.stringify` measures the protocol, not the agent. A2A
  mandates a fresh `messageId` per message and servers mint `taskId`/`contextId` per exchange;
  raw comparison called 57 of 76 live skills non-deterministic when every sampled pair was
  otherwise byte-identical. Strip envelope ids and normalise UUIDs/timestamps before comparing.
- An empty string is a LEGAL A2A text part, so sending one is not a malformed-input test — 57 of
  76 agents accepted it and the robustness arm decided nothing. Send params the spec forbids
  (`params` without `message`) if you want a -32602.
- `isMutatingName` (mcp/assess.ts) carries the document-editing vocabulary only: create, delete,
  transfer, pay. It has NO swap, buy, sell, trade, mint, burn, stake, withdraw or approve. Any
  safety screen for on-chain subjects that delegates to it is not checking the verbs that move
  money — a live run invoked `swap-quote`, `swap-build` and `trade` through exactly this gap.
