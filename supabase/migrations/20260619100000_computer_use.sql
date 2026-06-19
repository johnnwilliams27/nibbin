-- ─────────────────────────────────────────────────────────────────────────────
-- computer_use (browser) capability surface — design §4 / §4A / R9.
--
-- The computer_use surface is CODE-DEFINED (packages/runtime/src/browser.ts +
-- capabilities.ts): the six verbs (navigate/extract/screenshot/scroll/click/
-- type) live in the in-code CAPABILITY_REGISTRY, driven by an injected
-- BrowserDriver — they are NOT OAuth connector rows and need no connector grant.
-- A computer_use plan run is EPHEMERAL (plan_runs.plan jsonb; no roster row), so
-- it introduces NO new table and NO new column.
--
-- The only schema touch-point is the weight class: a computer_use plan runs at
-- the `computer_use` weight class (10×). That enum value ALREADY exists in the
-- runs.weight_class CHECK (20260611120000_m4_runtime_shop_scan.sql) and in the
-- credit-weight mapping. This migration is therefore ADDITIVE + DEFENSIVE only:
-- it asserts the enum still admits 'computer_use' so a future tightening of that
-- CHECK can never silently break browser runs. It changes no data and no shape.
--
-- DO NOT APPLY as part of this slice (per build instructions). Tracked here so
-- the dependency (weight_class must admit 'computer_use') is explicit and a
-- regression is caught at migrate time, not at runtime.
-- ─────────────────────────────────────────────────────────────────────────────

do $$
declare
  ok boolean;
begin
  -- Probe: does runs.weight_class accept 'computer_use'? (The 10× browser class.)
  -- We test the live CHECK constraint by attempting a constraint-validity query
  -- against the existing definition rather than inserting a row.
  select pg_get_constraintdef(c.oid) ilike '%computer_use%'
    into ok
  from pg_constraint c
  join pg_class t on t.oid = c.conrelid
  where t.relname = 'runs'
    and c.contype = 'c'
    and pg_get_constraintdef(c.oid) ilike '%weight_class%'
  limit 1;

  if ok is distinct from true then
    raise exception
      'computer_use bring-up: runs.weight_class CHECK does not admit ''computer_use'' — the browser surface (10x weight class) cannot run. Restore the enum value before applying.';
  end if;
end $$;

-- No DDL: the computer_use capability surface is fully code-defined. If a future
-- slice persists per-account browser credentials or a computer_use demand-signal
-- table (design §10 / §13), that table is added in its own migration.
