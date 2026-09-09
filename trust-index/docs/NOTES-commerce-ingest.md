# Commerce ingest notes (Track A stage A6)

Covers `packages/indexer/src/commerce`. The A6 gate is "outcome labels joined;
coverage percent reported".

## What is built and what is not

Built: the full pipeline. A `CommerceSource` abstraction with Olas and Virtuals
ACP adapters and a simulated source, the platform-state to canonical-outcome
mapping, agent linkage, ingest orchestration with itemized coverage accounting,
and an idempotent `commerce_events` upsert. 26 tests, none touching the network.

Not built, because it cannot be here: a real ingest run. This environment has
no network access to Olas or Virtuals, so the adapters' wire formats are
UNVERIFIED and no labels have been produced. Calibration therefore still has no
label set, and every constant stays provisional.

## The two decisions that carry methodology weight

**Outcome mapping** (`outcomeMapping.ts`). Each platform's terminal states map
to `completed | rejected | disputed | abandoned`, with the rationale recorded
per state for `/methodology`. Two rules govern the table:

- An unrecognized state is never guessed. It is excluded and counted, exactly
  as an uninferable feedback scale is (SPEC 11.10). Coercing an unknown state
  into a canonical one would manufacture ground truth, which is the one thing a
  label set cannot survive.
- The load-bearing distinction is disputed versus abandoned. A dispute is a
  counterparty asserting the work was bad; an abandonment is a job that stopped
  without that assertion. SPEC 12.3 evaluates discrimination on completed
  versus disputed precisely because conflating them turns a signal about
  quality into a signal about follow-through. So Olas `slashed` maps to
  disputed (a lost dispute is the strongest evidence delivered work was bad),
  `cancelled` maps to rejected (a no-deal, not a quality failure), and Virtuals
  `evaluation_failed` maps to disputed rather than rejected, because work was
  delivered and then judged inadequate.

**Linkage** (`linkage.ts`). Nothing on chain declares "this Olas service is
that ERC-8004 agent", so the join is evidence, not fact. Three methods in
descending strength: `agent_wallet` (strong, the identity's own declared
operating account), `owner_address` (moderate, an owner can run several agents
from one address), `historical_owner` (moderate, recovered from transfer
history so jobs performed before a sale attach to the right epoch). Every row
carries its method and strength so a cohort can be filtered or weighted, and
the coverage report breaks ingested labels down by method.

An ambiguous match is a refusal, not a coin flip. If a provider address matches
two agents, the job is dropped and counted as `ambiguous_linkage`, separately
from `unlinked_provider`, because ambiguity is a linkage bug to fix while an
unlinked provider is a coverage gap to accept. Attributing an outcome to the
wrong agent does not merely lose a label, it invents a false one, which is
worse. Fuzzy matching on names or metadata is deliberately not implemented for
the same reason.

## Coverage accounting

`CoverageReport` itemizes every job lost and why: `unmappable_state`,
`unlinked_provider`, `ambiguous_linkage`, plus the distinct unmapped state
strings with counts so a wrong or stale mapping table shows up as a fixable
list rather than as silent attrition. An ingest that dropped most of its jobs
and reported the survivors as clean labels would pass a naive coverage gate and
poison the calibration downstream, so the gate reads the itemization, not just
the percentage.

`mergeCoverage` unions agent keys rather than summing `distinctAgents`, since
an agent active in two block ranges is one agent. That number is published.

## Schema change

`commerce_events` gained `job_id`, `linkage_method`, and `linkage_strength`,
with a unique index on `(source, job_id)` so re-running an ingest upserts
rather than duplicating. A duplicated outcome row would silently reweight the
label set. Migration `0001_blue_sentinel.sql`, verified against a fresh
Postgres 16. The added columns are NOT NULL without defaults, which is safe
only because `commerce_events` has never been populated; if that changes before
this ships, the migration needs a backfill step.

## Requests to the author

- **Verify the adapter wire formats.** The endpoints, pagination, and field
  names in `adapters.ts` are written from the platform behaviour SPEC 12
  describes and could not be checked against a live API. Confirm them against
  real responses before any published number depends on them. The parsers are
  strict on purpose, so a wrong guess fails loudly rather than returning an
  empty or mis-shaped result.
- **Verify the outcome mapping against real state strings.** The native state
  vocabularies are the other unverified half. The ingest reports its unmapped
  states, so a first run against real data will name exactly what is missing.
- Decide whether calibration should use strong-linkage rows only, or all rows
  weighted by linkage strength. The data supports either; the first is a
  narrower and more defensible claim, the second uses more of a scarce label
  set. Worth settling before the whitepaper reports a coverage number.
