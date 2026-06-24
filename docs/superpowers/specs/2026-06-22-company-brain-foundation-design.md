# Company Brain — Foundation (F1 memory data model + F2 review loop) — Design

**Date:** 2026-06-22
**Chunk:** F1 + F2 (the Foundation) from [`2026-06-22-company-brain-program-decomposition.md`](./2026-06-22-company-brain-program-decomposition.md). Canonical spec: `docs/COMPANY-BRAIN.md`.
**Status:** Design, pending plan.
**Why this is first:** Every chunk in the parallel wave (P1 Sources UI, P2 doc ingestion, P3 capture-propose, P5 synthesis-over-sources, C1 collate, C2 conflict) gates on the data model and the review primitive defined here. It is the one thing that cannot parallelize.

---

## 1. Scope

**In scope (the seam everything plugs into):**
- F1: a first-class **evidence/Sources store**, a **typed claim→evidence link** with per-field provenance/staleness, **append-only history** under each curated field, and a **conflict-flag** state table — all as side tables around the existing `grove_memory` value store.
- F2: a generic **propose → review → approve → write** primitive (`proposals` + RPCs + apply-on-approve), a **review queue** read, and a new **`review_item`** notification type.

**Out of scope (later chunks build on this seam, don't build it here):**
- Sources tab UI / provenance UI (P1). Document upload + extraction (P2). Capture-propose wiring (P3). Synthesis (P5). Notification wiring beyond emitting the new type + a count (P6). Collate (C1). Conflict detection + source-authority *ranking algorithm* (C2 — F1 only ships the `field_flags` table + `source_tier` seed it will read/write).
- No new ingestion sources here. F2 ships the primitive plus **one trivial internal producer** (a manual "propose this edit" path) purely to prove the loop end-to-end; real producers are P2/P3.

**Hard invariant carried by this chunk (§12):** *no code path writes the curated layer without a logged human approval.* Apply-on-approve (§4) is the only new write path into curated values besides the user's own direct edit; both append history.

---

## 2. Design principle (decided 2026-06-22)

Keep `grove_memory` as the curated **value** store (free-text JSONB, untouched) and layer the new concepts as **side tables keyed by `field_key`**. The curated value is a free-text blob either way; this delivers provenance, staleness, history, evidence links, and conflict flags without destabilizing the three working paths:

1. Memory page read (`apps/web/app/app/memory/page.tsx`) — reads `grove_memory` directly via RLS.
2. The single write RPC `save_grove_memory(target_account, sections, hard_rules, notes)` — full-replace upsert, `version++`.
3. Draft injection `loadGroveMemoryBlock(accountId)` (`apps/web/lib/grove/memory.ts`) — service-role read, injected into every draft.

`field_key` is the existing small, extensible string namespace: `facts`, `pricing`, `policies`, `faq`, `voice`, `hard_rules`, `notes` (canonical list in `MEMORY_SECTIONS` + the two extras). Granularity is **field-level** (matches the spec). Claim-level decomposition is explicitly deferred.

---

## 3. F1 — Data model

All tables: `account_id uuid` scoped, RLS `select` via `private.is_account_member(account_id)`, `revoke insert/update/delete from authenticated` (writes go through security-definer RPCs or service role), following the M1/M7 conventions. New migration number: `20260622140000_*` or later (latest applied is `20260622130000`).

### 3.1 `sources` — the evidence/Repository store
```
sources(
  id uuid pk default gen_random_uuid(),
  account_id uuid not null references accounts(id) on delete cascade,
  kind text not null check (kind in ('document','connector_artifact','observation','manual')),
  title text not null,                       -- display label in the Sources tab
  storage_path text,                         -- private Storage bucket ref for retained originals (documents)
  origin jsonb not null default '{}',        -- {connector, message_id, run_id, filename, mime, ...} — provenance metadata, never raw secrets
  source_tier smallint not null default 50,  -- authority seed (§4.4): contract/signed > pdf > email > chat. C2 learns adjustments.
  captured_at timestamptz not null default now(),  -- when the evidence is dated (recency signal, §4.4)
  redaction_status text not null default 'clean' check (redaction_status in ('clean','redacted','quarantined')),
  created_at timestamptz not null default now()
)
```
- Indexed `(account_id, captured_at desc)` and `(account_id, kind)`.
- `storage_path` references a **private, per-account Supabase Storage bucket** (`brain-sources`), RLS so only members read; documents (P2) retain the original here. Connector artifacts/observations usually have `storage_path = null` and carry their reference in `origin`.
- The hybrid-retrieval surface (P5, already-built `match_memory` over `memory_entries`) is extended later to also index source text; F1 only defines the store.

### 3.2 `field_evidence` — the typed claim→evidence link + per-field provenance/staleness
```
field_evidence(
  id uuid pk default gen_random_uuid(),
  account_id uuid not null references accounts(id) on delete cascade,
  field_key text not null,                   -- e.g. 'pricing'
  source_id uuid not null references sources(id) on delete cascade,
  relationship text not null default 'supports' check (relationship in ('supports','contradicts','superseded')),
  created_at timestamptz not null default now(),
  unique (account_id, field_key, source_id)
)
```
- Plus a small per-field metadata table for staleness (separate so it has one row per field, not per link):
```
field_meta(
  account_id uuid not null references accounts(id) on delete cascade,
  field_key text not null,
  last_reviewed_at timestamptz,              -- when the human last ratified/edited this field
  primary key (account_id, field_key)
)
```
- **Staleness hint** (P1 renders it) = derived: newest `sources.captured_at` linked to the field is newer than `field_meta.last_reviewed_at` → "new evidence since you last reviewed this," or field untouched for N days → "haven't revisited."
- **Provenance affordance** (P1) = the set of `sources` linked to a field via `field_evidence`.

### 3.3 `grove_memory_history` — append-only per-field trail
```
grove_memory_history(
  id uuid pk default gen_random_uuid(),
  account_id uuid not null references accounts(id) on delete cascade,
  field_key text not null,
  old_value text,
  new_value text,
  version integer not null,                  -- grove_memory.version after this change
  change_source text not null check (change_source in ('manual','proposal','sweep','conflict')),
  proposal_id uuid,                           -- set when change_source='proposal'/'conflict'
  changed_by uuid,                            -- auth user who ratified (null for sweep)
  changed_at timestamptz not null default now()
)
```
- `BEFORE UPDATE OR DELETE` trigger → `private.raise_append_only()` (same pattern as `credit_ledger`, `audit_log`).
- Written by `save_grove_memory` (per changed field) and by apply-on-approve. This is the "timestamped evidence trail below the current understanding" (§12).

### 3.4 `field_flags` — persistent conflict state (seam only; C2 populates)
```
field_flags(
  id uuid pk default gen_random_uuid(),
  account_id uuid not null references accounts(id) on delete cascade,
  field_key text not null,
  status text not null default 'needs_review' check (status in ('needs_review','resolved','dismissed')),
  competing_source_ids uuid[] not null default '{}',
  detail text,                                -- "deposit terms differ: 50% vs 30%"
  detected_at timestamptz not null default now(),
  resolved_at timestamptz,
  resolution text
)
-- + partial unique index (separate statement): unique (account_id, field_key) where status='needs_review'
--   — at most one open flag per field (Postgres partial unique index, not an inline constraint)
```
- F1 ships the table + read path; **C2** writes flags (detection) and resolves them (user-pick = approval, metabolize into `source_tier`).

### 3.5 `save_grove_memory` extension (compatibility-preserving)
- Same signature and behavior. Add: inside the advisory-locked upsert, diff incoming `sections`/`hard_rules`/`notes` against current per `field_key`; for each changed field append a `grove_memory_history` row (`change_source='manual'`, `changed_by = auth.uid()`) and upsert `field_meta.last_reviewed_at = now()`.
- The Memory page, the server action, and `loadGroveMemoryBlock` are **unchanged**. (P1 later adds provenance/staleness rendering; not required for F1.)

---

## 4. F2 — The review loop

### 4.1 `proposals`
```
proposals(
  id uuid pk default gen_random_uuid(),
  account_id uuid not null references accounts(id) on delete cascade,
  field_key text not null,
  op text not null default 'replace' check (op in ('replace','append')),
  proposed_value text not null,
  rationale text,                             -- "from your rate sheet (Acme_Rates.pdf)"
  source_id uuid references sources(id) on delete set null,
  origin text not null check (origin in ('doc_extract','capture','collate','conflict','connector','manual')),
  status text not null default 'pending' check (status in ('pending','approved','rejected','superseded')),
  created_at timestamptz not null default now(),
  decided_at timestamptz,
  decided_by uuid
)
```
- Index `(account_id, status, created_at)` for the review queue.
- RLS member-read. **Writes:** `propose_memory_change(...)` is **service-role** (extractors/producers call it); `decide_memory_proposal(proposal_id, decision)` is **authenticated-user** security-definer (re-checks membership).

### 4.2 Apply-on-approve (the evidence→truth bridge)
`decide_memory_proposal(proposal_id, 'approved')` runs atomically (advisory lock on `grove_memory:account`):
1. Re-check membership; load the proposal (must be `pending`).
2. Compute new field value (`replace` or `append` onto current `grove_memory.sections[field_key]` / `hard_rules` / `notes`).
3. Write via the same curated path → bump `version`, append `grove_memory_history` (`change_source='proposal'`, `proposal_id`, `changed_by=auth.uid()`), set `field_meta.last_reviewed_at=now()`.
4. If `source_id` present, upsert `field_evidence(field_key, source_id, 'supports')`.
5. Log a **ratification** row to `audit_log` (`kind='memory_ratification'`, payload = proposal id, field, source, decision; extend the `audit_log.kind` CHECK if it's constrained) — the Trust Ledger substrate (§9.6/§12). C2's source-authority ranking reads these.
6. Mark proposal `approved`; mark the emitted `review_item` notification resolved.

`decide_memory_proposal(_, 'rejected')` → status `rejected`, log to `audit_log`, resolve the notification. No curated write.

**Invariant:** the only writes to `grove_memory` are (a) the user's own `save_grove_memory` edit and (b) apply-on-approve. Both append history; (b) requires an authenticated decision. No producer writes curated values directly.

### 4.3 Review queue + notification type
- **Read:** `proposals` where `status='pending'`, joined to `sources` for display — consumed by the Memory page review surface (P1), Grove Home roll-up (P6), and the Grovekeeper (P6).
- **Emit:** on `propose_memory_change`, insert a notification of new kind **`review_item`** via the existing `insert_system_notification()` path. This requires extending **both** the `notifications.kind` CHECK (migration `20260618120000`) **and** `insert_system_notification()`'s internal allow-list (currently `nudge`/`demotion`) to include `review_item`; `source_id` = proposal id. Item-level **stakes tiering** (high-stakes pushes vs sits quietly) is a P6 addition — F1 just emits the item at default behavior. Full wiring (Grovekeeper read-access, Keeper red-bubble, Grove Home roll-up) is P6.

### 4.4 The one internal producer (to prove the loop)
A minimal authenticated server action `proposeManualEdit(field_key, value)` that calls `propose_memory_change(origin='manual')` — lets us exercise propose → review_item notification → `decide_memory_proposal` → curated write + history + audit end-to-end in tests, with **no UI** beyond what's needed for the e2e. Real producers are P2/P3.

---

## 5. Security & business-logic review (every new data path)

- **Scoped reads, zero cross-account leakage:** every table RLS-gated by `is_account_member`; the Storage bucket per-account RLS. Fuzz the read paths (§3 of COMPANY-BRAIN). No service-role read returns another account's rows.
- **No injection vector:** `sources.origin` / `proposals.proposed_value` are data, never executed; extraction (P2) must pass redaction (`@nibbin/redaction` `isClean`) before a `source`/`proposal` is written — F1 enforces `redaction_status` is set and quarantined sources cannot back an approved proposal.
- **Write authority:** producers can only *propose* (service-role RPC); only an authenticated member can *approve* (curated write). Append-only history + `audit_log` ratification make every truth-layer change attributable.
- **Append-only enforcement** via trigger on `grove_memory_history` (and `audit_log` already).
- **DoS/size bounds:** bounded column sizes mirroring `grove_memory` (proposed_value ≤ 6000, etc.).

---

## 6. Migration & rollout
- One migration `20260622140000_company_brain_foundation.sql`: the four side tables + `field_meta`, the append-only trigger, the `proposals` table, the two RPCs, the `save_grove_memory` extension, the `insert_system_notification` `kind` CHECK extension, and the private Storage bucket + policies.
- Applied to **all three Supabase DBs** (dev/staging/prod) per project convention.
- Backward compatible: existing `grove_memory` rows untouched; no data backfill required (history/provenance accrue going forward). `loadGroveMemoryBlock` and the Memory page need no change to keep working.

---

## 7. Testing
- RLS isolation tests (member vs non-member vs cross-account) on all new tables + the Storage bucket.
- `decide_memory_proposal` apply-on-approve: correct field math (replace/append), version bump, history append, `field_evidence` link, `audit_log` ratification, notification resolve — and that a rejected/quarantined proposal writes nothing curated.
- Append-only trigger rejects update/delete on history.
- End-to-end via the §4.4 manual producer: propose → `review_item` emitted → approve → curated value changed + history + audit; reject → no change.
- Regression: existing Memory page save + `loadGroveMemoryBlock` still pass.

---

## 8. Acceptance (the slice of COMPANY-BRAIN §17 this delivers)
- [ ] First-class `sources` store + typed `field_evidence` link + per-field `field_meta` (provenance/staleness data) exist and are RLS-scoped.
- [ ] Append-only `grove_memory_history` records every curated change; trigger blocks mutation.
- [ ] `field_flags` table exists for C2.
- [ ] `proposals` + `propose_memory_change` (service-role) + `decide_memory_proposal` (member) implement propose→review→approve→write; apply-on-approve writes the curated layer **only** via a logged human decision.
- [ ] A `review_item` notification fires on propose and resolves on decide.
- [ ] All three existing paths (Memory page, save RPC, draft injection) unchanged and green.
- [ ] Migration applied to dev/staging/prod; security + business-logic review passed.

**Unblocks:** P1, P2, P3, P5 (sources indexing), C1, C2.
