# Adversarial gate — Fleet demand-gap + connector-blocker signals (instrument + aggregate)

- **Branch / PR:** `feat/fleet-instrumentation` → `main`
- **Scope:** the last two Tier-2 fleet signals, end-to-end —
  - **Instrumentation:** 2 new `product_events` (`capability_unfulfilled`, `connector_blocked`) added
    to the SQL allowlist (migration `20260620120000`) + the TS allowlist (`packages/runtime/src/events.ts`);
    emitted best-effort at the Composer path + the runtime layer.
  - **Aggregates:** `demand_gap_signals` + `connector_blocker_signals` views/RPCs (migration
    `20260620130000`) + two staff scoreboard panels + tests.
- Completes the fleet-signal set ([[project_nibbin_analytics_platform]]); same pattern as
  capability_task_performance / shop_template_performance.

## Instrumentation (emit points — best-effort, structural-only)
- `capability_unfulfilled` `{capability, reason}` — emitted from `apps/web/app/app/diagnosis/actions.ts`
  (`synthesizeForWorkflow`) when `composeSpec` returns "can't build": `reason='no_capability'` (no
  registry capability maps the workflow) or `'connector_not_connected'` (capability exists but a
  required connector isn't granted). `composeSpec` surfaces the structured `unfulfilled` reason; the
  action emits via `SupabaseEventSink`. Wrapped in try/catch — never alters the compose/adopt result.
- `connector_blocked` `{connector, reason}` — emitted from `apps/web/lib/runtime/engine.ts`
  (`triggerNibbinRun`/`buildEffectsExecutor`) where connector failures surface:
  `reason='not_connected'` (connection status ≠ active), `'auth_failed'` (`ConnectorRequestError`
  kind=auth after refresh failed), `'velocity_cap'` (send cap). Catches add telemetry then RE-THROW —
  run semantics unchanged. `packages/connectors` stays pure (no Supabase coupling); the error type
  `ConnectorRequestError` (with `.provider`/`.kind`) is the structured source.
- **Props are structural ids/codes only** (capability ids, connector names, reason codes) — never
  content/PII, per the `events.ts` contract.

## Aggregates (same privacy model as the other fleet signals)
Both views read `product_events`, join `accounts` + require `model_contribution_enabled` (opt-out),
30/90-day window, group by (capability|connector, reason), `HAVING count(distinct account_id) >= 5`
(k-anonymity). `security_invoker` views revoked from product roles; SECURITY DEFINER `_read` RPCs
service_role-only; scoreboard panels behind the existing `getStaff()` gate. No automated consumer.

## Tests
- RLS (`tests/rls/fleet-demand-blocker.test.ts`, live PG): demand + blocker each expose a ≥5-account
  signal, suppress <5, exclude opted-out from the cohort; RPCs + views staff/service-role only.
- `apps/admin/lib/scoreboard/read.test.ts`: loaders map/throw-on-drift, shape guards.
- Instrumentation: `events.ts` allowlist test; composer `unfulfilled` reason tests; engine telemetry
  tests (velocity_cap/auth emit; rate-limit doesn't; a broken sink never masks the run error).

## CI / local note
Both migrations applied + smoke-tested on dev (events emit; views valid). Full vitest suite green
(1893). apps/web worktree tsc shows `connector_blocked not in ProductEventName` + `claims not in
RunnerDeps` errors — these are the known stale-symlink artifact (`node_modules/@nibbin/runtime` →
the main checkout, which lacks the branch's new event names AND #196's `RunnerDeps.claims`; the
branch's own packages have both, count-verified). CI resolves `@nibbin/runtime` to the branch →
green (same class confirmed on prior PRs).

## Verdicts (real 2-reviewer pass — both PASS, no P1/P2)
- **Red-team (opus): PASS** — emission best-effort + run-semantics preserved (connector_blocked re-throws the
  original error after telemetry); opted-out excluded from counts AND cohort; staff-only; service-role emit
  bypass of the membership gate is correct (authenticated path still gated). k-anon ≥5 cells can't de-anon
  (tiny fixed enums). P3: `workflow.key` (the `no_capability` value) isn't slug-constrained (latent —
  branch was unreachable). P3 info: props also carry own-userId (harmless, not aggregated). P3 nit: await on
  emit adds latency on blocked sends (delays, never alters).
- **Logic-skeptic (opus): PASS** — aggregate math correct (k-anon over accounts, opt-out inner-join,
  window anchor, last_seen); connector_blocked has no double/missed-emit and re-throw preserves failure;
  RPC↔reader contract + RLS test sound; confirmed the apps/web tsc errors are the stale-symlink artifact
  (branch packages have the names + RunnerDeps.claims → green in CI). P3: `no_capability` was dead code
  (mapWorkflowToPrimitive never returns null → always connector_not_connected; unserved categories
  mislabeled). P3: views didn't filter `reason is not null` → a malformed event's NULL-reason group could
  throw the scoreboard loader.

### Fixes applied (the two actionable P3s — they intersect)
- **Demand-gap labeling + privacy:** the `prims.length===0` branch now labels `no_capability` (emitting the
  structural `workflow.category` enum — NOT the free-ish `workflow.key`) for categories with no genuine
  primitive (social/docs/crm/other), and `connector_not_connected` (with the registry primitive id) for
  served categories (email/payments/calendar). This makes `no_capability` correctly reachable AND emits
  only structural values by construction (closes the red-team `workflow.key` footgun). Test added.
- **reason-null robustness:** both views now also filter `e.props->>'reason' is not null`, so a malformed
  event can't form a NULL-reason group that fails the loader's shape guard. Views re-applied on dev.

**Gate verdict: PASS** after the two fixes. compose tests 22; scoreboard tests 55; full suite green.
