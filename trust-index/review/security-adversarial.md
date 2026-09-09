# Agent Trust Index — adversarial security review

Reviewer posture: attacker, not author. Scope per assignment: SPEC.md §13
(API), §14 (frontend), §16 (security threat model), §20 (on-chain
publication), §24 (security additions); `contracts/src/`, `contracts/test/`;
`apps/web/src/` (`lib/` + `app/` routes); `docs/NOTES-track-c.md`,
`docs/NOTES-track-d.md`.

State of the codebase at review time, relevant to reading these findings:
the web app is fixture-backed only (`PostgresDataSource` is a stub that
throws), the scoring engine (`@trust-index/scoring`) has no `index.ts` yet
so every score renders through a synthetic fallback estimator, and no
`apps/jobs` anchor/dump-generation code exists yet — `AnchorRegistry` and
`ScoreOracle` are deployed-but-unfed contracts with only test-harness
callers so far. Several findings below are therefore rated for what they
will do once the missing piece (real DB backend, real dump generator)
lands, not for what fixture-backed local dev does today; that's called out
per finding.

Every finding was demonstrated with a runnable probe against the real
source, not against a copy. Probe files live under
`/tmp/claude-0/-home-user-nibbin/a85751eb-0583-5f76-a70f-6188875ed6ec/scratchpad/probe-security/`
and their literal output is pasted inline below. No production file, test,
fixture, or golden was modified.

---

## Summary

| # | Finding | Rating | Demonstrated? |
|---|---|---|---|
| 1 | Rate limiter keys on a client-supplied `X-Forwarded-For` header; any bucket (`anonymous` or `expensive`) is fully bypassable by rotating the header per request | **P1** | Yes, against the real route handler |
| 2 | MCP `compare_agents` has no cap on its `ids` array and is billed at the cheap `anonymous` bucket, not `expensive`, despite fanning out one score computation per id | **P1** (contingent — see notes) | Yes |
| 3 | `MerkleLib`/`AnchorRegistry.verifyInclusion` does not domain-separate leaf hashes from internal-node hashes; an internal node verifies as if it were a leaf | **P2** (structural fact demonstrated; consumer-facing exploit path **not** demonstrated) | Partially — see notes |
| 4 | `POST /mcp` parses the full request body before any rate-limit check runs | **P3** | Not independently demonstrated; noted for completeness |

Findings 1 and 2 compound: because rate limiting is fully bypassable (#1),
the lack of a cap on `compare_agents` (#2) is not actually bounded by "60
calls/min from one attacker" the way the code's comments assume — it's
unbounded by request volume as well as by per-request fan-out.

---

## Finding 1 — Rate limiting is keyed on an attacker-controlled header (P1)

**Where:** `apps/web/src/lib/api-handler.ts:9-13` (`clientKey`), consumed by
`checkRateLimit` (same file) and directly by `apps/web/src/app/api/v1/mcp/route.ts:31`.

```ts
export function clientKey(request: Request): string {
  const fwd = request.headers.get("x-forwarded-for");
  if (fwd) return fwd.split(",")[0]!.trim();
  return "anonymous";
}
```

Every rate-limited surface — the `anonymous` bucket (60/min, burst 20) and
the `expensive` bucket SPEC 13 mandates for `/recompute` and
`/reviewers/:address/agents` at "10 req/min regardless of key" — keys its
token bucket off this value. The function takes the **first** comma-
separated entry in a client-supplied header. A reverse proxy that is
trusted to *set* `X-Forwarded-For` normally *appends* the real client IP as
the last hop; it does not, by itself, strip whatever the client already put
in the header before the request reached it. Nothing in this codebase
strips or validates the header, and nothing pins `clientKey` to a specific
trusted-proxy hop count or to a header the proxy is known to fully
overwrite (e.g. Vercel's `x-real-ip`). The result: any caller can set
`X-Forwarded-For` to an arbitrary, different value on every request and get
a fresh rate-limit bucket every time — regardless of what their real
network-layer source address is.

This defeats the exact protection SPEC 16 names for this threat
("Resource exhaustion via expensive queries" → "separate rate limits on
`/recompute` and reviewer-graph endpoints") and the exact contract SPEC 13
states ("`/recompute` ... 10 req/min regardless of key — these are
expensive").

Notably, the project's own test suite is already shaped around this
behavior without treating it as a bug: `apps/web/test/api-routes.test.ts`'s
`req()` helper increments a fake `X-Forwarded-For` on every call
specifically so tests don't trip the limiter across unrelated assertions,
while the tests that *do* check the limiter (`rate-limit.test.ts`, and the
"is rate limited" tests in `api-routes.test.ts`) always hold the header
fixed. No test exercises rotation.

### Probe and literal output

`/tmp/.../probe-security/xff-probe.ts` (run with `tsx` from `apps/web` so
the `@/*` alias resolves), imports `clientKey`, `checkRateLimit`, and the
**real** `GET` handler from
`apps/web/src/app/api/v1/agents/[chain]/[id]/recompute/route.ts` directly —
no route was modified, no mock replaced the handler.

```
--- clientKey() reads the first, attacker-controlled XFF hop ---
clientKey("1.2.3.4, 203.0.113.9") = 1.2.3.4
clientKey("9.9.9.9, 203.0.113.9") = 9.9.9.9
OK: clientKey returns the first (spoofable) XFF entry, not the real client
OK: two requests from the same real client produce different rate-limit keys

--- checkRateLimit against the 'expensive' bucket (limit 10/min per SPEC 13) ---
100 calls, distinct spoofed XFF each time: allowed=100 blocked=0
OK: all 100 calls passed the 'expensive' 10/min limiter by rotating XFF

--- contrast: fixed XFF (no spoofing) is capped correctly ---
30 calls, same XFF each time: allowed=10 blocked=20
OK: fixed IP is capped at 10/min as intended

--- end-to-end through the real GET /api/v1/agents/:chain/:id/recompute handler ---
25 calls to the real recompute route handler, distinct spoofed XFF each: 200s=25 429s=0
OK: real route handler's 'expensive' rate limit is fully bypassed via XFF rotation

PROBE: ALL ASSERTIONS PASSED (vulnerability demonstrated)
```

The contrast run (fixed header → correctly capped at 10/30) confirms the
limiter's math is fine; the key derivation is the flaw.

### Impact

- Defeats the `expensive` bucket entirely for `/recompute` and
  `/reviewers/:address/agents` (and the MCP equivalents), so once a real
  scoring engine and `PostgresDataSource` exist, an attacker can drive
  unlimited expensive recomputation against the hosted instance.
- Defeats the `anonymous` bucket the same way for every other endpoint.
- `SECURITY.md` lists "volumetric denial of service" as explicitly out of
  scope; this is not that — it costs the attacker nothing extra to defeat
  (one more header value per request, no extra bandwidth, no botnet), and
  it silently disables a control the spec explicitly relies on rather than
  the service being overwhelmed by legitimate-shaped traffic volume. I'm
  rating it as in-scope on that basis but flagging the tension with
  `SECURITY.md`'s wording for the maintainer to weigh.

### Recommendation

Do not trust a client-settable header as the rate-limit identity on its
own. If deployed behind Vercel: use `request.headers.get("x-real-ip")` (or
whatever header the actual edge platform guarantees it overwrites, verified
against that platform's docs, not assumed) as the primary key, or trust
only the *last* N hops of `X-Forwarded-For` where N is the known,
fixed number of trusted proxies in front of the app — never the first
hop of a client-supplied header. Add a rotation test to
`rate-limit.test.ts`/`api-routes.test.ts` alongside the existing
fixed-header ones, so a future refactor doesn't silently reopen this.

---

## Finding 2 — `compare_agents` has no size cap and is billed at the cheap bucket (P1, contingent on backend)

**Where:** `apps/web/src/lib/mcp.ts:119-132` (`compare_agents` case) and
`bucketForTool` (same file, lines 43-45).

```ts
case "compare_agents": {
  const chain = str(params, "chain");
  const idsRaw = params?.["ids"];
  if (!chain || !Array.isArray(idsRaw) || idsRaw.length === 0) {
    return invalidParams(id, "chain and a non-empty ids array are required");
  }
  const ids = idsRaw.filter((x): x is string => typeof x === "string");
  const agents = (await Promise.all(ids.map((agentId) => dataSource.getAgent(chain, agentId)))).filter(...)
  ...
}
```

```ts
export function isExpensiveTool(method: string): boolean {
  return method === "recompute";
}
export function bucketForTool(method: string): "anonymous" | "expensive" {
  return isExpensiveTool(method) ? "expensive" : "anonymous";
}
```

`compare_agents` fans out one `dataSource.getAgent()` (which, per
`fixture-data-source.ts`, always runs a full `scoreSnapshot()`) per entry in
a caller-supplied array, with **no length check anywhere** — contrast every
list-shaped REST/MCP response, which routes through
`pagination.ts`'s `clampLimit()` (hard cap `MAX_PAGE_SIZE = 100`, per SPEC
16: "Hard caps on pagination (max 100)"). `compare_agents` has no
equivalent. It is also charged against the `anonymous` bucket (60/min,
burst 20), not `expensive` (10/min) — despite doing, per call, up to
however many score computations the caller's `ids` array contains, which is
a strictly larger unit of work than the single-agent `recompute` call that
*is* billed `expensive`.

### Probe and literal output

`/tmp/.../probe-security/compare-agents-probe.ts`, against the real
`handleMcpCall` and `FixtureDataSource`:

```
bucketForTool("compare_agents") = anonymous
bucketForTool("recompute")      = expensive
OK: compare_agents is billed at 60/min, not the 10/min 'expensive' rate SPEC 13 reserves for equivalently fan-out-shaped calls

clampLimit(5000) = 100 (every list endpoint caps here, MAX_PAGE_SIZE=100)

compare_agents called with ids.length=5000: isError=false elapsedMs=52
OK: a single compare_agents call with 5000 ids is accepted outright, no length validation, no truncation, no separate rate cost
resolved agents.length = 1 (out of 5000 ids fanned out to Promise.all)

PROBE: ALL ASSERTIONS PASSED (unbounded fan-out demonstrated)
```

### Impact and why it's rated contingent

Against `FixtureDataSource` today, 5,000 ids costs ~52ms — cheap, because
the fixture set is ~10 snapshots held in memory and the synthetic
estimator is plain arithmetic. The **shape** of the vulnerability is fully
demonstrated (no cap, wrong bucket); its real-world cost is not, because
the two things that would make it expensive — `PostgresDataSource` (a
per-id DB round trip) and the real `@trust-index/scoring` engine — are both
unimplemented stubs right now. I'm rating this P1 on the spec-conformance
violation (SPEC 16's stated pagination-cap mitigation is absent here) and
because the failure mode is exactly the "resource exhaustion via expensive
queries" SPEC 16 names, not P0, since I can't demonstrate present-day
resource cost against a nonexistent backend. Flagging explicitly so
whoever wires up `PostgresDataSource` doesn't ship this gap into the first
version that can actually be hurt by it — chained with Finding 1, a single
attacker can hold the `anonymous` bucket open forever via XFF rotation and
send unboundedly large `ids` arrays on every call.

### Recommendation

Cap `ids.length` (reuse `MAX_PAGE_SIZE` or a smaller purpose-picked
constant) and return `invalid_request`/`invalid_params` above it, same
pattern `clampLimit` already establishes elsewhere. Route `compare_agents`
through the `expensive` bucket, or a bucket scaled by `ids.length`.

---

## Finding 3 — Merkle leaf and internal-node hashes are not domain-separated (P2, partially demonstrated)

**Where:** `contracts/src/MerkleLib.sol`, used by
`contracts/src/AnchorRegistry.sol:72-74` (`verifyInclusion`).

```solidity
function verify(bytes32 root, bytes32 leaf, bytes32[] calldata proof) internal pure returns (bool) {
    bytes32 computed = leaf;
    for (uint256 i = 0; i < proof.length; i++) {
        computed = _hashPair(computed, proof[i]);
    }
    return computed == root;
}
function _hashPair(bytes32 a, bytes32 b) private pure returns (bytes32) {
    return a < b ? keccak256(abi.encodePacked(a, b)) : keccak256(abi.encodePacked(b, a));
}
```

The verifier treats the `leaf` argument identically to every intermediate
hash: same function, same 64-byte-packed-pair input shape, no leaf/node
tag byte, no depth counter. This is the textbook missing-domain-separation
weakness in unprefixed sorted-pair Merkle trees: **any internal node's hash
is itself accepted as a valid "leaf"** by `verifyInclusion`, provided the
caller supplies the real remaining sibling path from that node to the
root — which is public, since SPEC 20.1 says "the public dump at `/dumps`
is the preimage set" and anchored roots plus their leaf data are meant to
be fully public.

### What I demonstrated (real contract, no modification)

Built an 8-leaf tree by hand in a scratch Foundry project that imports the
**actual** `AnchorRegistry.sol` and `MerkleLib.sol` by path (no copy), posted
its root via the real `anchor()` call, then called the real
`verifyInclusion()` twice:

```solidity
// sanity: a real leaf verifies with its real 3-hop proof
assertTrue(registry.verifyInclusion(idx, leaves[0], realProof), "sanity: real leaf verifies");

// the probe: internal node l1[0] = hash(leaves[0], leaves[1]) — never
// itself published as a leaf — treated as a "leaf", with only the
// remaining 2 real sibling hashes as its proof
bool internalNodeVerifiesAsLeaf = registry.verifyInclusion(idx, l1[0], forgedProof);
assertTrue(internalNodeVerifiesAsLeaf, "...");
```

```
$ forge test -vv
Ran 1 test for test/MerkleSecondPreimage.t.sol:MerkleSecondPreimageTest
[PASS] test_InternalNode_VerifiesAsLeaf() (gas: 164455)
Suite result: ok. 1 passed; 0 failed; 0 skipped
```

Both assertions pass: the real leaf verifies (sanity), and the internal
node — a value that was never in the leaf/preimage set — also verifies as
if it were a member. This is a structural fact about the deployed contract,
demonstrated without finding any hash preimage.

### What I did **not** demonstrate (labeling as unverified suspicion)

Whether this is exploitable to make a *consumer* believe a *fabricated
score record* is anchored. `packages/types/src/oracle.ts` defines the real
leaf preimage as "canonical JSON of {chain_id, agent_id,
methodology_version, inputs_hash, score, score_low, score_high, confidence,
n_eff}, hashed **sha256**" — a 9-field JSON blob, hashed with a *different*
hash function than the keccak256 used for internal-node combination. A
consumer that correctly re-derives a candidate leaf as
`sha256(canonical_json(claimed_fields))` and then calls `verifyInclusion`
would need that value to equal some internal node's keccak256 output to be
fooled — i.e., they'd need a preimage of a specific keccak256 digest under
sha256, which is exactly as infeasible as it sounds. I could not construct
this (nor would demonstrating a hash break be in scope), so I'm not
claiming score forgery is possible today. What I am flagging:

- No off-chain dump/anchor-building tooling exists yet in this repo
  (`apps/jobs` is empty). SPEC 20.1 and `docs/NOTES-track-c.md` both
  describe the pairing convention but **neither specifies an odd-leaf-count
  padding rule** (`MerkleTestTree.sol` even notes "power-of-two leaf counts
  only; no odd-leaf duplication rule is defined or needed by these
  tests"). A real scores table will essentially never have a power-of-two
  row count. If whoever builds that tooling reaches for the common
  "duplicate the last leaf" padding shortcut, the missing domain separation
  documented here turns into the classic, directly exploitable duplicate-
  leaf second-preimage attack (a real leaf's sibling-of-itself internal
  node becomes indistinguishable from a second occurrence of that leaf).
  This is a real risk for a component that doesn't exist yet, not a
  demonstrated bug in the current one.
- Independent of forgery, `verifyInclusion` returning `true` is a weaker
  guarantee than "this exact leaf was in the published dump" — it also
  returns `true` for values that were never leaves at all. Any future code
  (or documentation, e.g. the recommended integration text for
  `GET /agents/:chain/:id/proof`) that treats a bare `true` from
  `verifyInclusion` as sufficient, without the caller having independently
  recomputed the leaf from the documented 9-field formula, would be relying
  on a guarantee the function doesn't actually provide.

### Recommendation

Add a one-byte (or one-word) domain tag distinguishing leaf-level hashes
from internal-node hashes — e.g. `keccak256(abi.encodePacked(uint8(0), leafData))`
for leaves vs. the existing pair-hash for internal nodes — the standard
fix (this is what current OpenZeppelin `MerkleProof` guidance and most
post-2022 Merkle libraries do). Cheap to add now, before any off-chain
tooling or integrator docs commit to the current shape. Separately: when
`apps/jobs`'s dump/anchor builder is written, explicitly define and test
the odd-leaf-count convention rather than defaulting to duplication.

---

## Finding 4 — `POST /mcp` parses the request body before rate limiting (P3, noted not demonstrated)

**Where:** `apps/web/src/app/api/v1/mcp/route.ts:12-21`. `request.json()`
runs before `bucketForTool`/`rateLimiter.consume` are reached, so an
oversized or malformed-but-parseable JSON body is fully parsed on every
call regardless of rate-limit state. This is a minor, generic
resource-consumption note (any JSON API has some version of this; Next.js's
default body-size behavior may already bound it depending on runtime
config, which I did not verify) rather than a finding specific to this
codebase's logic. Downgrading to P3 and not building a probe for it: I
could not find a way to demonstrate real resource impact without sending
large bodies against a running server, which is outside what a unit-level
probe can show and risks looking like a volumetric-DoS claim the project's
own `SECURITY.md` places out of scope. Noting it for completeness per the
assignment's instruction to flag rather than silently drop.

---

## Areas checked with no finding

- **XSS via agent name/description/metadata (SPEC 16).** Not currently
  reachable: `FixtureDataSource.getAgent` hardcodes `name: null,
  description: null` and nothing in `apps/web/src/app` renders those
  fields yet. No `dangerouslySetInnerHTML` anywhere touches request- or
  fixture-derived data (`layout.tsx`'s one use is a static token-derived
  CSS string). This is a gap to re-check once metadata rendering ships,
  not a present finding.
- **SQL injection.** `PostgresDataSource` is entirely unimplemented (every
  method throws); nothing to inject into yet.
- **Path traversal via `chain`/`id`/`address` route params.** Fixture
  lookup (`fixtures.ts`) does equality comparison against parsed JSON, not
  filesystem access with user input; no traversal surface.
- **Contract access control** (`AnchorRegistry`, `ScoreOracle`): both use a
  hand-rolled two-step `Ownable2Step`-equivalent, no upgradeability, no
  fund custody, `onlyOwner`-gated writes, checked arithmetic throughout
  (Solidity 0.8.24), no external calls beyond the intended reads. No
  reentrancy surface (no calls out at all). `meetsThreshold`'s
  future-`asOfBlock` underflow guard is correct and tested.
  I did not find an exploitable issue here beyond Finding 3.
- **Secrets in the repository.** `env.example` (the SPEC-mandated
  `.env.example` equivalent) contains only empty keys; grepped the tree for
  private-key/secret-shaped strings, found none.
- **CORS.** `Access-Control-Allow-Origin: *` on every response is
  intentional (SPEC 13: "CORS open for GET") and not a vulnerability here
  — the API is unauthenticated and cookie-free by design, so there is no
  session/credential for an open CORS policy to leak.

---

## Probe inventory

All under
`/tmp/claude-0/-home-user-nibbin/a85751eb-0583-5f76-a70f-6188875ed6ec/scratchpad/probe-security/`:

- `xff-probe.ts` — Finding 1, run via `tsx` from `apps/web`.
- `compare-agents-probe.ts` — Finding 2, run via `tsx` from `apps/web`.
- `merkle-scratch/` — Finding 3, standalone Foundry project (its own
  `foundry.toml` with `remappings` pointing at the real
  `contracts/src/*.sol` and `contracts/test/utils/*.sol` by absolute path;
  no files under `contracts/` were copied or edited), run via `forge test`.
- `xff-bypass.probe.test.ts`, `compare-agents-unbounded.probe.test.ts` —
  earlier vitest-shaped drafts of the same two probes, superseded by the
  `tsx` scripts above once `apps/web/vitest.config.ts`'s `include` glob
  (which only picks up `test/**/*.test.ts` inside the owned package) turned
  out to exclude scratch-directory test files by design; kept for
  reference, not part of the demonstrated evidence chain.

No file under `trust-index/` outside `review/security-adversarial.md` was
created, edited, or deleted by this review.
