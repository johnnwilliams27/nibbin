# STATE

Nibbin is an independent assessor of AI agents and the interfaces they expose.
The v1 creature/busywork product was archived on 2026-09-09 — see `../ARCHIVE.md`
and the `old-nibbin` repository.

## Current

- **nibbin.com is LIVE**, serving the BNB agent marketplace (308 → `www.nibbin.com`). Vercel
  project `nibbin-bnb-marketplace`, Root Directory `trust-index/apps/bnb-marketplace`, Next.js
  static export. The v1 site is down. **Never add a root `vercel.json`** — Root Directory is
  already set, so a root config that `cd`s into the same path breaks the build.
- **`main` is protected.** Required checks: `typecheck`, `lint`, `test`, `build`. The
  `trust-index.yml` `paths:` filter was removed — a required check behind a path filter can never
  report, so any PR outside those paths was permanently unmergeable (see `GOTCHAS.md`).

### Open P0 — a live integrity defect, fix ordering starts here

- **P0: 4,883 agents carry a verdict that blames them for our limitation.** `agents.json` records
  2,716 as *"answered HTTP 405 but did not complete an MCP handshake"*. They sit behind 6
  endpoints; 2,711 behind `https://q402.quackai.ai/api/mcp/info`, which answers `GET 200` with a
  valid ERC-8004 `service.mcp` descriptor declaring `transport: stdio` and enumerating 8+ tools.
  The server runs over stdio via npx. Our prober is HTTP-only and structurally cannot dial it. This
  is `harness_capability_missing` written as a subject failure. Not rendered on the site (all are
  category `other`) but it ships in `agents.json`. Reword the verdict; then read the descriptor
  rather than POSTing at it — it is the largest single coverage win available.
- **P0: the index construction has never been reviewed.** The 230 listed agents come from a 10,041
  candidate pool = 3.2% of the BSC registry, assembled entirely from 8004scan streams plus 13
  hand-picked search terms; categories are regex matches over the agents' own self-written
  descriptions (provenance 0.15, the weakest tier) with median confidence 0.6 and 16 of 230 below
  0.4; and the 230 resolve to 134 distinct descriptions and 40 distinct endpoints. The sampling
  frame and the taxonomy were fitted to each other. `HANDOFF.md` §4.4 has the full audit.
- ~~**P1: why no agent scores is unresolved between two hypotheses.**~~ **Settled 2026-09-09: it
  was the pipeline, not the thresholds.** No threshold was changed. `score-marketplace.mts` now
  joins transcripts to battery outcomes and calls `scoreSubject` for both protocols; on 273 live
  transcripts that gives **42 published composites** (MCP 13/173, A2A 29/100). The A2A half had
  been structurally unrateable — no profile, no assembler, nothing running the battery — so 100
  probed agents produced 0 scores from a rubric that was never consulted.
- **P1: 23 of the 29 published A2A subjects sit at exactly 77.5**, the ceiling for a subject whose
  every check passes on a single day (shrinkage toward the 0.55 prior, `thin` tier, wide
  interval). Twelve of them are subdomains of ONE `bubbleupdappos.workers.dev` account and four
  are one `fly.dev` operator. `endpoint_shared_with` counts registrations per endpoint and does
  not catch one deployment behind many hostnames. Before these go on the site, either group them
  or say plainly that they are one operator — twelve identical rows read as twelve agents.
  Repeated daily sampling is what separates them; one day cannot.
- **P1: 8004scan supplies the sampling frame**, which `DIRECTION.md` §11's Glama ruling
  (third-party metadata enriches at 0.60; behavioural evidence stays ours) does not permit.
  `packages/indexer` already enumerates 496,976 agents from chain independently — use it.

### A2A rating landed 2026-09-09

`a2a_agent.v1` (`packages/types/src/profiles.ts`), its assembler
(`collectors/src/a2a/subject.ts`), and `scripts/run-a2a-battery.mts`. Weights mirror
`mcp_server.v2`'s 0.80/0.20 behaviour/declaration split so an A2A 70 means roughly what an MCP 70
means; v2's 0.20 on `tool_safety` has no A2A equivalent (an AgentSkill has no schema and no
`readOnlyHint`) and goes to injection resistance 0.25, functional correctness 0.35, robustness
0.20. The three behavioural dimensions are shared specs now, because a shared dimension id has to
mean one thing across the compendium.

Running it against 48 live agents found four defects, all of them ours written as facts about the
subject, all four caught by reading the pass/fail/undecided tallies rather than the scores:
the safety screen delegated to the MCP verb list and so never checked `swap`/`stake`/`withdraw`
(three financially-named skills were invoked); determinism compared whole JSON envelopes and
called 57 of 76 skills inconsistent over protocol-mandated UUIDs; 14 injection verdicts were read
off calls that only errored, every one recorded as a pass; and the malformed arm sent a legal
empty text part, leaving robustness undecided 57 times in 76. See `LEARNINGS.md` and `GOTCHAS.md`.

Engine: `dimension_coverage` could exceed 1 (measured 1.21) once a dimension could be partly
assessable — the case `rating/index.ts` predicted would arrive with the first per-check collector.
Composite untouched.

### Fixed 2026-09-09

- **A rate-limit gap was being published as "declares no endpoint."** Only the detail view carries
  an endpoint and that fetch is capped at 1000/hour, so agents we never reached landed with
  `endpoint: null`, identical to agents that declare none. `build_dataset.py` loaded the failure
  list and used it in one `print()`, so it never reached the record. Published "1,708 declare no
  endpoint" (228 do) and told 11 agents' visitors they "cannot be hired at all". Fixed with
  `detail_status: "read" | "unread_rate_limited"` on every record, `DATA-CONTRACT.md` rule 4, and
  a normalise() default of *unknown* rather than *read* so old snapshots cannot silently restore
  the bug.
- **`fetch_details.py` parked itself for an hour on the first 429.** 8004scan sends
  `retry-after: 3600`; the uncapped `sleep(max(ra, ...))` put all 16 threads to sleep. Capped at 90s.
- Detail cache at **8,590/10,041**, snapshotted to `data/cache-snapshot/` (7.5MB, restorable).
  `data/raw/` is gitignored as regenerable — true, but only at 1000 req/hour ≈ 10 hours cold.
- **Detail-evidence correctness review, 2026-09-09.** Implemented and reviewed
  on `codex/trust-index-handoff` through `461be71a`. Invalid or mismatched detail
  cache cannot establish a reading; failed rebuilds preserve the snapshot;
  missing-status rows stay unknown; shared quota exhaustion defers queued work.
  Marketplace tests/build now participate in required CI. Four-reviewer report:
  `gates/2026-09-09-detail-evidence.md`. Initial audit:
  `HANDOFF-REVIEW-2026-09-09.md`. No new production measurements or threshold changes.

- **ERC-8004 population frame, 2026-09-09.** Censused all twelve EVM chains carrying the
  Identity Registry: **496,976 agents**, independently reproduced (within ~1.5%) of
  8004scan's 504,235+ without using their API. BSC holds 341,769 (69%) with ZERO feedback
  activity; Base holds 85,662 and carries essentially all the feedback. The raw count is
  therefore nearly useless on its own — the funnel is the contribution, and nobody
  publishes one. 8004scan reports 89.2% of agents declare no service interface at all.
- **MCP corpus.** 15,043 servers probed from the official registry; 8,675 tool-listed,
  3,774 auth-walled, 2,594 no-reading. Only **161** carry behavioural battery evidence, so
  only 161 publish a composite. The 98.9% withholding rate is currently ~83% driven by our
  own harness gaps (8,514 never battered, 3,774 lacking credentials) rather than by thin
  subjects — do not quote it as a property of the population.
- **Auth walls.** Of 3,774, exactly **230** are fully self-servable (client_credentials +
  Dynamic Client Registration) across 189 distinct domains. 3,544 need a human login.
  Host concentration is low, so there is no single signup that unlocks many.
- **A2A prober shipped**, 416/416 tests green, unlocking the 28,459 A2A-declaring BSC
  agents the MCP-only harness could not reach.
- **BNB marketplace app** (`trust-index/apps/bnb-marketplace`) built for the Smart Money
  Era hackathon. ERC-8183 hire flow verified on BSC testnet (job 1161 FUNDED, gas fully
  sponsored by MegaFuel, $0.00 spent).

## Carried over from the v1 era (still true of the rating engine)

- **Trust Index — behavioural rating + adversarial hardening — 2026-09-05, NOT GATED.** A ratings
  engine for MCP servers (and, via the same evidence contract, on-chain agents), living in
  `trust-index/`. Not part of any signed milestone; recorded here because it had no entry at all.
  - **The structural finding that reshaped it:** all 19 checks reaching a rating read MANIFESTS, and
    zero behavioural checks reached one — while 30 of 70 invoked tools did not actually work. The
    population's p10–p90 spread was 2.4 points across 8 distinct scores, i.e. the rating was a
    constant wearing a dimension's clothes. Wiring the invocation battery in and reweighting
    (`mcp_server.v2`: 60% behaviour) took it to **31.2 across 23 distinct scores** on 70 published
    of 600 probed. v1 is kept registered and superseded, because `profile_digest` exists so a reader
    can tell which rules produced a historical number.
  - **Judge chosen by measurement, not preference:** a 120-item labelled benchmark over seven
    structures (4 voters / 2 deciders / 1 meta, plus every smaller subset re-derived from stored
    votes). The voting panel LOST — it abstained on 19 of 120, declining exactly the questions worth
    asking. Top five structures sit inside the 5.4-point resolution, so the cheapest was taken:
    **one model, no panel, claude-sonnet-5**. The panel harness is kept for re-deciding when models
    change.
  - **Adversarial pass (2026-09-05), 12 findings, all fixed.** Five were P1 and each is now pinned
    by a regression test that fails without its fix. Injection resistance gave a clean pass to a
    tool that obeyed and quoted the query back (+12.5), or that padded past the 300-char sample.
    199 trivial tools diluted one hostile tool from 52.95 to 75.33 (+22.4) — behavioural occurrence
    gates added. `isCredentialParam` was an equality test, so `api_key` fired the hardest gate in
    the profile and `auth_token` did not (+30.5 for a rename). Every probe constant was a literal in
    a public repo, worth +17.5 to anyone who grepped, widening to 44.6 under a daily schedule — now
    per-subject HMAC values from `TRUST_INDEX_PROBE_SEED`. And an unhandled judge error let a
    subject convert its own failing evidence into OUR harness gap, published under our name.
  - **Judge headline RE-EARNED 2026-09-06: `0.858 [0.785, 0.910]`** on the shipping configuration
    (whole responses, `truncated` present, current prompt), 103/120, zero abstentions, nothing
    harness-blocked. Supersedes 0.892, which was measured on whole responses while production sent
    300-char fragments. **The two are not distinguishable at n=120** — each sits inside the other's
    interval — so this is not a regression, it is the first number that describes what ships.
    The 17 misses are not 17 mistakes: **seven land on a boundary the rubric defines twice and
    incompatibly** (an empty-handed finding is an `answer` at judge/index.ts:286; an explicit "no
    match" is a `refusal` at :291; a search returning `no_match` is both), which is 41% of all
    measured error and needs a product decision, not more measurement — does a tool that honestly
    finds nothing count as working? One miss is a real judge defect: it called 2026-dated release
    data invention because the dates sit past its training, i.e. it treats its own cutoff as the
    edge of reality, which fires hardest against subjects whose data is most current. Full analysis
    and the ordered fix list: `trust-index/docs/judge-headline-remeasure.md`.
  - **Known-open, deliberately:** the older 0.892 judge headline was measured on whole responses while
    production sent 300-char fragments; the call site is fixed and the invention class re-measured
    (6/6, 1/25) but the 120-item number has not been re-earned. A public DNS name resolving to
    loopback (`localtest.me`) still passes `vetUrl` — `net.ts` documents this and the fix is the
    resolve-then-pin it describes and does not implement. gpt-5.5 answered 97 of 120 items under our
    rate limit, so the benchmark's vendor ordering means nothing (its structural findings survive).
    No human has reviewed a sample of the Claude-drafted ground-truth labels.
