# Track E notes (ops)

Running log per SPEC 18.0. Track E owns `.github/workflows/trust-index.yml`,
`scripts/`, `eslint.config.mjs`, and the RUNBOOK, SECURITY, ENVIRONMENTS docs.

## Decisions

- **CI is one workflow, path-filtered.** `.github/workflows/trust-index.yml`
  triggers only on `trust-index/**` paths (pull_request, plus push to
  `trust-index/**` and `feat/trust-index**` branches). The host repo's ci.yml
  never sees our changes and vice versa.
- **Presence job instead of job-level hashFiles.** `hashFiles()` in a
  job-level `if` evaluates before checkout and always returns empty. A small
  `presence` job checks out, evaluates `hashFiles()` at step level, and
  exports outputs; `migrate-dry-run` and `contracts` key off those. Skipped
  jobs count as success for required checks, so all jobs can be marked
  required before Tracks A and C land.
- **Every job installs with `--frozen-lockfile`** and uses pnpm 10.33.0 plus
  the `.nvmrc` node version. Recursive scripts use `--if-present`, so
  half-built packages do not break CI.
- **Forge pinned to v1.2.3** in CI, matching the version installed in this
  dev environment (`forge --version`).
- **Ops deps live in `scripts/package.json`** (`@trust-index/ops`), installed
  standalone with `--ignore-workspace` and its own `pnpm-lock.yaml`, because
  the workspace globs are `packages/*` and `apps/*` only. Pinned exact:
  eslint 10.9.1, typescript-eslint 8.68.0, typescript 5.7.3.
- **eslint.config.mjs resolves typescript-eslint from `scripts/node_modules`**
  via `createRequire` plus dynamic import, not from any ambient node_modules.
  Without this, the import would silently resolve to the HOST repo's
  typescript-eslint when present locally and then fail in CI.
- **SPEC 22 rules verified live.** A planted probe file in packages/scoring
  produced 4 errors (Date.now, zero-arg new Date(), Math.random, node:fs
  import), then was deleted. Clean tree lints green.
- **copylint severity split.** Errors (exit 1) for hits under `docs/` and
  `apps/web/`; warnings (exit 0) elsewhere. SPEC.md and NOTES* files exempt
  because they quote the banned words to name them. `landscape` is flagged on
  every use, not just after "evolving"; simpler and almost always right.
- **Host repo isolation.** Added one line to the host
  `/home/user/nibbin/eslint.config.mjs` ignores: `'trust-index/**'`. Host
  `npm run lint` verified green after the change (it was also green
  immediately before, once host node_modules were installed; before that the
  host lint failed in this environment with ERR_MODULE_NOT_FOUND because
  dependencies had never been installed here).
- **Host tsconfig/vitest do not pick up trust-index.** Host typecheck is an
  explicit `tsc -p` list; host vitest `include` globs (`packages/*`,
  `apps/*`, `tests/**`, `scripts/**`) are rooted at the host repo and do not
  reach `trust-index/`. No restructuring needed. Fragility note: if the host
  ever switches to bare `**/*.test.ts` globs it will start collecting our
  tests; the per-package vitest configs (lead's rule) keep our side safe in
  the other direction.

## Requests to the lead

- `scripts/` is not a workspace member, so root `pnpm lint` does not reach
  the workspace-wide eslint run. Either add `scripts` to
  `pnpm-workspace.yaml` globs (then `@trust-index/ops` joins `pnpm -r`), or
  add a root script `lint:eslint": "pnpm --dir scripts run lint"` to the
  root package.json. CI runs it explicitly either way, so this is about local
  ergonomics, not coverage.
- Root `package.json` already wires `copylint`; no change needed there.
- When Track D writes user-facing copy, `pnpm copylint` currently reports
  zero hits; keep it that way per SPEC 14A.
- Branch protection (required checks) and the optional `GITLEAKS_LICENSE`
  secret are author actions in repo settings; listed in RUNBOOK.md.

## E2 status

Deferred: no hosting credentials exist in this environment. ENVIRONMENTS.md
carries the staging and production bring-up checklists.
