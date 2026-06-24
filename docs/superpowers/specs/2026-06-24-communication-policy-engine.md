# Per-Nibbin Communication Policy Engine

**Date:** 2026-06-24
**Branch:** `spec/communication-policy-engine`
**Status:** Design — pending owner (John) review. DO NOT BUILD until signed off.
**Generalizes:** PR #263 (re-nudge cadence / invoice safety floor — `nudge_ledger` / `record_nudge` / `nudge-floor.ts`).
**Reuses:** Company Brain proposal/approval machinery (`proposals` / `propose_*` / `decide_*` / `review_item` notifications, `20260622140000_company_brain_foundation.sql`) and the Action-Levels gate (`2026-06-20-permission-model-action-levels-design.md`).

---

## 1. Problem & Goals

### 1.1 The problem

PR #263 shipped a **resource-keyed** re-nudge floor: it bounds how often one invoice Nibbin re-emails a customer about **one still-overdue Stripe invoice**, keyed by `(nibbin_id, resource_kind='invoice', resource_id=<stripe invoice id>)`. It is hard-coded into the overdue-invoice nudge path: `deriveNudgeFloor(step)` only fires when `effectArgs.invoiceId` is present.

That solves invoice spam but leaves the general gap: **a Nibbin has no notion of "how often may I contact this *person*."** Today:

- A marketing Nibbin emailing a contact list has no per-recipient frequency bound at all.
- An inquiry-reply Nibbin and an invoice Nibbin can both email the same person on the same day; nothing composes their contact volume.
- The one bound that exists is keyed by **resource**, not **person** — so two different invoices to the same customer are counted separately, and a non-invoice channel (a DM, an SMS) to that same person isn't counted at all.

The owner's mental model is per-person, per-Nibbin frequency: *"invoice Nibbin → max 4 contacts per person per month"*, *"marketing Nibbin → max 2 contacts per person per week."* The shipped invoice floor is **instance #1** of this — the default backstop — not the whole system.

### 1.2 Goals

- A **general, per-Nibbin Communication Policy**: contact-frequency rules over `(nibbin × contact × channel × time-window × max-count)`.
- Enforce at the **Send/act** dispatch point, generalizing the nudge-floor hook (same fail-open + alarm posture).
- **Owner is the trust model, not a hard ceiling.** A documented/owner-set rule FULLY overrides the seeded default backstop — higher or lower, any value (locked decision #1).
- **Two rule sources** with different trust: owner-configured (applies directly) and Brain-extracted (PROPOSED → owner approves before it governs real outbound contact) (locked decision #2). Extraction errors can never silently change how customers are contacted.
- **Migrate** the invoice floor onto the general engine without regressing its guarantee, and decide the fate of `nudge_ledger` / `record_nudge`.
- A per-Nibbin **Communication Policy** settings surface: active rules, proposed rules awaiting approval, and a contact ledger / "last contacted" view.

### 1.3 Non-Goals

- Channel deliverability, suppression lists, unsubscribe/CAN-SPAM compliance copy (separate; this is frequency only). The engine records and bounds *contacts*; it does not author opt-out footers.
- Content-level rate decisions (what to say) — only whether a send may proceed *now*.
- Cross-**account** anything — every rule and ledger row is account-scoped, mirroring `nudge_ledger`.
- A configurable safety *floor* (see §4.4: the seeded backstop is the *default*, fully overridable; there is intentionally **no** un-overridable hard ceiling, per decision #1 — this is the one deliberate departure from #263's clamp model).

---

## 2. How it generalizes #263

| #263 (shipped) | This engine |
|---|---|
| Key: `(nibbin, resource_kind, resource_id)` | Key: `(nibbin, contact_key, channel)` — **person**, not resource |
| Hook: `deriveNudgeFloor` fires only on `effectArgs.invoiceId` | Hook: `deriveContact(step)` fires on **any** outbound-contact capability (`email.send`, `dm.reply`, `sms.send`, …) |
| Policy: `{intervalMs, maxNudges}` clamped to a hard floor | Policy: `{window, maxCount}` resolved from owner rule > approved-extracted rule > seeded default; **no hard clamp** (owner fully overrides) |
| Cadence input: `effectArgs.nudgeCadence` from the primitive | Policy: looked up from the `comms_policy_rules` store at dispatch (not carried in effectArgs) |
| Ledger: `nudge_ledger` (per resource) | Ledger: `contact_ledger` (per contact + channel); **`nudge_ledger` is folded in** (§7) |
| Floor is un-overridable (clamp UP) | Backstop is a *default*; a documented/owner rule overrides it either way |

The **shape** is identical — a service-role-only append ledger + a dispatch-time decision over recent history + fail-open + a `*_record_failed` alarm — which is why this is a generalization, not a rewrite.

### Migration path for the invoice floor

The invoice floor's guarantee ("≤4 invoice nudges per invoice per 180d") is **resource-keyed** and the new engine is **person-keyed**. These are *complementary*, not redundant: one bounds per-invoice spam, the other bounds per-person spam. Decision (§7): **keep `nudge_ledger` as the resource-grain ledger**, and add the person-grain `contact_ledger` alongside it. The invoice nudge writes BOTH (the runner records a contact when it records a nudge). The invoice floor's per-resource cadence stays exactly as #263 shipped it (no behavior change); the new per-person comms policy is an **additional** gate evaluated in the same block. Folding `nudge_ledger` into `contact_ledger` entirely is rejected (§7.2) because resource-grain and person-grain answer different questions.

---

## 3. Data model

Three tables, all `account_id`-scoped, all mirroring `nudge_ledger`'s RLS posture: **member read, service-role write, zero direct client writes.** Migration `20260624170000_communication_policy.sql` (next free after `20260624160000`).

### 3.1 `comms_policy_rules` — the rule store

```
comms_policy_rules
  id            uuid pk
  account_id    uuid not null  -> accounts(id) on delete cascade
  nibbin_id     uuid           -> nibbins(id)  on delete cascade   -- NULL = applies to all nibbins of `archetype`
  archetype     text           -- agent_specs.template_key ('sweep'..'scribe'); NULL when nibbin_id set
  channel       text not null default 'any'                        -- 'any'|'email'|'sms'|'dm'  (see §3.5)
  window        text not null  check (window in ('day','week','month'))
  max_count     integer not null check (max_count >= 0)            -- 0 = "do not contact" (a valid owner choice)
  status        text not null default 'active'
                  check (status in ('active','proposed','rejected','superseded'))
  source        text not null  check (source in ('owner','seed','brain_extract'))
  source_ref    uuid           -- proposals.id (brain_extract) or sources.id (provenance); NULL for owner/seed
  rationale     text           -- owner note or extracted rationale (<= 2000 chars)
  created_at    timestamptz not null default now()
  decided_at    timestamptz    -- when approved/rejected (proposed rows only)
  decided_by    uuid           -- approver (proposed rows only)

  -- exactly one ACTIVE rule per (nibbin scope, channel) — proposals don't collide with it
  unique index comms_policy_one_active
    on (account_id, coalesce(nibbin_id::text, archetype), channel)
    where status = 'active'
  index comms_policy_lookup on (account_id, nibbin_id, channel, status)
```

Notes:
- **Scope is per-Nibbin OR per-archetype.** A rule with `nibbin_id` set governs that Nibbin. A rule with `archetype` set (and `nibbin_id` NULL) is the seeded/archetype default that any matching Nibbin inherits when it has no per-Nibbin rule. Resolution precedence in §4.2.
- **`window` × `max_count`** is the rule: "max N contacts per [day|week|month]." Calendar windows (day/week/month boundaries) vs rolling — see §4.3; **decision: rolling** (a trailing N-day window) to match #263's rolling semantics and avoid a "reset at midnight → burst" exploit.
- `channel='any'` means the rule bounds total contacts across all channels for that scope. A channel-specific rule (`email`) coexists and the stricter effective bound wins (§4.2).
- **Owner rule vs Brain-proposed rule representation:** the `status` + `source` columns. An owner-set rule is `status='active', source='owner'` immediately. A Brain-extracted rule is born `status='proposed', source='brain_extract', source_ref=<proposal id>` and only becomes `status='active'` on owner approval. A rejected proposal is `status='rejected'` (kept for audit). A seed is `status='active', source='seed'`.

### 3.2 `contact_ledger` — the generalized contact ledger

Every **executed** outbound contact, one row per send, keyed by person + channel.

```
contact_ledger
  id            uuid pk
  account_id    uuid not null -> accounts(id) on delete cascade
  nibbin_id     uuid not null -> nibbins(id)  on delete cascade
  contact_key   text not null check (btrim(contact_key) <> '')   -- normalized recipient (§3.4)
  channel       text not null check (channel in ('email','sms','dm'))
  contacted_at  timestamptz not null default now()
  resource_kind text   -- optional provenance ('invoice'); NULL for non-resource contacts
  resource_id   text   -- optional; the invoice id etc.

  index contact_ledger_lookup
    on (account_id, nibbin_id, contact_key, channel, contacted_at desc)
  index contact_ledger_person          -- the cross-nibbin "last contacted this person" view (§6, §8.1)
    on (account_id, contact_key, contacted_at desc)
```

RLS / grants — **byte-identical posture to `nudge_ledger`**:
```sql
alter table public.contact_ledger enable row level security;
create policy contact_ledger_member_read on public.contact_ledger
  for select to authenticated using ((select private.is_account_member(account_id)));
revoke insert, update, delete, truncate, references, trigger on public.contact_ledger from authenticated;
revoke all on public.contact_ledger from anon;
```

### 3.3 RPCs

```
record_contact(p_account uuid, p_nibbin uuid, p_contact_key text, p_channel text,
               p_resource_kind text default null, p_resource_id text default null) -> void
   -- service-role only; plain append (mirrors record_nudge). Called by the runner
   -- AFTER a contact send executes. A rare duplicate row only makes a bound MORE
   -- conservative (same reasoning as record_nudge).

propose_comms_rule(p_account uuid, p_scope_nibbin uuid, p_archetype text, p_channel text,
                   p_window text, p_max_count int, p_rationale text, p_source_id uuid) -> uuid
   -- service-role only; mirrors propose_memory_change. Inserts a status='proposed',
   -- source='brain_extract' rule AND emits a review_item notification (§5.2).

decide_comms_rule(p_rule_id uuid, p_decision text) -> void   -- 'approved'|'rejected'
   -- authenticated, member-gated, security definer; mirrors decide_memory_proposal.
   -- approve: status -> 'active' (and supersede any existing active rule in the same
   -- scope+channel -> 'superseded'); reject: status -> 'rejected'. Logs audit_log
   -- action 'comms_policy.ratified' for BOTH outcomes; marks the review_item read.

set_comms_rule(p_account uuid, p_scope_nibbin uuid, p_channel text,
               p_window text, p_max_count int, p_rationale text) -> uuid
   -- authenticated, member-gated; the OWNER UI config path. Inserts/updates a
   -- status='active', source='owner' rule directly (no proposal step — owner authority).
   -- Supersedes any existing active rule in the same scope+channel.

delete_comms_rule(p_rule_id uuid) -> void  -- authenticated, member-gated; soft via status='superseded'.
```

Grants mirror the Company Brain RPCs: producer/`record_*` RPCs are `service_role` only; the owner-facing `set_/decide_/delete_` are `authenticated` + member-gated `security definer`.

### 3.4 `contact_key` normalization (load-bearing — what "a person" is)

The current invoice path identifies the recipient as `effectArgs.to` = a sanitized email address (`safeAddress(customer_email)`); the ledger never recorded it. We now record it as `contact_key`:

- **email** → lowercased, trimmed RFC address (the local-part is case-sensitive per RFC but practically not; lowercasing avoids `John@` vs `john@` evading the bound). `+tag` is **kept** (a deliberate tag is a deliberate address).
- **sms** → E.164 normalized phone.
- **dm** → the platform handle / chat id (Instagram/Telegram), already the channel's `externalId`.

`contact_key` is a derived **identifier**, not free PII content — it's the same address the send already used, stored to bound future sends. It sits behind member-read RLS like the rest of the ledger. (Open question Q4: cross-channel identity stitching — for v1 a person is identified *within* a channel only.)

### 3.5 Channel derivation

The "contact" channel is derived from the send **capability prefix**, NOT from `packages/channels` (which is the owner-notification rail: push/email/sms/telegram/whatsapp). Customer-outbound rides the **effects/capability** rail:

```
email.send / email.reply  -> channel 'email'
dm.reply   / dm.send       -> channel 'dm'
sms.send                   -> channel 'sms'
```

A single `CONTACT_CAPABILITIES` map in `packages/runtime` is the source of truth for "is this capability an outbound person-contact, and on what channel." A capability not in the map is not a contact and passes straight through (exactly as a non-invoice send does today).

---

## 4. Rule resolution & enforcement

### 4.1 The hook — where it sits in `dispatchStep`

Grounded in `packages/runtime/src/runner.ts`. The send path ordering today is:

```
action-level gate (observe -> deny | draft -> draft | act -> execute)   [line 370]
  └─ gate.action === 'execute' (level === 'act'):
       1. resource-claim (§18.3)            [fail-open]
       2. nudge-floor (#263, resource-key)  [fail-open + alarm]    <-- the model
       3. idempotency claim
       4. effects.execute(...)
       5. record_nudge (after send)         [best-effort + alarm]
```

The Communication Policy slots in as **step 2b**, immediately after the nudge-floor and before the idempotency claim — same reason both go before idempotency: a policy-skip must NOT create an idempotency row, or a later legitimate redelivery (past the window) would be permanently refused.

```
       1. resource-claim
       2. nudge-floor (resource-key, invoice-only)         [unchanged]
       2b. COMMS POLICY (person-key, all contact sends)    [NEW, fail-open + alarm]
       3. idempotency claim
       4. effects.execute(...)
       5. record_nudge (invoice only)                       [unchanged]
       5b. record_contact (all contact sends)               [NEW, best-effort + alarm]
```

`record_contact` is invoked on `claim === 'claimed'` (a real send, never a dedup), exactly where `record_nudge` is.

### 4.2 Effective-limit resolution

Pure function `resolveCommsPolicy(rules, nibbin, archetype, channel)` → `{window, maxCount} | null` (null = no rule, pass through). Given the rows for this account:

1. **Precedence (decision #1 — owner authority fully overrides the backstop):**
   `owner per-nibbin` > `approved-extracted per-nibbin (brain_extract, active)` > `owner/extracted per-archetype` > `seeded archetype default`.
   The **highest-precedence active rule that matches (scope, channel) wins outright** — it is NOT clamped against the seed. An owner who sets "10/week" gets 10/week (aggressive collections); an owner who sets "1/month" gets 1/month. The seed only applies when nothing higher exists.
2. **Channel specificity within a tier:** a `channel='email'` rule beats a `channel='any'` rule at the same scope+precedence (more specific). When both an `any` and a specific rule are active at the winning tier, **both** are evaluated and a send must satisfy **both** (the `email` cap AND the `any` cap) — caps compose by intersection, never by the looser one.
3. `proposed` and `rejected` rules are **never** consulted by the resolver — only `active` (and `seed`). A proposal governs nothing until approved (decision #2).

`maxCount = 0` is a legitimate "do not contact via this channel" rule and blocks every send.

### 4.3 Counting & decision

```
window  -> trailing duration:  day = 24h, week = 7d, month = 30d   (rolling, not calendar)
since   = now - window
count   = | contact_ledger rows where (nibbin, contact_key, channel-or-any) and contacted_at >= since |
allow   = count < maxCount
```

`decideContact(history: number[], now, policy)` mirrors `decideNudge`: load timestamps via a store `history(nibbinId, contactKey, channel, sinceMs)` (RLS-scoped range scan on `contact_ledger_lookup`), compare count to `maxCount`. For an `any`-channel cap, the history query omits the channel filter (counts all channels). Returns `{allow:false, reason:'max_count', window, limit}` on block.

There is **no interval gate** in the general engine (unlike #263's `too_soon`). Frequency is expressed purely as count-per-window, which is the owner's mental model ("4 per month"). The invoice floor's `min interval` stays inside the unchanged #263 path for the invoice resource grain.

### 4.4 Fail-open + alarm (consistent with #263)

- **History read throws** → log `[runner] comms-policy history infra error (fail-open) — proceeding with send`, skip the gate, send proceeds. The action-level gate, resource-claim, send-velocity cap, and (for invoices) the nudge-floor remain as backstops.
- **`record_contact` throws after a send** → log non-fatal, emit `contact_record_failed` product event (structural props only: `channel`, no `contact_key`/PII), proceed. A sustained failure under-counts and erodes the bound; the alarm makes it observable. Add `contact_record_failed` to the `emit_product_event` allowlist (same edit #263 made for `nudge_record_failed`).
- **Garbage policy values** (NaN/Infinity `max_count`) cannot occur: `max_count` is an `integer` column with a `>= 0` CHECK, so the NaN-coercion guard #263 needed in `resolveCadencePolicy` is structurally unnecessary here. The resolver still coerces a non-finite computed value to "no policy" defensively.

### 4.5 What counts as a "contact" (decision #3)

A **contact** is an outbound communication to a person performed at the **Send/act** action level — i.e. a real `effects.execute` on a contact capability (`claim === 'claimed'`). Specifically:

- A **draft** (action level Draft, or a Send-level step that the gate routes to draft) is **NOT** a contact — nothing left the building. The owner sending that draft manually is also not counted (it's not a Nibbin acting).
- A **dedup** (idempotency `already_executed`) is **NOT** a fresh contact (the original was already recorded).
- An **observe**-level step is never a contact.

This means the policy gate only ever runs on the execute branch, and the ledger only ever gains rows for real autonomous sends — keeping the bound semantically clean.

---

## 5. Rule sourcing

### 5.1 (a) Owner UI config flow

In the per-Nibbin Communication Policy surface (§6), the owner adds/edits a rule: pick channel (`any`/email/sms/dm), window (day/week/month), max count, optional note. Submitting calls `set_comms_rule(...)` → inserts a `status='active', source='owner'` row, superseding any existing active rule in that scope+channel. Applies **immediately** to the next dispatch (no approval, no proposal — owner authority is the trust model). Editing or removing is the same path (`set_comms_rule` / `delete_comms_rule`).

### 5.2 (b) Brain extraction → proposal → approval flow

Reuses the Company Brain machinery verbatim in **shape**:

```
documented source (collections policy doc / discussion)
   │   apps/web/lib/brain/doc-extract.ts  (P2 doc ingestion) — already extracts structured facts
   │   apps/web/lib/brain/derive-proposals.ts (P3) — constrained model call over the structural summary
   ▼
a CADENCE candidate is recognized
   e.g. doc says "contact debtors weekly until paid"  ->  {channel:'email', window:'week', max_count:1?}
   │   (new: a small classifier branch in derive-proposals / a dedicated derive-comms-rule pass that
   │    targets the comms-policy lane instead of the grove_memory field lane)
   ▼
propose_comms_rule(account, scope_nibbin, archetype, channel, window, max_count, rationale, source_id)
   │  -> inserts comms_policy_rules{status:'proposed', source:'brain_extract', source_ref:<proposal>}
   │  -> insert_system_notification(account, 'review_item', rule_id, title, body, payload)
   ▼
ATTENTION QUEUE (notification center + Keeper red-bubble + Grove "Needs you")
   the owner sees "Suggested communication rule: contact debtors weekly (from <doc>)"  [Approve | Reject]
   ▼
decide_comms_rule(rule_id, 'approved'|'rejected')
   approve -> status:'active' (supersede prior active in scope+channel); audit_log 'comms_policy.ratified'
   reject  -> status:'rejected'; audit_log 'comms_policy.ratified'(decision=rejected)
```

**Proposal shape** carried into the attention queue (the `review_item` notification `payload`):
```json
{ "comms_rule_id": "<uuid>", "scope": "nibbin:<id>|archetype:<key>",
  "channel": "email", "window": "week", "max_count": 1,
  "rationale": "Your collections policy says 'contact debtors weekly until paid'",
  "source_id": "<sources.id of the doc>" }
```

This mirrors `propose_memory_change` → `review_item` → `decide_memory_proposal` exactly. The **only** structural difference: the approved value lands in `comms_policy_rules` (governing outbound contact) rather than in `grove_memory` (a memory field). The owner approves it in the **same** attention queue UI they already use for memory proposals/conflicts — no new approval surface. Because a proposed rule governs nothing until approved (§4.2 step 3), an extraction error cannot silently change customer contact (decision #2 satisfied).

A Brain proposal that **conflicts** with an existing active owner rule is still surfaced (it's information), but approving it supersedes the owner rule only by the owner's explicit click — consistent with the conflict-detection (`field_flags`) pattern.

---

## 6. Seeded default backstops

Seeded per **archetype** (`agent_specs.template_key`) as `status='active', source='seed', nibbin_id=NULL, archetype=<key>`. These are the *defaults* every Nibbin of that archetype inherits absent a per-Nibbin or extracted rule — and any owner/extracted rule fully overrides them (§4.2).

| Archetype (template_key) | Channel | Window | Max | Rationale |
|---|---|---|---|---|
| invoice / collections (`tally`) | email | month | 4 | Matches #263's `FLOOR_MAX_NUDGES=4`; per-person, complements the per-invoice floor |
| marketing / outreach | any | week | 2 | "max 2 contacts per person per week" (owner's example) |
| inquiry-reply / inbox (`scribe`) | email | day | 3 | A responsive Nibbin may reply several times a day but shouldn't loop |
| scheduling / confirmations | any | week | 3 | Event confirms + reminders, bounded |
| (no archetype match) | any | month | 8 | A conservative catch-all so a brand-new custom Nibbin isn't unbounded |

The exact `template_key` values map to the shop catalog (`'sweep'..'scribe'`); the seed migration keys off whatever the real catalog keys are (verified at build, see Q2). The marketing default of 2/week is the only value the owner explicitly named; the others are proposed sensible defaults for review (§9 Q1).

---

## 7. `nudge_ledger` disposition

### 7.1 Decision: keep both ledgers

`nudge_ledger` answers **"how many times has this Nibbin nudged this invoice"** (resource grain, with a min-interval floor). `contact_ledger` answers **"how many times has this Nibbin contacted this person"** (person grain, count-per-window). Both are real, distinct bounds:

- Two invoices to one customer: `nudge_ledger` counts them separately (each invoice ≤4/180d); `contact_ledger` counts them together against the per-person cap. Both should hold.
- A DM and an email to one person: `nudge_ledger` (email-only, invoice-only) misses it; `contact_ledger` (channel-aware) catches it.

So the invoice nudge path writes BOTH: `record_nudge` (unchanged) AND `record_contact(channel='email', resource_kind='invoice', resource_id=...)`. The #263 floor logic is untouched; the comms policy is additive.

### 7.2 Rejected alternative

Folding `nudge_ledger` entirely into `contact_ledger` (drop the resource grain) is rejected: it would lose the per-invoice min-interval guarantee (#263's `too_soon` gate) and the per-resource count cap that protects a customer with one stubborn invoice from being re-hit even under a generous per-person policy. The two grains are complementary, not redundant.

### 7.3 No data migration needed

`nudge_ledger` rows stay as-is. `contact_ledger` starts empty and accrues forward. The invoice Nibbin's per-person history is empty on day 1 (it has only resource-grain history), which is correct fail-open behavior — the per-person cap simply hasn't observed anything yet, and the per-resource floor still bounds it.

---

## 8. UI

### 8.1 Per-Nibbin "Communication Policy" surface

Lives on the Nibbin's settings/detail page (alongside the Action-Level selector — the natural home, since both govern outbound behavior). Three regions:

```
┌─ Communication policy — <Nibbin name> ─────────────────────────────┐
│ ACTIVE RULES                                                       │
│   email · 4 per month        (default for Tally)   [Edit] [Remove] │
│   any   · 2 per week         (you set this)        [Edit] [Remove] │
│   [+ Add a rule]                                                   │
│                                                                    │
│ AWAITING YOUR APPROVAL  (1)                                        │
│   email · 1 per week  "contact debtors weekly until paid"          │
│     from: Collections Policy.pdf            [Approve] [Reject]      │
│                                                                    │
│ RECENTLY CONTACTED  (this Nibbin)                                  │
│   jane@acme.com   · email · 2 of 4 this month · last 3 days ago    │
│   billing@x.io    · email · 4 of 4 this month · ⚠ at limit         │
└────────────────────────────────────────────────────────────────────┘
```

- **Active rules** — `status='active'` rows for this Nibbin (per-Nibbin + inherited archetype seed, labeled by `source`). Edit/Remove via `set_comms_rule`/`delete_comms_rule`.
- **Awaiting approval** — `status='proposed'` rows (Brain extractions), with `source_ref`/`source_id` provenance ("from: <doc>"). Approve/Reject call `decide_comms_rule`. This region mirrors what the owner sees in the global attention queue — the approval is available in both places (the queue is the source of truth for the count; this surface is a focused view).
- **Recently contacted** — reads `contact_ledger` (member-RLS) for this Nibbin, grouped by `contact_key`, showing count-in-window vs the effective cap and "last contacted." The "⚠ at limit" badge is computed client-side from the same resolver logic.

### 8.2 Attention queue integration

No new surface for approvals. Proposed comms rules ride the existing `review_item` notification → notification center, Keeper red-bubble, Grove Home "Needs you" roll-up (per `2026-06-23-attention-queue-design.md`). Stakes: a proposed comms rule is `stakes='normal'` (sits in the center; it doesn't block anything until approved) — overridable later if owners want collections-policy proposals to push.

### 8.3 Cross-Nibbin "last contacted a person" (optional, v1.1)

The `contact_ledger_person` index supports an account-level "when did *any* Nibbin last contact jane@acme.com" view, surfaced on a contact/company page. Not required for v1; the index is added now so it's free later.

---

## 9. Edge cases & safety

1. **Cross-Nibbin contact to the same person — do limits compose?** **Decision: per-Nibbin, NOT composed, in v1.** The cap is `(nibbin, contact_key, channel)`. Two different Nibbins can each contact jane@acme.com up to their own caps. Rationale: caps express *a Nibbin's job's cadence* (collections vs marketing have different right answers); a global per-person cap is a different, account-level concept. **BUT** the cross-Nibbin total is *observable* (§8.3) so the owner can see pile-on and set tighter per-Nibbin rules. An account-level "no person hears from us more than N times/week across all Nibbins" cap is a strong v1.1 candidate (Q3) — the `contact_ledger_person` index already supports it.
2. **Channel interactions.** A `channel='any'` cap counts all channels (email+sms+dm) together; a channel-specific cap counts only its channel. When both exist they compose by intersection (a send must satisfy both). Email and SMS to one person are two contacts under `any`, one each under their specific caps.
3. **Draft vs send (§4.5).** Only a real autonomous `effects.execute` is a contact. Drafts, owner-manual sends, dedups, observe-steps are not. The gate runs only on the execute branch.
4. **Idempotency.** The policy gate is *before* the idempotency claim (so a skip leaves no idempotency row — a later legit redelivery past the window re-attempts). `record_contact` is *after* a real `claimed` execute (never on a dedup) — mirroring #263 exactly, so a redelivered event doesn't double-count.
5. **Interaction with Action Levels.** The comms policy is strictly *downstream* of the action-level gate and only runs when `level==='act'`. Observe → no send, no contact. Draft → no send, no contact (the owner manually sending a draft is out of scope, §4.5). It composes cleanly: action level decides *whether the Nibbin may act at all*; the comms policy decides *whether this particular contact is within frequency*. A Send-level Nibbin blocked by the policy records a `contact_skipped` step (mirroring `nudge_skipped`) so the run trace explains the no-op.
6. **`max_count = 0`.** Valid "do not contact" rule; blocks every send on that channel. Not a hard ceiling — the owner chose it and can change it.
7. **Clock skew / window boundaries.** Rolling windows (trailing duration) avoid the calendar-midnight burst exploit a `calendar month` reset would create.
8. **Quarantined source.** `propose_comms_rule` refuses a quarantined `source_id` (mirroring `propose_memory_change`'s guard) — an extraction from quarantined content can't even reach the queue.
9. **A wrong extraction proposing a *looser* rule** can't loosen anything until approved (decision #2). On approval it supersedes; the owner saw the value and the provenance. Audit-logged either way.

---

## 10. Phased build plan

**Slice 1 — Ledger + person-key enforcement (the core).**
`contact_ledger` table + `record_contact` RPC + `CONTACT_CAPABILITIES` map + `deriveContact(step)` + `decideContact` + the dispatch hook (step 2b) + `record_contact` after send + `contact_record_failed` alarm + the seeded archetype defaults. Wire the invoice path to also `record_contact`. No owner rules yet — runs entirely on seeds. Mirrors #263's structure 1:1, so the highest-confidence slice. Ships the safety value immediately.

**Slice 2 — Owner UI config.**
`comms_policy_rules` rule store (owner+seed rows) + `set_comms_rule`/`delete_comms_rule` + `resolveCommsPolicy` precedence + the per-Nibbin Communication Policy surface (Active rules + Recently-contacted). Now the engine reads owner rules, not just seeds.

**Slice 3 — Brain extraction → proposal → approval.**
`propose_comms_rule`/`decide_comms_rule` + the `derive-comms-rule` extraction branch (or a classifier in `derive-proposals`) + `review_item` wiring + the "Awaiting approval" region + attention-queue integration. Closes the documented-source loop.

**Slice 4 (v1.1, optional) — cross-Nibbin views + account-level cap.**
`contact_ledger_person` "last contacted" surface; optional account-level per-person cap (Q3). Gated on owner appetite.

Each slice ships behind the same review gauntlet as #263 (adversarial gate on the enforcement slice especially — the NaN/clamp-bypass class of bugs the floor's red-team caught).

---

## 11. Open questions for John

1. **Default backstop values (§6).** Marketing 2/week is yours. Proposed: invoice 4/month, inquiry-reply 3/day, scheduling 3/week, catch-all 8/month. Tune any of these? Especially the catch-all for custom Nibbins.
2. **Archetype keying.** Seeds key off `agent_specs.template_key` (the shop catalog key). Confirm the canonical key set / mapping (e.g. is the invoice/collections archetype `tally`?) so the seed migration targets the right Nibbins.
3. **Account-level per-person cap (§9.1, Q3).** v1 is per-Nibbin only (caps compose only by *observation*, not enforcement). Do you want a global "no person hears from us more than N/week across ALL Nibbins" hard cap in v1, or is the cross-Nibbin *visibility* enough until you see real pile-on?
4. **Cross-channel identity (§3.4, Q4).** v1 identifies a person *within* a channel (the email, the phone, the handle). Same human reached by email and by DM counts as two contacts under channel-specific caps. Worth stitching identities (email↔phone↔handle) in v1, or defer?
5. **Calendar vs rolling windows (§4.3).** I chose rolling (trailing 7/30 days) to avoid a midnight-reset burst and match #263. Do you want literal calendar weeks/months anywhere (e.g. "2 marketing emails per calendar month" reads more naturally to some owners)?
6. **Proposed-rule stakes (§8.2).** A Brain-proposed comms rule sits silently in the attention center (`stakes='normal'`). Should a proposed *collections/contact* rule push (high stakes), given it touches customer-facing behavior?
