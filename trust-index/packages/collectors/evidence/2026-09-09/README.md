# The run behind PR #271 — 2026-09-09

The evidence for the 18 services and 246 agent rows the site published in
[#271](https://github.com/johnnwilliams27/nibbin/pull/271). Preserved exactly as it ran — every
file here is byte-identical to the output of the commands below. Nothing was re-probed,
re-scored or edited: re-running would produce different numbers against subjects that have since
changed, and a score whose evidence cannot be inspected is the thing this project exists not to
publish.

## Provenance

| | |
|---|---|
| **`as_of` (the scoring instant)** | `2026-09-09T02:00:00Z` |
| `scored-endpoints.json` written at | `2026-09-09T10:46:12.869Z` |
| `a2a-battery.json` written at | `2026-09-09T10:35:40.707Z` |
| `mcp-battery.json` | produced earlier the same morning from the same transcript set |
| probe seed reproducible | yes — `TRUST_INDEX_PROBE_SEED` was set for every step |

`as_of` and "written at" differ on purpose, and the gap is not cosmetic. Observations decay:
availability has a 14-day half-life, so the same transcripts scored at 02:00 and at 10:40 give
76.94 and 76.93. The published numbers are the 02:00 ones, so that is the instant to reproduce
against.

## The commands, exactly as run

Run from `trust-index/packages/collectors`, with `TRUST_INDEX_PROBE_SEED` set.

```sh
# 1. The MCP behavioural battery, over the transcripts in ./transcripts
pnpm exec tsx scripts/assess.mts --i-have-approval \
  --transcripts <transcripts> \
  --out mcp-battery.json

# 2. The A2A behavioural battery, over the same transcripts
pnpm exec tsx scripts/run-a2a-battery.mts \
  --transcripts <transcripts> \
  --out a2a-battery.json \
  --max-skills 3 --concurrency 4

# 3. Score both protocols in one pass, at the published as-of
pnpm exec tsx scripts/score-marketplace.mts \
  --transcripts <transcripts> \
  --battery mcp-battery.json \
  --a2a-battery a2a-battery.json \
  --as-of 2026-09-09T02:00:00Z \
  --out scored-endpoints.json

# 4. Overlay onto the marketplace dataset
pnpm exec tsx scripts/merge-marketplace-assessments.mts --scored scored-endpoints.json
```

## What is here

| file | contents |
|---|---|
| `scored-endpoints.json` | 273 scored subjects, 42 published (MCP 13/173, A2A 29/100). Per subject: composite and interval, both coverage axes, the engine's own withholding reason, gates fired, harness gaps. |
| `mcp-battery.json` | MCP tool-invocation outcomes: every call, every observation, every skipped check with the reason it was skipped. |
| `a2a-battery.json` | A2A outcomes for 48 agents across 103 skills, plus the 43 skills the mutating-verb screen refused, each with its reason. |
| `transcripts/` | 273 probe transcripts (173 MCP, 100 A2A) — the raw readings everything above derives from. |

Only 18 of the 42 published subjects appear on the site; the rest are endpoints outside the
marketplace dataset's candidate pool. The scored file is the wider set on purpose, because the
denominator is part of the claim.

## What these files contain about our probe

Stated so nobody has to discover it: the request bodies here carry the per-subject values
`probeIdentity()` derives — the nonsense query, the injection token and its instruction phrasing,
the user-agent, and the identifiers `absentIdentifier()` builds from the nonsense query (the
`tokenId` values are ours, not anyone's credentials, which is why a secret scanner flags them).

Those values are HMAC-derived from a seed that is not in this repository, and they are
deterministic per subject, so they do not rotate between runs. Publishing them means the operators
probed here can recognise the same values next time. That is the known and documented limit of the
approach — `src/mcp/probe-identity.ts` says the derivation "limits the blast radius to one
subject; it does not make the values secret from that subject" — and the trade was made
deliberately in favour of an auditable published run.

If the probe values are ever rotated, rotate `TRUST_INDEX_PROBE_SEED`; every value in this
directory changes with it, and this run stays readable as the record of what was sent when.
