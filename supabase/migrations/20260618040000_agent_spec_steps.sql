-- Synthesis Slice 1: Composer/Planner output shape on agent_specs. Back-compat:
-- existing rows + template adoptions default to empty; only composed specs fill them.
alter table public.agent_specs
  add column if not exists steps jsonb not null default '[]'::jsonb
    check (jsonb_typeof(steps) = 'array'),
  add column if not exists persona_policy jsonb not null default '{}'::jsonb
    check (jsonb_typeof(persona_policy) = 'object');
