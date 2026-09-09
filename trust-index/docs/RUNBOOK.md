# Runbook

Operational procedures for the Agent Trust Index. Prose here follows SPEC 14A.

## Dev setup

Prerequisites: Node from `.nvmrc` (currently 22.22.2), pnpm 10.33.0 (the
version pinned in `package.json#packageManager`; `corepack enable` picks it
up), Docker for local Postgres, and Foundry v1.2.3 for contract work.

1. `cd trust-index`
2. `pnpm install --frozen-lockfile`
3. `pnpm install --ignore-workspace --frozen-lockfile --dir scripts` (ops
   tooling: eslint and copylint live in `scripts/`, outside the workspace
   globs, with their own lockfile)
4. Copy `env.example` to `.env` and fill values. The file is named
   `env.example` without a leading dot because the build environment denies
   writes to `.env*` paths; see NOTES-lead.md.
5. Local Postgres: `docker run -d --name trust-index-pg -e POSTGRES_PASSWORD=postgres -e POSTGRES_DB=trust_index -p 5432:5432 postgres:16`
6. `pnpm migrate` (runs `@trust-index/db` migrations against `DATABASE_URL`)

Everyday commands, all from `trust-index/`:

| Command | What it does |
|---|---|
| `pnpm typecheck` | Recursive `tsc --noEmit`, skips packages without the script |
| `pnpm lint` | Recursive per-package lint |
| `pnpm --dir scripts run lint` | Workspace-wide eslint, including SPEC 22 rules |
| `pnpm copylint` | SPEC 14A prose scan |
| `pnpm test` | Recursive vitest |
| `pnpm build` | Recursive build |
| `pnpm migrate` | Database migrations |
| `pnpm fixtures:generate` | Regenerate committed fixtures |

Every package must carry its own `vitest.config.ts` with an explicit
`include`. Without one, vitest walks up and finds the host repo's config.

## Migrations

`pnpm migrate` is idempotent and safe to rerun. CI runs it against a throwaway
`postgres:16` service container on every pull request (the `migrate-dry-run`
job), so a migration that cannot apply cleanly from an empty database fails
before merge. Never edit an applied migration; add a new one.

## Fixtures and golden data

Fixtures under `fixtures/` are the contract between tracks and with anyone
reproducing our scores (SPEC 22). CI regenerates them with
`pnpm fixtures:generate` and fails on any git diff (the `golden-diff` job).

Golden update procedure, in order:

1. Make the methodology or generator change.
2. Bump the methodology version if score outputs change (SPEC 12, SPEC 23).
3. Run `pnpm fixtures:generate` locally.
4. Review the diff line by line. Every changed expected value must be
   explained by the change you made. An unexplained diff is a bug, not an
   update.
5. Commit the regenerated fixtures together with the code change and a commit
   message stating why outputs moved.

Never regenerate fixtures to make a red build green without step 4.

## CI

Workflow: `.github/workflows/trust-index.yml`, path-filtered to
`trust-index/**` so it never runs for host-repo changes, and the host CI never
runs for ours. Jobs: typecheck, lint (per-package, workspace eslint, copylint),
test, build, golden-diff, migrate-dry-run (skipped until `packages/db`
exists), contracts (skipped until `contracts/foundry.toml` exists, forge
pinned to v1.2.3), secret-scan (gitleaks over the whole repo).

Branch protection is a repo-settings step the author must do by hand once the
workflow has run at least once: Settings, Branches, protect the integration
branch, mark every job above as a required status check, and disallow direct
pushes (SPEC 24). Skipped jobs report success, so the conditional jobs can be
required from day one. Organization-owned repos also need a
`GITLEAKS_LICENSE` secret for gitleaks-action; personal repos do not.

## Incident response: a wrong score

From SPEC 23. Order matters; suppression is always safe.

1. Suppress the affected agents immediately through the manual override
   table. There is no admin UI (SPEC 24): the override is a CLI operation
   against production, and every override is a row with an author, a
   timestamp, and a written reason. The reason is published.
2. Publish a note on `/methodology` with the date range and the scope of the
   error.
3. Fix the bug, bump the methodology version, recompute.
4. Historical anchors stay. Never rewrite history; publish a correction that
   references the anchored root that contained the error.
5. Lift the overrides once recomputed scores are verified, and record the
   lift the same way the suppression was recorded.

## Backup and restore

The chain is the backup; a full rebuild from genesis is the recovery path and
takes hours. Supporting layers (SPEC 23):

- Daily Postgres snapshot, 30-day retention.
- Raw log cache retained separately, so a rebuild does not re-fetch from RPC.
  Re-fetching is the expensive part.
- Published dumps are an off-site copy of every score ever emitted.

Restore test procedure. Run it once before launch and after any storage
change; an untested restore is not a restore.

1. Provision an empty database, separate from every live environment.
2. Restore the latest snapshot into it and run `pnpm migrate`; it must
   report nothing to do.
3. Run the reconciliation job against the restored database; drift must be
   within the 0.1% alert threshold.
4. Separately, rebuild an index from the raw log cache alone into another
   empty database and diff score outputs against the restored snapshot.
5. Record the wall-clock time of both paths in this file.

Restore test status: not yet performed. No live environment exists; see
ENVIRONMENTS.md.

## Scheduled jobs and alerts

The job table and alert thresholds live in SPEC 23 and are not duplicated
here. None of the jobs are wired yet; they land with `apps/jobs` and the
staging environment (E2, deferred; see ENVIRONMENTS.md).
