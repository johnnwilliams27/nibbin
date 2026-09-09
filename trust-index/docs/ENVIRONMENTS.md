# Environments

The SPEC 21 matrix, restated as the operating reference. Three environments;
never share a database or an RPC key between them.

| | Local | Staging | Production |
|---|---|---|---|
| Chain | Base Sepolia | Base mainnet | Base mainnet |
| Registry addresses | testnet (`0x8004A818...` prefix) | mainnet | mainnet |
| Database | Local Postgres (Docker) | Separate Neon branch | Neon primary |
| RPC key | Free tier | Separate paid key | Separate paid key |
| Indexer | Manual runs | Continuous, may lag | Continuous, alerted |
| Public API | Off | Auth-gated | Open, rate limited |
| Anchoring | Off | Off | On |

Rules that survive any tooling change:

- Production database credentials never exist on a developer machine.
- Staging runs the same mainnet data as production so scoring changes can be
  diffed against production output before deploy. This is the main value of
  staging in this project.
- A methodology version bump requires a staging diff report showing which
  agents changed tier and why, reviewed before production deploy.

## What exists today

Local only. There is no staging and no production. CI runs against throwaway
containers (postgres:16 service) and the committed fixtures. The registry
addresses in `packages/types` are unverified against the official contracts
repo; verify before any live indexing run (see NOTES-lead.md).

## E2 gate: deferred

The Track E stage E2 gate ("staging serves mainnet data with auth gate") is
explicitly deferred. This build environment holds no hosting credentials: no
Vercel account, no Neon or Supabase project, no RPC keys, no Upstash, no
domain. Standing up staging requires the author to create those accounts
(SPEC 15 lists them with cost estimates) and cannot be done from here.

## Staging bring-up checklist (pending)

- [ ] Create Neon project; create a `staging` branch separate from primary.
- [ ] Buy paid-tier RPC access (Alchemy or QuickNode) with a staging-only key.
      Free tiers will not complete the backfill (SPEC 15).
- [ ] Basescan API key (free tier).
- [ ] IPFS gateway account (Pinata or web3.storage), staging token.
- [ ] Upstash Redis for rate limiting, staging instance.
- [ ] Vercel project; set staging environment variables from `env.example`.
      Names follow the `RPC_URL_{CHAIN}` and `ETHERSCAN_API_KEY_{CHAIN}`
      patterns.
- [ ] Provider-side restrictions on every key: domain allowlist for
      browser-facing keys, IP allowlist where supported (SPEC 24).
- [ ] Run the backfill into the staging database; reconcile counts per the
      A2 gate before calling it live.
- [ ] Auth-gate the staging API (SPEC 21: staging is never open).
- [ ] Wire the merge-to-main deploy: deploy staging, run the scoring diff
      against production output, publish the report as a PR comment
      (SPEC 23). Until production exists, the diff step is a no-op.

## Production bring-up checklist (pending, after staging)

- [ ] Neon primary with daily snapshot, 30-day retention.
- [ ] Production RPC key, separate from staging.
- [ ] Sentry (optional) and the SPEC 23 alert list wired to a channel the
      author reads.
- [ ] Production deploy is manual and requires a reviewed staging diff
      report (SPEC 23).
- [ ] Anchoring wallet setup per SPEC 15: fresh hot signer, funded ~$50,
      key present only in the jobs runner, per-day transaction cap,
      allowlist of exactly the AnchorRegistry and ScoreOracle addresses.
      Anchoring stays off until stage G6.
- [ ] Perform and record the restore test (RUNBOOK.md) before launch.
- [ ] Legal pages live (SPEC 16): terms, privacy, methodology with version
      history, correction request process.
