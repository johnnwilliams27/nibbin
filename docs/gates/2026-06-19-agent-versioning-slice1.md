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

## Verdicts (real 3-reviewer pass on the diff)
- **Red-team (opus): PASS** (versioning surface) — account never client-supplied (triple-gated:
  appSession + scoped ownership query + SQL account re-check under lock); validation gate cannot
  be JWT-bypassed (RPC service_role-only, verified by revoke + RLS test); existing spec rows
  immutable (authenticated revoked from write; RPC only INSERTs); `source_plan_run_id=NULL`
  correctly avoids the provenance uniq index; no tier-cap bypass; SQL fully parameterized.
- **Logic-skeptic (opus): PASS** — confirmed the validation double-count is harmless (no spec
  uses `nibbin:*` triggers → empty edge map → no false cycle; nodes dedupe by
  templateKey/displayName; no cross-spec duplicate-trigger check), candidate↔SQL field parity
  matches, version monotonic, RPC atomic under one txn, lineage correct.
- **Claims+cost (sonnet): adjudicated** — RPC param contract matches (6/6), migration grant
  service_role-only + timestamp safe, tests non-vacuous, no LLM/N+1 in the retune path. It
  returned BLOCK on two items, both adjudicated:
  - "Critical: gmail-onboarding privacy revert" — **NOT real**: a base-diff artifact. The
    branch was cut before #191 (sweep hardening) merged, so the 2-dot `origin/main..HEAD` diff
    showed #191's changes as deletions. The branch never touches `gmail-onboarding.ts`; merging
    main back in restored them (verified: `consentActive`/`isSensitiveSample` present). No revert
    ships.
  - "Important: accountSpecs double-count" — **FIXED**: `accountSpecs` now excludes the Nibbin
    being retuned (`.neq('nibbins.id', excludeNibbinId)`), so the validated graph is the
    post-retune set `[...other live specs, candidate]`. Removes the latent footgun three
    reviewers flagged.
  - Non-blocking: "Tune" appears on all stages incl. egg (product choice, no spec gate);
    test dynamic-import pattern (works via `clearAllMocks`); pre-existing `20260619100000`
    timestamp collision (not ours).

**Gate verdict: PASS** after the one real fix (validation-set exclusion). The privacy "Critical"
was a diff artifact, not a code change.
