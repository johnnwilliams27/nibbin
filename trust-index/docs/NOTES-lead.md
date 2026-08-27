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

## Integration pass (2026-08-27)

- All five tracks landed and their gates ran green: A1 (migrations +
  fixture round-trip on Postgres 16), B1/B2 (branch coverage, golden and
  two-process determinism), C1/C2 (anvil inclusion proof, fail-closed truth
  table, 100-agent batch at 7,365,438 gas), D1 (recompute byte-for-byte
  against the engine on all fixtures), D2 (suppressed pages render zero
  digits; intervals render elsewhere), E1 (CI, lint, copylint).
- Scoring port adapted to Track B's real export surface (score returning
  result plus canonical bytes); the D1 gate executes instead of skipping.
- Fixture retune: thin-same-day-cohort (wallet ages past the ramp,
  portfolio share 0.6) now lands thin at score 60.88 [24.32, 97.45],
  n_eff 0.84; strong-diverse (38 aged reviewers, feedback within a 107-day
  span) lands strong at 82.81 [70.12, 95.50], n_eff 27.96. Track B's
  original shortfall arithmetic preserved in NOTES-track-b.md. Goldens
  regenerated; manifest golden fields now point at the golden files.
- Eslint I/O ban scoped to the engine (src minus cli.ts); wall-clock and
  nondeterminism bans still cover the whole package, tests included.
- Workspace totals: 301 tests green (types 7, scoring 158, db 21,
  indexer 60, web 55) plus 31 forge tests; copylint and eslint clean;
  next build clean offline.

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
