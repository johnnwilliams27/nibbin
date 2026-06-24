# Company Brain Foundation (F1 + F2) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the memory data-model side tables (evidence/Sources, provenance link, append-only history, conflict-flag seam) and the generic propose→review→approve→write loop that every later Company Brain chunk plugs into.

**Architecture:** `grove_memory` stays the free-text JSONB **value** store; new side tables keyed by `field_key` add evidence, provenance/staleness, append-only history, and conflict flags (F1). A `proposals` table plus two security-definer RPCs implement the review loop — producers (service role) propose; an account member approves, and apply-on-approve is the *only* new curated-write path, always logged (F2). One additive migration; the Memory page, save RPC, and draft injection are unchanged.

**Tech Stack:** Postgres / Supabase migrations (`supabase/migrations/`), plpgsql `security definer` RPCs with `set search_path = ''`, RLS via `private.is_account_member()`, append-only via `private.raise_append_only()`, vitest + `tests/rls/harness.ts` (`RlsHarness` runs adversarial queries as the real PostgREST roles).

## Global Constraints

- **Single migration file:** `supabase/migrations/20260622140000_company_brain_foundation.sql` (latest existing is `20260622130000`). Each task appends its DDL to this one file.
- **RLS on every new table:** `enable row level security`; `select` policy `using ((select private.is_account_member(account_id)))`; `revoke insert, update, delete, truncate, references, trigger ... from authenticated`; `revoke all ... from anon`.
- **Writes go through security-definer RPCs or service role only.** Clients never write these tables directly.
- **No curated-layer write without a logged human approval** (COMPANY-BRAIN §12). Apply-on-approve appends history *and* an `audit_log` ratification.
- **Append-only history:** `grove_memory_history` carries a `before update or delete` trigger calling `private.raise_append_only()`.
- **Bounded sizes** mirroring `grove_memory` (e.g., `proposed_value <= 6000`).
- **field_key namespace:** `facts`, `pricing`, `policies`, `faq`, `voice` (sections) plus `hard_rules`, `notes`.
- **Test DB:** the RLS suite needs Postgres at `RLS_DATABASE_URL` (or `localhost:54329`); `RlsHarness.reset()` recreates `public` and re-applies `supabase/migrations`. Run a single file with `npx vitest run <path>`. Suites `describe.skipIf(!dbAvailable)`, so confirm the DB is up before relying on green.
- **Storage bucket deferred to P2:** F1 ships the `sources.storage_path` column only; the private `brain-sources` bucket + policies are created when document upload lands (P2). No bucket work here.
- After all tasks: apply the migration to **dev, staging, and prod** (Task 5) per project convention.

---

### Task 1: F1 side tables, append-only history, RLS

**Files:**
- Create/append: `supabase/migrations/20260622140000_company_brain_foundation.sql`
- Test: `tests/rls/company-brain-foundation.test.ts`

**Interfaces:**
- Produces tables: `public.sources`, `public.field_evidence`, `public.field_meta`, `public.grove_memory_history`, `public.field_flags`. Later tasks/chunks consume these.

- [ ] **Step 1: Write the failing test** — `tests/rls/company-brain-foundation.test.ts`

```ts
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { RlsHarness } from './harness';

const dbAvailable = await RlsHarness.probe();
if (!dbAvailable && !process.env.CI) {
  console.warn('[rls] no database — skipping company-brain foundation suite');
}

const UID_A = 'a1111111-7777-4777-8777-777777777777';
const UID_B = 'b2222222-7777-4777-8777-777777777777';

describe.skipIf(!dbAvailable)('Company Brain Foundation — F1 schema + RLS', () => {
  const h = new RlsHarness();
  let accountA = '';
  let accountB = '';
  const asA = { kind: 'authenticated', uid: UID_A } as const;
  const asB = { kind: 'authenticated', uid: UID_B } as const;
  const anon = { kind: 'anon' } as const;
  const service = { kind: 'service_role' } as const;

  beforeAll(async () => {
    await h.reset();
    await h.sql(`insert into auth.users (id, email) values ($1,'a@ex.test'),($2,'b@ex.test')`, [UID_A, UID_B]);
    for (const [who, uid] of [[asA, UID_A], [asB, UID_B]] as const) {
      await h.as(who, async (c) => {
        await c.query(`insert into public.users (id, email) values ($1,$2)`, [uid, `${uid}@ex.test`]);
      });
    }
    accountA = await h.as(asA, async (c) => (await c.query(`select public.create_account_with_owner('A') as id`)).rows[0].id);
    accountB = await h.as(asB, async (c) => (await c.query(`select public.create_account_with_owner('B') as id`)).rows[0].id);
  });
  afterAll(async () => { await h.close(); });

  it('a member reads only their own sources; cross-account reads nothing', async () => {
    await h.as(service, async (c) => {
      await c.query(`insert into public.sources (account_id, kind, title) values ($1,'document','A rate sheet')`, [accountA]);
    });
    const aRows = await h.as(asA, async (c) => (await c.query(`select title from public.sources`)).rows);
    expect(aRows).toEqual([{ title: 'A rate sheet' }]);
    const bSeesA = await h.as(asB, async (c) => (await c.query(`select * from public.sources where account_id=$1`, [accountA])).rowCount);
    expect(bSeesA).toBe(0);
  });

  it('clients cannot write sources directly', async () => {
    await expect(
      h.as(asA, (c) => c.query(`insert into public.sources (account_id, kind, title) values ($1,'document','forged')`, [accountA])),
    ).rejects.toThrow(/permission denied|row-level security/);
  });

  it('grove_memory_history is append-only — even for the service role', async () => {
    await h.as(service, async (c) => {
      await c.query(
        `insert into public.grove_memory_history (account_id, field_key, old_value, new_value, version, change_source)
         values ($1,'pricing',null,'$200',1,'manual')`, [accountA]);
    });
    await expect(
      h.as(service, (c) => c.query(`update public.grove_memory_history set new_value='x' where account_id=$1`, [accountA])),
    ).rejects.toThrow(/append-only/);
    await expect(
      h.as(service, (c) => c.query(`delete from public.grove_memory_history where account_id=$1`, [accountA])),
    ).rejects.toThrow(/append-only/);
  });

  it('every new table has RLS enabled', async () => {
    const r = await h.sql(`
      select c.relname from pg_class c join pg_namespace n on n.oid=c.relnamespace
      where n.nspname='public' and c.relkind='r' and not c.relrowsecurity
        and c.relname in ('sources','field_evidence','field_meta','grove_memory_history','field_flags')`);
    expect(r.rows).toEqual([]);
  });
});
```

- [ ] **Step 2: Run the test, verify it fails**

Run: `npx vitest run tests/rls/company-brain-foundation.test.ts`
Expected: FAIL — `relation "public.sources" does not exist`.

- [ ] **Step 3: Append the F1 DDL** to `supabase/migrations/20260622140000_company_brain_foundation.sql`

```sql
-- Company Brain Foundation (F1): evidence/Sources store, typed claim->evidence
-- link, per-field provenance/staleness, append-only curated history, and the
-- conflict-flag seam. Side tables around grove_memory (the value store stays
-- the free-text JSONB it is). Conventions follow M1/M7: RLS member-read, zero
-- direct client writes, bounded sizes.

-- 1.1 sources — the evidence / Repository store
create table public.sources (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references public.accounts (id) on delete cascade,
  kind text not null check (kind in ('document','connector_artifact','observation','manual')),
  title text not null check (char_length(title) <= 300),
  storage_path text check (storage_path is null or char_length(storage_path) <= 1024),
  origin jsonb not null default '{}'::jsonb check (jsonb_typeof(origin)='object' and pg_column_size(origin) <= 16384),
  source_tier smallint not null default 50 check (source_tier between 0 and 100),
  captured_at timestamptz not null default now(),
  redaction_status text not null default 'clean' check (redaction_status in ('clean','redacted','quarantined')),
  created_at timestamptz not null default now()
);
create index sources_account_captured_idx on public.sources (account_id, captured_at desc);
create index sources_account_kind_idx on public.sources (account_id, kind);

-- 1.2 field_evidence — typed claim->evidence link (many-to-many)
create table public.field_evidence (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references public.accounts (id) on delete cascade,
  field_key text not null check (char_length(field_key) <= 64),
  source_id uuid not null references public.sources (id) on delete cascade,
  relationship text not null default 'supports' check (relationship in ('supports','contradicts','superseded')),
  created_at timestamptz not null default now(),
  unique (account_id, field_key, source_id)
);
create index field_evidence_field_idx on public.field_evidence (account_id, field_key);

-- 1.3 field_meta — per-field staleness anchor (one row per field)
create table public.field_meta (
  account_id uuid not null references public.accounts (id) on delete cascade,
  field_key text not null check (char_length(field_key) <= 64),
  last_reviewed_at timestamptz,
  primary key (account_id, field_key)
);

-- 1.4 grove_memory_history — append-only per-field trail
create table public.grove_memory_history (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references public.accounts (id) on delete cascade,
  field_key text not null check (char_length(field_key) <= 64),
  old_value text,
  new_value text,
  version integer not null,
  change_source text not null check (change_source in ('manual','proposal','sweep','conflict')),
  proposal_id uuid,
  changed_by uuid,
  changed_at timestamptz not null default now()
);
create index gmh_account_field_idx on public.grove_memory_history (account_id, field_key, changed_at desc);
create trigger grove_memory_history_append_only
  before update or delete on public.grove_memory_history
  for each row execute function private.raise_append_only();

-- 1.5 field_flags — persistent conflict state (C2 populates)
create table public.field_flags (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references public.accounts (id) on delete cascade,
  field_key text not null check (char_length(field_key) <= 64),
  status text not null default 'needs_review' check (status in ('needs_review','resolved','dismissed')),
  competing_source_ids uuid[] not null default '{}',
  detail text check (detail is null or char_length(detail) <= 1000),
  detected_at timestamptz not null default now(),
  resolved_at timestamptz,
  resolution text
);
create unique index field_flags_one_open_idx on public.field_flags (account_id, field_key) where (status = 'needs_review');

-- RLS: member-read, no direct client writes (service role / RPCs only)
do $$
declare t text;
begin
  foreach t in array array['sources','field_evidence','field_meta','grove_memory_history','field_flags'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format($p$create policy %1$s_member_read on public.%1$s for select to authenticated using ((select private.is_account_member(account_id)))$p$, t);
    execute format('revoke all on public.%I from anon', t);
    execute format('revoke insert, update, delete, truncate, references, trigger on public.%I from authenticated', t);
  end loop;
end $$;
```

- [ ] **Step 4: Run the test, verify it passes**

Run: `npx vitest run tests/rls/company-brain-foundation.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
cd /c/nib-foundation
git add supabase/migrations/20260622140000_company_brain_foundation.sql tests/rls/company-brain-foundation.test.ts
git commit -m "feat(foundation): F1 evidence/provenance/history/flag side tables + RLS"
```

---

### Task 2: `save_grove_memory` history extension (compatibility-preserving)

**Files:**
- Modify (append `create or replace`): `supabase/migrations/20260622140000_company_brain_foundation.sql`
- Test: `tests/rls/company-brain-foundation.test.ts` (add a `describe` block)

**Interfaces:**
- Consumes: existing `public.save_grove_memory(target_account uuid, new_sections jsonb, new_hard_rules jsonb, new_notes text)`.
- Produces: same signature; now also appends `grove_memory_history` rows and upserts `field_meta.last_reviewed_at` for changed fields (`change_source='manual'`, `changed_by = auth.uid()`).

- [ ] **Step 1: Write the failing test** (append to the file)

```ts
describe.skipIf(!dbAvailable)('F1 — save_grove_memory appends history', () => {
  const h = new RlsHarness();
  let acct = '';
  const UID = 'c3333333-7777-4777-8777-777777777777';
  const asU = { kind: 'authenticated', uid: UID } as const;
  beforeAll(async () => {
    await h.reset();
    await h.sql(`insert into auth.users (id,email) values ($1,'c@ex.test')`, [UID]);
    await h.as(asU, async (c) => { await c.query(`insert into public.users (id,email) values ($1,$2)`, [UID, `${UID}@ex.test`]); });
    acct = await h.as(asU, async (c) => (await c.query(`select public.create_account_with_owner('C') as id`)).rows[0].id);
  });
  afterAll(async () => { await h.close(); });

  it('a field edit records one history row + a field_meta review stamp', async () => {
    await h.as(asU, async (c) => {
      await c.query(`select public.save_grove_memory($1, $2::jsonb, '[]'::jsonb, null)`, [acct, JSON.stringify({ pricing: '$200/session' })]);
    });
    const hist = await h.as(asU, async (c) =>
      (await c.query(`select field_key, old_value, new_value, change_source, version from public.grove_memory_history where account_id=$1`, [acct])).rows);
    expect(hist).toEqual([{ field_key: 'pricing', old_value: null, new_value: '$200/session', change_source: 'manual', version: 1 }]);
    const meta = await h.as(asU, async (c) =>
      (await c.query(`select field_key from public.field_meta where account_id=$1 and last_reviewed_at is not null`, [acct])).rows);
    expect(meta).toEqual([{ field_key: 'pricing' }]);
  });

  it('an unchanged re-save adds no new history rows', async () => {
    await h.as(asU, async (c) => {
      await c.query(`select public.save_grove_memory($1, $2::jsonb, '[]'::jsonb, null)`, [acct, JSON.stringify({ pricing: '$200/session' })]);
    });
    const n = await h.as(asU, async (c) => (await c.query(`select count(*)::int as n from public.grove_memory_history where account_id=$1`, [acct])).rows[0].n);
    expect(n).toBe(1);
  });
});
```

- [ ] **Step 2: Run, verify it fails** — `npx vitest run tests/rls/company-brain-foundation.test.ts` → FAIL (history empty / 0 rows).

- [ ] **Step 3: Append the `create or replace`** (preserves the original body + adds the diff loop)

```sql
-- Extend save_grove_memory: same signature + behavior, now appends per-field
-- history and stamps field_meta.last_reviewed_at for changed fields.
create or replace function public.save_grove_memory(
  target_account uuid, new_sections jsonb, new_hard_rules jsonb, new_notes text
) returns void language plpgsql security definer set search_path = '' as $$
declare
  uid uuid := (select auth.uid());
  old_sections jsonb; old_hard_rules jsonb; old_notes text;
  new_version integer; k text;
  old_rules_txt text; new_rules_txt text;
begin
  if uid is null then raise exception 'not authenticated'; end if;
  if not (select private.is_account_member(target_account)) then raise exception 'not a member of this account'; end if;
  if new_sections is null or jsonb_typeof(new_sections) <> 'object' or pg_column_size(new_sections) > 32768 then
    raise exception 'sections must be a json object under 32KB'; end if;
  if new_hard_rules is null or jsonb_typeof(new_hard_rules) <> 'array' or pg_column_size(new_hard_rules) > 8192 then
    raise exception 'hard_rules must be a json array under 8KB'; end if;
  if new_notes is not null and char_length(new_notes) > 8000 then raise exception 'notes too long'; end if;

  perform pg_advisory_xact_lock(hashtext('grove_memory:' || target_account::text));
  select sections, hard_rules, notes into old_sections, old_hard_rules, old_notes
    from public.grove_memory where account_id = target_account;

  insert into public.grove_memory (account_id, sections, hard_rules, notes)
    values (target_account, new_sections, new_hard_rules, new_notes)
  on conflict (account_id) do update
    set sections = excluded.sections, hard_rules = excluded.hard_rules, notes = excluded.notes,
        version = public.grove_memory.version + 1, updated_at = now()
  returning version into new_version;

  -- per-section diff
  for k in
    select jsonb_object_keys(coalesce(old_sections,'{}'::jsonb))
    union select jsonb_object_keys(coalesce(new_sections,'{}'::jsonb))
  loop
    if coalesce(old_sections->>k,'') is distinct from coalesce(new_sections->>k,'') then
      insert into public.grove_memory_history (account_id, field_key, old_value, new_value, version, change_source, changed_by)
        values (target_account, k, old_sections->>k, new_sections->>k, new_version, 'manual', uid);
      insert into public.field_meta (account_id, field_key, last_reviewed_at) values (target_account, k, now())
        on conflict (account_id, field_key) do update set last_reviewed_at = now();
    end if;
  end loop;

  -- hard_rules (compare as text)
  old_rules_txt := array_to_string(array(select jsonb_array_elements_text(coalesce(old_hard_rules,'[]'::jsonb))), E'\n');
  new_rules_txt := array_to_string(array(select jsonb_array_elements_text(coalesce(new_hard_rules,'[]'::jsonb))), E'\n');
  if old_rules_txt is distinct from new_rules_txt then
    insert into public.grove_memory_history (account_id, field_key, old_value, new_value, version, change_source, changed_by)
      values (target_account, 'hard_rules', nullif(old_rules_txt,''), nullif(new_rules_txt,''), new_version, 'manual', uid);
    insert into public.field_meta (account_id, field_key, last_reviewed_at) values (target_account, 'hard_rules', now())
      on conflict (account_id, field_key) do update set last_reviewed_at = now();
  end if;

  -- notes
  if coalesce(old_notes,'') is distinct from coalesce(new_notes,'') then
    insert into public.grove_memory_history (account_id, field_key, old_value, new_value, version, change_source, changed_by)
      values (target_account, 'notes', old_notes, new_notes, new_version, 'manual', uid);
    insert into public.field_meta (account_id, field_key, last_reviewed_at) values (target_account, 'notes', now())
      on conflict (account_id, field_key) do update set last_reviewed_at = now();
  end if;
end; $$;
revoke execute on function public.save_grove_memory(uuid, jsonb, jsonb, text) from public, anon, service_role;
grant execute on function public.save_grove_memory(uuid, jsonb, jsonb, text) to authenticated;
```

- [ ] **Step 4: Run, verify it passes** — `npx vitest run tests/rls/company-brain-foundation.test.ts` → PASS.

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/20260622140000_company_brain_foundation.sql tests/rls/company-brain-foundation.test.ts
git commit -m "feat(foundation): save_grove_memory appends per-field history + review stamp"
```

---

### Task 3: `proposals` + `propose_memory_change` + `review_item` notification

**Files:**
- Append: `supabase/migrations/20260622140000_company_brain_foundation.sql`
- Test: `tests/rls/company-brain-foundation.test.ts`

**Interfaces:**
- Produces table `public.proposals` and `public.propose_memory_change(p_account uuid, p_field_key text, p_op text, p_value text, p_rationale text, p_source_id uuid, p_origin text) returns uuid` (service-role only). Emits a `review_item` notification (`source_id` = proposal id).

- [ ] **Step 1: Write the failing test**

```ts
describe.skipIf(!dbAvailable)('F2 — propose_memory_change + review_item notification', () => {
  const h = new RlsHarness();
  let acct = '';
  const UID = 'd4444444-7777-4777-8777-777777777777';
  const asU = { kind: 'authenticated', uid: UID } as const;
  const anon = { kind: 'anon' } as const;
  const service = { kind: 'service_role' } as const;
  beforeAll(async () => {
    await h.reset();
    await h.sql(`insert into auth.users (id,email) values ($1,'d@ex.test')`, [UID]);
    await h.as(asU, async (c) => { await c.query(`insert into public.users (id,email) values ($1,$2)`, [UID, `${UID}@ex.test`]); });
    acct = await h.as(asU, async (c) => (await c.query(`select public.create_account_with_owner('D') as id`)).rows[0].id);
  });
  afterAll(async () => { await h.close(); });

  it('service role proposes; a review_item notification is emitted', async () => {
    const pid = await h.as(service, async (c) =>
      (await c.query(`select public.propose_memory_change($1,'pricing','replace','$250',null,null,'manual') as id`, [acct])).rows[0].id);
    expect(pid).toBeTruthy();
    const note = await h.as(asU, async (c) =>
      (await c.query(`select kind, source_id from public.notifications where account_id=$1 and kind='review_item'`, [acct])).rows);
    expect(note).toEqual([{ kind: 'review_item', source_id: pid }]);
  });

  it('clients cannot call propose_memory_change', async () => {
    for (const who of [asU, anon] as const) {
      await expect(
        h.as(who, (c) => c.query(`select public.propose_memory_change($1,'pricing','replace','x',null,null,'manual')`, [acct])),
      ).rejects.toThrow(/permission denied/);
    }
  });

  it('a member reads their own pending proposals; cross-account sees none', async () => {
    const rows = await h.as(asU, async (c) => (await c.query(`select status, field_key from public.proposals where account_id=$1`, [acct])).rows);
    expect(rows).toEqual([{ status: 'pending', field_key: 'pricing' }]);
  });
});
```

- [ ] **Step 2: Run, verify it fails** — FAIL (`function public.propose_memory_change does not exist`).

- [ ] **Step 3: Append the DDL**

```sql
-- F2: proposals (the review queue) + the producer RPC.
create table public.proposals (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references public.accounts (id) on delete cascade,
  field_key text not null check (char_length(field_key) <= 64),
  op text not null default 'replace' check (op in ('replace','append')),
  proposed_value text not null check (char_length(proposed_value) <= 6000),
  rationale text check (rationale is null or char_length(rationale) <= 2000),
  source_id uuid references public.sources (id) on delete set null,
  origin text not null check (origin in ('doc_extract','capture','collate','conflict','connector','manual')),
  status text not null default 'pending' check (status in ('pending','approved','rejected','superseded')),
  created_at timestamptz not null default now(),
  decided_at timestamptz,
  decided_by uuid
);
create index proposals_queue_idx on public.proposals (account_id, status, created_at);
alter table public.proposals enable row level security;
create policy proposals_member_read on public.proposals for select to authenticated
  using ((select private.is_account_member(account_id)));
revoke all on public.proposals from anon;
revoke insert, update, delete, truncate, references, trigger on public.proposals from authenticated;

-- review_item joins the notification kinds (preserve all existing kinds).
alter table public.notifications drop constraint notifications_kind_check;
alter table public.notifications add constraint notifications_kind_check
  check (kind in ('beat','evolution','graduation','nudge','demotion','reach','review_item'));

-- extend the system-notification guard to allow review_item.
create or replace function public.insert_system_notification(
  p_account uuid, p_kind text, p_source_id text, p_title text, p_body text, p_payload jsonb
) returns void language plpgsql security definer set search_path = '' as $$
begin
  if p_kind not in ('nudge','demotion','review_item') then
    raise exception 'insert_system_notification only authors nudge/demotion/review_item, got %', p_kind;
  end if;
  insert into public.notifications (account_id, kind, source_id, title, body, payload)
  values (p_account, p_kind, p_source_id, p_title, p_body, p_payload)
  on conflict (account_id, kind, source_id) do nothing;
end; $$;
revoke execute on function public.insert_system_notification(uuid, text, text, text, text, jsonb) from public, anon, authenticated;
grant execute on function public.insert_system_notification(uuid, text, text, text, text, jsonb) to service_role;

-- producer RPC: service-role only. Quarantined sources cannot back a proposal.
create function public.propose_memory_change(
  p_account uuid, p_field_key text, p_op text, p_value text, p_rationale text, p_source_id uuid, p_origin text
) returns uuid language plpgsql security definer set search_path = '' as $$
declare new_id uuid;
begin
  if p_source_id is not null and exists (
    select 1 from public.sources s where s.id = p_source_id and s.redaction_status = 'quarantined'
  ) then
    raise exception 'cannot propose from a quarantined source';
  end if;
  insert into public.proposals (account_id, field_key, op, proposed_value, rationale, source_id, origin)
    values (p_account, p_field_key, coalesce(p_op,'replace'), p_value, p_rationale, p_source_id, p_origin)
    returning id into new_id;
  perform public.insert_system_notification(
    p_account, 'review_item', new_id::text,
    'A suggested update to your memory', coalesce(p_rationale, 'Review a proposed change to ' || p_field_key),
    jsonb_build_object('proposal_id', new_id, 'field_key', p_field_key));
  return new_id;
end; $$;
revoke execute on function public.propose_memory_change(uuid, text, text, text, text, uuid, text) from public, anon, authenticated;
grant execute on function public.propose_memory_change(uuid, text, text, text, text, uuid, text) to service_role;
```

- [ ] **Step 4: Run, verify it passes** — PASS.

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/20260622140000_company_brain_foundation.sql tests/rls/company-brain-foundation.test.ts
git commit -m "feat(foundation): proposals + propose_memory_change + review_item notification"
```

---

### Task 4: `decide_memory_proposal` — apply-on-approve / reject + full-loop test

**Files:**
- Append: `supabase/migrations/20260622140000_company_brain_foundation.sql`
- Test: `tests/rls/company-brain-foundation.test.ts`

**Interfaces:**
- Consumes: `proposals`, `sources`, `grove_memory`, `field_evidence`, `grove_memory_history`, `audit_log`, `notifications`.
- Produces: `public.decide_memory_proposal(p_proposal_id uuid, p_decision text) returns void` (authenticated member only). On `'approved'`: writes the curated field, appends history (`change_source='proposal'`), links `field_evidence`, logs `audit_log` (`action='memory.ratified'`), resolves the `review_item` notification, marks proposal `approved`. On `'rejected'`: marks rejected, logs, resolves notification, no curated write.

- [ ] **Step 1: Write the failing test** (the end-to-end loop proof — replaces the spec's "manual producer" with a direct RPC e2e)

```ts
describe.skipIf(!dbAvailable)('F2 — decide_memory_proposal apply-on-approve', () => {
  const h = new RlsHarness();
  let acct = ''; let otherAcct = '';
  const UID = 'e5555555-7777-4777-8777-777777777777';
  const OTHER = 'f6666666-7777-4777-8777-777777777777';
  const asU = { kind: 'authenticated', uid: UID } as const;
  const asOther = { kind: 'authenticated', uid: OTHER } as const;
  const service = { kind: 'service_role' } as const;
  beforeAll(async () => {
    await h.reset();
    await h.sql(`insert into auth.users (id,email) values ($1,'e@ex.test'),($2,'f@ex.test')`, [UID, OTHER]);
    for (const [who, uid] of [[asU, UID], [asOther, OTHER]] as const) {
      await h.as(who, async (c) => { await c.query(`insert into public.users (id,email) values ($1,$2)`, [uid, `${uid}@ex.test`]); });
    }
    acct = await h.as(asU, async (c) => (await c.query(`select public.create_account_with_owner('E') as id`)).rows[0].id);
    otherAcct = await h.as(asOther, async (c) => (await c.query(`select public.create_account_with_owner('F') as id`)).rows[0].id);
  });
  afterAll(async () => { await h.close(); });

  async function propose(src: string | null = null) {
    return h.as(service, async (c) =>
      (await c.query(`select public.propose_memory_change($1,'pricing','replace','$300','from rate sheet',$2,'doc_extract') as id`, [acct, src])).rows[0].id);
  }

  it('approving writes the curated value via a logged decision (history + evidence + audit + notification resolved)', async () => {
    const srcId = await h.as(service, async (c) =>
      (await c.query(`insert into public.sources (account_id, kind, title) values ($1,'document','Rate sheet') returning id`, [acct])).rows[0].id);
    const pid = await propose(srcId);
    await h.as(asU, async (c) => { await c.query(`select public.decide_memory_proposal($1,'approved')`, [pid]); });

    const mem = await h.as(asU, async (c) => (await c.query(`select sections->>'pricing' as p from public.grove_memory where account_id=$1`, [acct])).rows[0].p);
    expect(mem).toBe('$300');
    const hist = await h.as(asU, async (c) => (await c.query(`select change_source, new_value from public.grove_memory_history where account_id=$1 and field_key='pricing'`, [acct])).rows);
    expect(hist).toEqual([{ change_source: 'proposal', new_value: '$300' }]);
    const link = await h.as(asU, async (c) => (await c.query(`select source_id from public.field_evidence where account_id=$1 and field_key='pricing'`, [acct])).rows[0].source_id);
    expect(link).toBe(srcId);
    const audit = await h.as(asU, async (c) => (await c.query(`select count(*)::int n from public.audit_log where account_id=$1 and action='memory.ratified'`, [acct])).rows[0].n);
    expect(audit).toBe(1);
    const status = await h.as(asU, async (c) => (await c.query(`select status from public.proposals where id=$1`, [pid])).rows[0].status);
    expect(status).toBe('approved');
    const openNote = await h.as(asU, async (c) => (await c.query(`select read_at from public.notifications where account_id=$1 and kind='review_item' and source_id=$2`, [acct, pid])).rows[0].read_at);
    expect(openNote).not.toBeNull();
  });

  it('rejecting writes nothing to the curated layer', async () => {
    const pid = await propose();
    await h.as(asU, async (c) => { await c.query(`select public.decide_memory_proposal($1,'rejected')`, [pid]); });
    const status = await h.as(asU, async (c) => (await c.query(`select status from public.proposals where id=$1`, [pid])).rows[0].status);
    expect(status).toBe('rejected');
    const histN = await h.as(asU, async (c) => (await c.query(`select count(*)::int n from public.grove_memory_history where account_id=$1 and change_source='proposal'`, [acct])).rows[0].n);
    expect(histN).toBe(1); // only the approved one from the prior test's account is separate; this account: still just the approve above
  });

  it('a non-member cannot decide another account''s proposal', async () => {
    const pid = await propose();
    await expect(
      h.as(asOther, (c) => c.query(`select public.decide_memory_proposal($1,'approved')`, [pid])),
    ).rejects.toThrow(/not a member|not found/);
  });
});
```

- [ ] **Step 2: Run, verify it fails** — FAIL (`function public.decide_memory_proposal does not exist`).

- [ ] **Step 3: Append the DDL**

```sql
-- F2: the human ratification gate. The ONLY new curated-write path; always logged.
create function public.decide_memory_proposal(p_proposal_id uuid, p_decision text)
returns void language plpgsql security definer set search_path = '' as $$
declare
  uid uuid := (select auth.uid());
  p public.proposals%rowtype;
  cur_sections jsonb; cur_rules jsonb; cur_notes text; new_version integer;
  old_val text; new_val text;
begin
  if uid is null then raise exception 'not authenticated'; end if;
  if p_decision not in ('approved','rejected') then raise exception 'decision must be approved or rejected'; end if;
  select * into p from public.proposals where id = p_proposal_id;
  if not found then raise exception 'proposal not found'; end if;
  if not (select private.is_account_member(p.account_id)) then raise exception 'not a member of this account'; end if;
  if p.status <> 'pending' then raise exception 'proposal already decided'; end if;

  perform pg_advisory_xact_lock(hashtext('grove_memory:' || p.account_id::text));

  if p_decision = 'approved' then
    insert into public.grove_memory (account_id, sections, hard_rules, notes) values (p.account_id, '{}'::jsonb, '[]'::jsonb, null)
      on conflict (account_id) do nothing;
    select sections, hard_rules, notes into cur_sections, cur_rules, cur_notes from public.grove_memory where account_id = p.account_id;

    if p.field_key = 'notes' then
      old_val := cur_notes;
      new_val := case when p.op='append' and old_val is not null then old_val || E'\n' || p.proposed_value else p.proposed_value end;
      update public.grove_memory set notes = new_val, version = version + 1, updated_at = now()
        where account_id = p.account_id returning version into new_version;
    elsif p.field_key = 'hard_rules' then
      old_val := array_to_string(array(select jsonb_array_elements_text(coalesce(cur_rules,'[]'::jsonb))), E'\n');
      new_val := case when p.op='append' and nullif(old_val,'') is not null then old_val || E'\n' || p.proposed_value else p.proposed_value end;
      update public.grove_memory
        set hard_rules = to_jsonb(string_to_array(new_val, E'\n')), version = version + 1, updated_at = now()
        where account_id = p.account_id returning version into new_version;
    else
      old_val := cur_sections->>p.field_key;
      new_val := case when p.op='append' and old_val is not null then old_val || E'\n' || p.proposed_value else p.proposed_value end;
      update public.grove_memory
        set sections = jsonb_set(coalesce(sections,'{}'::jsonb), array[p.field_key], to_jsonb(new_val), true),
            version = version + 1, updated_at = now()
        where account_id = p.account_id returning version into new_version;
    end if;

    insert into public.grove_memory_history (account_id, field_key, old_value, new_value, version, change_source, proposal_id, changed_by)
      values (p.account_id, p.field_key, old_val, new_val, new_version,
              case when p.origin='conflict' then 'conflict' else 'proposal' end, p.id, uid);
    insert into public.field_meta (account_id, field_key, last_reviewed_at) values (p.account_id, p.field_key, now())
      on conflict (account_id, field_key) do update set last_reviewed_at = now();
    if p.source_id is not null then
      insert into public.field_evidence (account_id, field_key, source_id, relationship)
        values (p.account_id, p.field_key, p.source_id, 'supports')
        on conflict (account_id, field_key, source_id) do nothing;
    end if;
  end if;

  -- log the ratification (Trust Ledger substrate) for BOTH approve and reject
  insert into public.audit_log (account_id, actor, actor_id, action, subject, meta)
    values (p.account_id, 'user', uid::text, 'memory.ratified', p.field_key,
            jsonb_build_object('proposal_id', p.id, 'decision', p_decision, 'source_id', p.source_id, 'origin', p.origin));

  update public.proposals set status = p_decision, decided_at = now(), decided_by = uid where id = p.id;
  update public.notifications set read_at = now()
    where account_id = p.account_id and kind = 'review_item' and source_id = p.id::text and read_at is null;
end; $$;
revoke execute on function public.decide_memory_proposal(uuid, text) from public, anon, service_role;
grant execute on function public.decide_memory_proposal(uuid, text) to authenticated;
```

> **Note on `audit_log` columns:** this assumes `audit_log(account_id, actor, actor_id, action, subject, meta jsonb)` per the M1 RLS test (`actor`, `actor_id`, `action`, `subject`, `meta`). If the live `audit_log` has an `action`/`kind` CHECK constraint, extend it to allow `'memory.ratified'` in this migration (mirror the `notifications_kind_check` pattern). Confirm column names against `supabase/migrations/20260610170000_*` before running.

- [ ] **Step 4: Run, verify it passes** — `npx vitest run tests/rls/company-brain-foundation.test.ts` → PASS (all blocks).

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/20260622140000_company_brain_foundation.sql tests/rls/company-brain-foundation.test.ts
git commit -m "feat(foundation): decide_memory_proposal apply-on-approve (logged) + reject"
```

---

### Task 5: Apply migration to all environments + verify

**Files:** none (deploy/operator task).

- [ ] **Step 1:** Run the full RLS suite once more, green: `npx vitest run tests/rls/company-brain-foundation.test.ts`.
- [ ] **Step 2:** Apply `20260622140000_company_brain_foundation.sql` to **dev**, **staging**, and **prod** via the project's migration path (Supabase MCP `apply_migration` / CLI), one environment at a time.
- [ ] **Step 3:** Verify on each: the five tables exist, `propose_memory_change` + `decide_memory_proposal` exist, the `notifications_kind_check` includes `review_item`, and `select sections from public.grove_memory limit 1` still reads (existing rows untouched).
- [ ] **Step 4:** Open the PR for `feature/company-brain-foundation` (base `main`), link this plan + the design spec, and request the standard 4-reviewer adversarial gate (sensitive surface: new data paths + a curated-write path).

---

## Self-Review

**Spec coverage (design §8 acceptance):**
- sources / field_evidence / field_meta — Task 1 ✓
- append-only grove_memory_history — Task 1 (table+trigger) + Tasks 2/4 (writers) ✓
- field_flags seam — Task 1 ✓
- propose→review→approve→write; curated write only via logged human decision — Tasks 3+4 ✓
- review_item fires on propose, resolves on decide — Tasks 3+4 ✓
- three existing paths unchanged — `save_grove_memory` keeps signature (Task 2); Memory page + `loadGroveMemoryBlock` not touched ✓
- migration to dev/staging/prod + security review — Task 5 ✓

**Placeholder scan:** none — every step has concrete SQL/test/commands. One explicit verification caveat (audit_log columns/constraint, Task 4 note) flagged for the implementer to confirm against the M1 migration, not a placeholder.

**Type/signature consistency:** `propose_memory_change(uuid,text,text,text,text,uuid,text)→uuid` and `decide_memory_proposal(uuid,text)→void` are used identically in DDL and tests; `grove_memory_history` columns match across Tasks 1/2/4; `field_meta(account_id,field_key,last_reviewed_at)` consistent.

**Deviation from design §4.4:** the loop is proven via a direct RPC end-to-end test (Task 4) rather than a user-facing `proposeManualEdit` server action — avoids introducing a dubious UI surface; real producers are P2/P3.
