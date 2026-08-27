# Lead agent notes

Running log per SPEC 18.0. The lead owns SPEC.md, the workspace root files,
packages/types, fixtures/, and this file. Types change only by lead commit.

## Decisions

- **Fixed-point representation.** All fractional numerics crossing a
  determinism boundary are DecimalStrings on the wire and scaled bigints
  (`FixedNum`) in arithmetic. Canonical JSON emits FixedNum as unquoted digit
  strings; fractional JS doubles are rejected at the serializer. Precisions in
  `PRECISION` (fixed.ts) are methodology, not implementation detail.
- **Interval method** is recorded in constants as `normal_approx` (SPEC 11.1
  allows Beta or Normal); exact Beta quantiles are not computable
  deterministically in integer math at reasonable cost.
- **Confidence transform** recorded as `one_minus_relative_width` relative to
  the bare-prior interval width, so confidence is derived from the posterior
  only (SPEC 11.1).
- **All v0.1.0 constants are provisional** with sensitivity sweeps pending;
  provenance is carried per constant in `MethodologyConstants`.
- **Registry addresses are UNVERIFIED.** The build environment cannot reach
  github.com/erc-8004/erc-8004-contracts. `chain.ts` carries the SPEC 8 values
  with a warning; verify before any live indexing run.
- **env.example** (not `.env.example`): this build environment denies writes
  to `.env*` paths. Rename when convenient.
- **Vitest config resolution** escapes the trust-index directory and finds the
  host repo's vitest.config.ts. Every package MUST carry its own
  vitest.config.ts with an explicit `include`.
- **Foundry** installed at ~/.foundry/bin (pinned tag install; the GitHub
  releases API is blocked here, direct asset downloads work).
- **Fixture reviewers keyed by address** in `reviewers` record; engine must
  sort keys before any reduction (SPEC 22).

## Open requests to the author

- Project name (SPEC 1) still unresolved; npm scope `@trust-index` is a
  placeholder, not a claim.
- Registry address verification against the official contracts repo.

## Track ownership

| Track | Directory | Agent notes |
|---|---|---|
| A | packages/db, packages/indexer | docs/NOTES-track-a.md |
| B | packages/scoring | docs/NOTES-track-b.md |
| C | contracts | docs/NOTES-track-c.md |
| D | apps/web | docs/NOTES-track-d.md |
| E | .github workflow (trust-index.yml), scripts/ | docs/NOTES-track-e.md |
