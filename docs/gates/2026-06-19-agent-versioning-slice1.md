# Adversarial gate — Agent Versioning Slice 1 (SPEC §18.2 / R52)

- **Branch / PR:** `feat/agent-versioning-slice1` → `main`
- **Scope:** New `agent_specs.previous_spec_id` + `retune_nibbin` RPC (migration
  `20260619300000`), the `retuneNibbin`/`loadCurrentSpecForRetune` server actions, and a "Tune"
  UI on the Nibbins roster. Implements the core of §18.2: "Edit/tune → new spec version
  (snapshots stay immutable) + migrate the running Nibbin … never silently mutating."
- **Out of scope (Slice 2):** re-diagnosis (diff from a fresh field study), version-history
  browser/rollback UI, natural-language re-tune.

## Design / invariants
- **Immutable snapshots:** a re-tune NEVER updates an existing `agent_specs` row. `retune_nibbin`
  inserts a NEW row (version = current+1, `previous_spec_id` = current, `source_plan_run_id` =
  NULL to avoid the provenance unique index), then re-points `nibbins.spec_id`. The old row is
  retained as history. `authenticated` stays revoked from insert/update/delete on `agent_specs`.
- **Atomic:** spec mint + Nibbin migration happen in one RPC under `private.lock_account`.
- **Trust boundary:** `retune_nibbin` is **service_role-only** (exactly like `adopt_nibbin`). The
  app-side validation gate — `validateComposedSpec` (fail-closed) + `validateTriggerGraph` cycle
  check — runs in the `retuneNibbin` action BEFORE the RPC; the service-role grant prevents a JWT
  caller from minting an unvalidated spec.
- **Auth:** `appSession()` derives the account (never client-supplied); ownership verified by
  `.eq('account_id', accountId)`; the RPC re-checks nibbin/account match defensively.

## Validation-set note (reviewed)
`accountSpecs` returns all non-sleeping account specs (which includes the current Nibbin's
current spec) and validation runs `[...existing, candidate]`. This is safe: `validateTriggerGraph`
keys nodes by `templateKey ?? displayName`, so the current spec and its near-identical candidate
collapse to the same node (and a spec never triggers its own replacement), so no false cycle is
introduced; the redundant `validateSpec` pass on the already-valid current spec is a no-op.

## Tests
- `tests/rls/retune-nibbin.test.ts` (live PG, CI): service_role retune mints version+1 with
  `previous_spec_id` set, migrates the Nibbin, leaves the OLD spec present + unchanged, writes the
  audit row; `authenticated`/`anon` denied; nibbin/account mismatch rejected; clients still can't
  write `agent_specs`.
- `apps/web/app/app/nibbins/[id]/retune-actions.test.ts`: valid edit calls the RPC once with the
  authed account; an invalid spec (unknown capability) does NOT call the RPC; a non-owned Nibbin
  is rejected before the RPC.

## CI / local checks
- Migration applied + structurally verified on **dev** (column added; 6-arg RPC; `service_role`
  execute = true, `authenticated` = false). Staging/prod applied at merge.
- tsc: the only errors on the new files are `Cannot find module '@nibbin/runtime'`, a known
  worktree-node_modules artifact shared by 49 files (incl. `adopt.ts`, `engine.ts`, all planner
  files) that are on green main — CI's fresh install resolves it. ESLint clean. retune-actions
  tests 3/3.

## UI note
The Composer step-editor is coupled to the diagnosis `DiagnosisWorkflow` context, so RetuneDialog
ships a simpler-but-complete editor (display name + reorder/remove steps) — enough to exercise the
versioning machinery end-to-end. A richer editor can reuse a decoupled step-editor later.

## Verdicts
(appended after the reviewer pass)
