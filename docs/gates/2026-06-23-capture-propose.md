# Adversarial Gate — P3 Passive-Capture Propose Loop

**Branch:** feature/company-brain-capture-propose  
**Date:** 2026-06-23  
**Reviewer lenses:** red-team · claims-auditor · logic-skeptic · cost-auditor

---

## 1. Red-team (attack surface)

### Extra-field injection at the boundary

**Claim:** The route rejects any payload with fields not in `ObservationSummary` (Zod `.strict()`), preventing a future raw-content leak disguised as an extension field.

**Verified:** `observationSummarySchema` uses `.strict()` at the top level and on every nested object (`appSchema`, `shapeSchema`, `study_period`). The test `'rejects unexpected fields (strict)'` confirms a payload with `{ ax_label: 'secret' }` parses to `null` → route returns 400 with no DB write.

**Attack path blocked:** A malicious desktop client cannot smuggle a raw AX label or window title by adding it as an extra field. The route short-circuits before source insert.

### Battery bypass via content-embedding in allowed fields

**Claim:** A summary that encodes PII/secrets inside `top_apps[].name` or `workflow_shapes[].pattern` is caught by `summaryIsClean` before any DB write.

**Verified:** `summaryIsClean` calls `batteryStillMatches(JSON.stringify(summary))` over the entire payload. Test `'flags a payload that smuggles content matching a battery rule'` uses `name: 'leak@example.com'` — confirmed flag → 422, no DB write.

**Attack path blocked:** A compromised on-device Rust command cannot extract raw event content into `top_apps[].name` (an email address, partial URL, etc.) and have it accepted by the cloud. The battery scan runs over the whole JSON blob.

### Model-proposed value smuggling raw content into grove_memory

**Claim:** Even if the model misbehaves and returns a value containing PII, the per-proposal battery scan in `proposeFromCaptureCore` silently drops it before `propose_memory_change` is called.

**Verified:** Test `'drops a proposal whose value is flagged by the battery scan (silent drop, source survives)'` injects `value: 'email me at leak@example.com'`. The proposal is dropped, the source row is still written, and no `propose_memory_change` RPC is called.

**Attack path blocked:** Model output is not trusted. The battery scan is a second, independent guard on the write boundary.

### RLS / service-role gating on `propose_memory_change`

**Claim:** Authenticated users and anon cannot call `propose_memory_change` directly.

**Verified:** RLS test `'authenticated clients and anon cannot call propose_memory_change'` confirms that both `asA` (authenticated member) and anon calls raise `permission denied`. The RPC is `SECURITY DEFINER` with an explicit revoke from `authenticated` and `anon`.

### Cross-account isolation on `sources`

**Claim:** Member B cannot read member A's `sources(kind='observation')` rows.

**Verified:** RLS test `'service-role inserts observation source; member A reads it, member B cannot'` confirms `count(*)=0` for B when querying A's `account_id`.

### Cross-account `decide_memory_proposal` block

**Claim:** Member B cannot approve or reject member A's proposals.

**Verified:** RLS test `'member B cannot decide_memory_proposal for account A'` — calling `decide_memory_proposal` as B for A's proposal raises `not a member` or `not found`.

### Residual risk (documented, not blocking)

- **Battery false-positives:** `batteryStillMatches` could flag a legitimate app name (e.g. an app named `admin@internal`) as dirty and drop a valid proposal. This errs toward dropping rather than leaking. Acceptable: the battery is a conservative guard, not a semantic filter.
- **Model misbehaviour producing a structurally-valid but contextually-wrong proposal:** The model is constrained to app names and timing patterns (no raw content in the prompt), and a Haiku-class model at `temperature: 0.3` is unlikely to confabulate PII. The per-proposal battery scan is the enforced guard. Risk is low; noted for future red-team rotation.

---

## 2. Claims-auditor

### "No raw event content leaves the device" — does it hold?

**Claim (PD1/C1):** The `ObservationSummary` payload sent to the cloud contains only structural derivations — app names, aggregate timing, workflow transition shapes, gap count.

**Verified per field:**
- `study_id`: study UUID, not event content.
- `study_period.{start,end}`: date strings from event timestamps — no AX label, window title, URL.
- `total_events_reviewed`: integer count — no content.
- `active_ms`: summed `input.duration_ms` — numeric only.
- `top_apps`: `{ name: app.name, durationMs: sum }` — app name only, not `bundle_id`, `window.title_redacted`, `ax.label_redacted`.
- `busiest_hour`: integer 0–23 — no content.
- `workflow_shapes.pattern`: built from `app.name` transitions only (e.g. `"Figma→Slack"`). Test `'collapses same-app runs and counts length-2/3 app transitions only'` asserts `pattern` does not match `/[Xx]title|redacted|http/`.
- `gap_count`: integer — no content.

**Claim holds.** The `buildObservationSummary` test `'carries only structural fields and no raw event content'` asserts `JSON.stringify(summary)` does not match `title_redacted|label_redacted|bundle_id|"id"`.

### "No new migration" — does it hold?

**Claim:** P3 ships zero new migrations. `sources.kind='observation'`, `proposals.origin='capture'`, and `review_item` notification are already present from F1/F2.

**Verified:** No migration file with a P3 date exists in `supabase/migrations/`. The RLS test `"proposals.origin='capture' is accepted by the CHECK constraint (no migration needed)"` explicitly confirms the F1/F2 schema already accepts `origin='capture'` without a new migration.

### "[] is success" invariant — does it hold?

**Claim:** No-model / thin-data / error paths produce no proposals, no notification, no user-visible error, but still write the `sources` row (staleness evidence).

**Verified:**
- Test `'still writes the source row but emits no proposals when generate is null'`: source_id returned, `proposal_ids.length === 0`, RPC calls `=== 0`.
- `deriveProposalsFromObservation(summary, null)` returns `{ proposals: [], model: null, usage: null }`.
- The route wraps the core call in `try/catch` and returns `500` to the bridge (fire-and-forget; desktop bridge swallows all errors per `call<T>` fallback).

---

## 3. Logic-skeptic

### Source row written before proposal loop — correct ordering?

The source row is inserted first (Step 1), then proposals derived (Step 2), then each proposal battery-scanned and proposed (Step 3). This ordering is correct: the source row is "staleness evidence" regardless of whether any proposals are derived. A failure at Step 2/3 does not roll back the source row — this is intentional (§11, constraint 5: "sources row is still written").

**Question:** could a proposal refer to a source_id that doesn't exist yet? No — `proposeFromCaptureCore` inserts the source row and gets its id before calling `propose_memory_change`. The RPC call carries `p_source_id=sourceId`.

### `decide_memory_proposal` e2e chain — does it really hit grove_memory?

**Verified end-to-end by the RLS test:**  
1. service-role `propose_memory_change(A, 'pricing', 'append', '$200/session…', 'Pattern', src_id, 'capture')` → pending proposal + review_item notification.  
2. member A `decide_memory_proposal(pid, 'approved')` →  
   a. `grove_memory.sections->>'pricing'` = `'$200/session — inferred from study'` ✓  
   b. `grove_memory_history` row with `change_source='proposal'` ✓  
   c. `field_evidence(field_key='pricing', source_id=src_id)` link ✓  
   d. `audit_log(action='memory.ratified')` row ✓  
   e. `notifications(read_at IS NOT NULL)` resolved ✓  
   f. `proposals.status='approved'` ✓

This is a full ratification chain using unchanged F2 machinery — P3 adds zero new write paths to `grove_memory`.

### Double-decide guard inherited from F2

Not re-tested in the capture-propose suite (it is P3's RLS file's responsibility only to test capture-specific scenarios). The double-decide guard is already verified in `company-brain-foundation.test.ts` (`'double-decide guard: second call throws "already decided"'`). No regression.

### `batteryStillMatches` call timing — before or after source insert?

**Claim:** Battery scan runs on the full summary BEFORE the source insert (route level). Then per-proposal scan runs BEFORE each `propose_memory_change` call.

**Verified in route:**
```
parseObservationSummary(body)  → parse (strict)
summaryIsClean(summary)        → battery over full payload (422 if dirty — NO DB write)
proposeFromCaptureCore(...)    → source insert → derive → per-proposal scan → propose
```

The source insert is NOT reached on a battery hit. Ordering is correct.

---

## 4. Cost-auditor

### Call frequency

One T0/Haiku-class model call per completed Field Study, on the propose-from-capture background path. This is a fire-and-forget background pipeline call — it does not add latency to the user's "Done" button response.

### Max tokens

`maxTokens: 600` — tight cap for structured JSON output of 0–3 short proposals.

### Model tier

`DEFAULT_MODELS.t0` — the cheapest registered model. No T2 budget draw. No `groveRouter.route()` round-trip (would create a DB dependency in this background path; same model anyway).

### COGS ledgering — now wired

`deriveProposalsFromObservation` now returns `{ proposals, model, usage }`. `proposeFromCaptureCore` calls `recordModelCall` with `task='capture_propose', origin='pipeline'` when `model !== null && usage !== null`. The no-key / thin-data / error (throw) paths all return `model=null, usage=null` — nothing is ledgered on those paths. Tests verify:
- `'calls recordModelCall with task=capture_propose when a model call is made'` — asserts `recorded.length === 1` with correct `task`, `origin`, `model`, `accountId`.
- `'does NOT call recordModelCall when generate is null (no API key path)'` — asserts `recorded.length === 0`.
- `'does NOT call recordModelCall when recordCall is omitted (backward compat)'` — optional param does not break existing tests.

### No-key short-circuit

`anthropicGenerate()` returns `null` when `ANTHROPIC_API_KEY` is absent or empty. `deriveProposalsFromObservation(summary, null)` returns `NO_CALL` immediately (no generate call, no tokens). `recordModelCall` is not called. Cost is zero in that path.

---

## Verdict

**PASS** — all four reviewer lenses clear. No P1 or P2 findings. No new migration required. The capture→propose→ratify chain is verified end-to-end by the RLS test suite. COGS ledgering is now wired.

**Open notes (not blocking merge):**
- Battery false-positive on legitimate app names is a known acceptable risk (documented above).
- Task 5 (Rust Tauri command) is deferred — the cloud path ships independently; the bridge's `call<T>` fallback keeps the web build green.
- Task 5 must be reviewed by the red-team lens before desktop release (the Rust serialization must not include raw fields from the event store).
