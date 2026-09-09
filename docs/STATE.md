# STATE

Nibbin is an independent assessor of AI agents and the interfaces they expose.
The v1 creature/busywork product was archived on 2026-09-09 — see `../ARCHIVE.md`
and the `old-nibbin` repository.

## Current

- **Hackathon experience and public hire path, 2026-09-09 (in progress).**
  `codex/hackathon-experience` adds search/filter/navigation/copy improvements,
  endpoint-level evidence, and user-confirmed browser ERC-8183 hiring. The four
  categories come from the official BNB Smart Money Era track. The 230 listings
  are category matches from a selected 10,041-registration snapshot, not the best
  230 of a complete registry census. No marketplace behavioral scores are published.
  Gate and deployment evidence: `gates/2026-09-09-hackathon-experience.md`.
  - Public testnet reference seller delivered job **1169**, with its downloaded
    manifest independently matching the on-chain digest. Status was **SUBMITTED**,
    not settled, at verification. All four buyer steps were sponsored; browser
    users still need test BNB for wallet-paid gas.
  - Separate mainnet seller is deployed with a fresh sensitive Vercel key, one
    user-approved buyer, three-submission limit and 0.0001 BNB per-submission cap.
    Total approved seller cap: **0.0003 BNB**. It currently refuses quotes because
    its gas reserve is unfunded. No mainnet job or spending has been performed.
  - Both seller projects have active 30 requests/minute/IP Vercel WAF rules.
    Counters are per region, not an aggregate spending guarantee.
  - Full workspace checkpoint passes (1,029 tests, 25 explicit skips). Latest
    marketplace checks:51 tests,14 pipeline tests,242 exported pages, typecheck,
    source ESLint and112 null-endpoint export checks. Fresh collector pass:457tests.
  - UX now uses the marketplace name, four clear navigation links,12-item numbered
    pagination, expandable cards, a form-first hire page, and reduced-motion-aware
    backgrounds. Most-evidence sorting is the default; custom listboxes retain
    keyboard navigation. Detail pages return to the saved search/filter/page.
    Mobile spacing/overflow, page changes and real example verification checked.
    Marketplace production release is still pending.
  - Chrome/MetaMask buyer journey created, registered, set zero budget and funded
    testnet job **1179**; the browser verified the delivered manifest. The buyer
    also confirmed a dispute. A subsequent read-only chain check confirmed
    **COMPLETED (status 3)** at block **129997818**, timestamp **1788945540**,
    with buyer `0x51e048a166D22e2898790a4806652bCFf6F03A36` and the previously
    verified deliverable digest unchanged. The browser buyer hire loop is closed.
    The UI still needs an
    explicit policy-dispute status instead of only the commerce job status.
  - Hire controls now have hover/press/focus feedback, disabled-state treatment,
    and warning styling for disputes. Fixed terminal job refresh after the router
    clears its policy binding. Latest marketplace tests: **52 passing**, typecheck
    passing; browser verified hover colour/lift, keyboard focus and disabled controls.
  - Marketplace cards (and their shared table status) display a valid published
    numerical rating with coverage when available, otherwise keep the evidence
    status. Safety flags take precedence; reference agents remain independently
    unrated. All 230 current listings still lack a published composite. 170 have
    image URLs, now rendered as right-aligned avatars with initials on missing or
    failed images. Detail rating/coverage stays open; desktop summary cards share
    content-driven heights and the connection panel is horizontal below them.
  - Buyer reviews: wallet-signed public review service deployed at
    `https://nibbin-buyer-reviews.vercel.app/api/reviews`, backed by the isolated,
    user-approved Neon Free database with production-only Vercel-managed access.
    Local service tests: 32 passing plus one local database skip; the real database
    integration test passed in the deployment build. Frontend separates testnet
    feedback from mainnet ratings; fictional examples never enter public counts.
    `/try/?job=1179` opens the resume controls. The user's approved review text is
    not confirmed published. User reports accepting the wallet message, but the
    public endpoint still returns no reviews; publication remains under diagnosis.
    The account-request stack overflow stopped when the user disabled a competing
    wallet extension. Explicit multi-provider discovery is still a follow-up;
    current connection diagnostics identify discovery/account/network failures.
    Try page now has a progress indicator, visible resume action, visible review
    section and limitations, and an accessible example-result drawer. Completed
    job review CTA follows the deliverable with a distinct completion accent.
    Browser checks: drawer Escape/focus return and retained inputs, mobile fit,
    and home BNB outline centered within its orbit at 1280/1920px widths.
    Latest marketplace verification: **84 tests passing**, typecheck passing.
    Isolated real-browser integration also passes Completed resume → preview →
    one simulated signature → publication confirmation, plus Submitted eligibility
    and disconnected-button checks. External RPC/wallet/API were intercepted:
    this is not evidence of the user's real review being published. The latest
    user screenshot showed a connected wallet but no job loaded; directed to resume
    completed job 1179 instead of creating another hire.
    Written design: `superpowers/specs/2026-09-09-buyer-reviews-design.md`.

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
