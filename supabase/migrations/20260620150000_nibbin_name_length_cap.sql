-- #42: cap nibbins.name at 150 chars so a long name can never brick the drip
-- worker (notifications.title ≤ 200; composed titles add " graduated" etc.).
-- The adopt_nibbin RPC already btrim()s; this adds a hard CHECK and a
-- truncating update to bring any existing over-long rows into compliance.

-- Truncate any existing rows that exceed 150 chars before adding the constraint.
update public.nibbins
   set name = left(name, 150)
 where char_length(name) > 150;

-- Also enforce in adopt_nibbin: the btrim() already ran on the insert value;
-- add a CHECK so the column itself is the authority.
alter table public.nibbins
  add constraint nibbins_name_max_length check (char_length(name) <= 150);
