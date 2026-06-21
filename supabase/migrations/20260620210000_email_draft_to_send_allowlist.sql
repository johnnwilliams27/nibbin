-- P0-1: `email.draft` was retired in favor of `email.send` (the action level now
-- decides draft-vs-act). `agent_specs` rows are immutable once adopted, so
-- already-adopted email Nibbins still carry `email.draft` in tools_allowlist
-- (and possibly steps[].capability). The runner's allowlist gate
-- (`!toolsAllowlist.includes(step.capability)`) now kills every such run because
-- the primitives yield `email.send`. This migration rewrites the stored rows.
--
-- Idempotent: re-running is a no-op (the WHERE clauses only match rows that
-- still reference `email.draft`, and the dedup collapses any duplicate
-- `email.send` produced when both were present).

-- 1) tools_allowlist text[]: rewrite email.draft -> email.send, dedup.
update public.agent_specs s
set tools_allowlist = sub.deduped
from (
  select
    id,
    array(
      select distinct (case when t = 'email.draft' then 'email.send' else t end)
      from unnest(tools_allowlist) as t
    ) as deduped
  from public.agent_specs
  where 'email.draft' = any(tools_allowlist)
) as sub
where s.id = sub.id;

-- 2) steps jsonb (array of {capability, inputs, ...}): rewrite any element whose
--    capability is 'email.draft' to 'email.send'. Only touch rows that actually
--    contain such an element (idempotent + avoids rewriting unrelated rows).
update public.agent_specs s
set steps = sub.rewritten
from (
  select
    id,
    coalesce(
      jsonb_agg(
        case
          when elem->>'capability' = 'email.draft'
            then jsonb_set(elem, '{capability}', '"email.send"'::jsonb)
          else elem
        end
        order by ord
      ),
      '[]'::jsonb
    ) as rewritten
  from public.agent_specs,
       lateral jsonb_array_elements(steps) with ordinality as e(elem, ord)
  where jsonb_typeof(steps) = 'array'
    and steps @> '[{"capability": "email.draft"}]'::jsonb
  group by id
) as sub
where s.id = sub.id;
