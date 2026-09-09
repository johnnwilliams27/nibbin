# STATE

Nibbin is an independent assessor of AI agents and the interfaces they expose.
The v1 creature/busywork product was archived on 2026-09-09 — see `../ARCHIVE.md`
and the `old-nibbin` repository.

## Current

- **Handoff review, 2026-09-09 — LOCAL, NOT MERGED.** The pending detail-fetch
  fix was reviewed in `codex/trust-index-handoff`. Additional corrections prevent
  rejected rebuilds from replacing the snapshot and missing-status rows from
  acquiring an invented rate-limit reason. Initial artifact audit and validation:
  `HANDOFF-REVIEW-2026-09-09.md`. No production refresh or threshold change.
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
