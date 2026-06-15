# Field Study Cloud Sync (Phase 2) — Design

**Date:** 2026-06-15
**Branch:** feature/nibbin-desktop-unified-app
**Status:** Design — pending user review

## Goal

Close the last gap in the field-study loop: when a study finishes (Review → Synthesizing),
the **desktop app** builds the C7 synthesis packet from its local redacted events and uploads
it to Nibbin, which synthesizes the diagnosis. Today the desktop transitions
`Synthesizing → RawDeleting` with **no packet build and no upload** — the study deletes its raw
data without ever producing the diagnosis. This wires the build + upload in, respecting the
privacy invariants.

## Privacy invariants this must honor

- **C1 — captures never leave the device.** The segmenter emits only categorized workflow
  *summaries* (counts, durations, app names, dictionary labels) — never the event stream and never a
  `frame_ref`. Construction is whitelist-only (explicit field-pick), and the serialized packet is
  re-scanned with the battery (`PacketLeakError` throws on residual PII) before it can upload.
- **C3 — verified ordering: packet leaves *before* raw deletion.** The upload must return 200
  **before** the study advances to `RawDeleting`. On upload failure the study stays in
  `Synthesizing` and retries; raw data is never deleted while the packet is still on-device only.
- **C7 — only redacted text leaves, pixels never.** No pixels or `frame_ref` exist in the packet
  shape at all; the re-scan is the backstop.

## The packet-shape mismatch (the crux)

There are **two different packet concepts** in the codebase and they don't match:

- **Low-level packet** — `packages/redaction/src/packet.ts` `buildSynthesisPacket` produces
  `{manifest, jsonl}`: a redacted *event stream* + n-gram sequences + daily aggregates.
- **Diagnosis packet** (the endpoint's real contract) — `apps/web/lib/diagnosis/types.ts`
  `SynthesisPacket = {version, studyDays, capturedFrom, capturedTo, workflows[]}`, where each
  `PacketWorkflow` is `{key, label, category, apps[], minutesObserved, sessions, friction?}`.
  Its doc comment: *"the cloud-side contract the desktop Observer will match when it ships."*

The endpoint's `validateSynthesisPacket` only accepts the **diagnosis packet**. Nothing on-device
produces it today — `buildSynthesisPacket` is the wrong shape and is **not** on the upload path.

**Decision (user, 2026-06-15): segment on-device.** Only categorized workflow summaries leave the
device — never the granular event stream. So the centerpiece of Phase 2 is a new **on-device
segmenter**: `ObserverEvent[] → SynthesisPacket` (the diagnosis shape). This is the strongest C1/C7
story and matches the documented contract.

## What already exists (no work)

| Piece | Location | Notes |
|---|---|---|
| Diagnosis-packet contract | `apps/web/lib/diagnosis/types.ts` (`SynthesisPacket`, `PacketWorkflow`, `WorkflowCategory`) | The exact shape the segmenter must emit. |
| Server synthesis | `apps/web/lib/diagnosis/synthesize.ts` (`validateSynthesisPacket`, `synthesizeDiagnosis`) + `label.ts` | Validates the diagnosis packet, mines the map, Opus-labels + writes the letter. Unchanged. |
| Events bridge | `apps/desktop/src-tauri/app/src/commands.rs` `review_events` | Returns redacted `ObserverEvent[]` to the webview. Frontend already calls it for the Review UI. |
| Control bridge | same file, `send_control("synthesis_complete")` | Frontend already drives transitions via `control.jsonl`. |
| Ingest endpoint | `apps/web/app/api/study/packet/route.ts` | Validates, `synthesizeDiagnosis` + `labelDiagnosis`, inserts a `diagnoses` row. |
| Diagnoses table | `supabase/migrations/20260613150000_m7_diagnoses.sql` | Service-role write only; member read. |
| Keychain tokens | `apps/desktop/src-tauri/app/src/auth.rs` `session_tokens() -> Option<(access, refresh)>` | Already stored at login. |
| Re-scan battery | `packages/redaction/src/battery.ts` `batteryStillMatches` | Paranoid residual-PII scan; the segmenter reuses it before returning. |

## Net-new work (5 changes)

### 0. On-device segmenter (the centerpiece)

`packages/redaction/src/segment.ts` — `segmentStudy(studyId, events, now): SynthesisPacket`.
Deterministic v0:

- **Categorize** each event by `url.host` (primary) then `app.name` (fallback) against a fixed
  dictionary → one of the 7 `WorkflowCategory` values (email/calendar/payments/crm/docs/social/other).
  Examples: `mail.google.com`/`outlook.*`→email, `calendar.google.com`→calendar,
  `stripe.com`/`quickbooks`→payments, `salesforce`/`hubspot`→crm, `docs.google.com`/`notion.so`→docs,
  `x.com`/`linkedin.com`→social, else `other`.
- **Group** events by category → one `PacketWorkflow` per category present. v0 key = `${category}.general`,
  label = a fixed human label per category ("Email", "Calendar", "Payments", …). (Finer keys like
  `email.inquiries` and warm labels are the server's Opus-labeling job and a later mining iteration —
  honest for v0; `CATEGORY_TEMPLATE` still maps coarse keys to a recommended Nibbin.)
- **Aggregate** per workflow: `minutesObserved = sum(input.duration_ms)/60000`,
  `sessions = distinct session count`, `apps = distinct app.name`.
- **Friction (v0, optional):** if the workflow's events contain a sequence repeated ≥3× (reuse
  `sequenceCandidates` scoped to the workflow), set a deterministic note
  ("Repeated N-step sequence observed K×"); else omit. No user free-text — derived from `role_path`.
- **Window:** `capturedFrom`/`capturedTo` = min/max `ts`; `studyDays = clamp(ceil((to−from)/day), 1, 14)`.
- **Exclude** `redaction.review_state === 'user_deleted'` events (layer-4 binding, as `buildSynthesisPacket` does).
- **Paranoid re-scan:** serialize the packet and run `batteryStillMatches`; throw `PacketLeakError` on
  any residual match before returning (belt-and-suspenders — v0 labels are dictionary-sourced).
- Output also carries `studyId` (for idempotent upsert, see §2).

**Drift guard:** the output type mirrors web's `SynthesisPacket`. A test asserts
`validateSynthesisPacket(segmentStudy(...))` is non-null, so the two contracts can't silently drift.

### 1. Endpoint: accept Bearer auth (web cookie path unchanged)

The desktop has **no cookies**, so the current `createClient()` (cookie-bound) `getUser()` returns
null and the POST 401s. Add a Bearer path:

```ts
// apps/web/app/api/study/packet/route.ts
async function clientForRequest(req: NextRequest) {
  const bearer = req.headers.get('authorization')?.match(/^Bearer (.+)$/)?.[1];
  if (bearer) {
    // Authenticated as the token's user, so downstream RPCs (bootstrap_account)
    // run under their auth.uid(). No cookies in play.
    return createServerClient(getSupabaseUrl(), getSupabasePublishableKey(), {
      global: { headers: { Authorization: `Bearer ${bearer}` } },
      cookies: { getAll: () => [], setAll: () => {} },
    });
  }
  return createClient(); // existing cookie path (web)
}
```

The rest of the handler is unchanged — `ensureAccount`, `validateSynthesisPacket`,
`synthesizeDiagnosis`, service-role insert all keep working because they operate on the resolved
`user`/`accountId` exactly as before. Cookie-based web callers are unaffected.

### 2. Idempotent upload — `study_id` on `diagnoses` (new migration)

C3's retry semantics mean a study can upload more than once (200 returned but the app crashed
before sending `synthesis_complete`; user retries). Without a key, each retry inserts a **duplicate
diagnosis**. Add `study_id` (carried on the packet, see §0) and upsert on it:

```sql
-- supabase/migrations/2026XXXXXXXXXX_diagnoses_study_id.sql
alter table public.diagnoses add column study_id text;
create unique index diagnoses_account_study_idx
  on public.diagnoses (account_id, study_id) where study_id is not null;
```

Add `studyId` to the diagnosis `SynthesisPacket` contract (`types.ts` + `validateSynthesisPacket`
reads `clampStr(p.studyId, 64)`). The endpoint switches the insert to an upsert keyed on
`(account_id, study_id)` using `packet.studyId`. A retried upload overwrites the same row
(re-synthesizes) instead of duplicating. When `studyId` is absent (any future web caller), fall back
to a plain insert. Existing rows keep `study_id = null` and are untouched.

### 3. Bridge: expose the access token to the webview

Add a Tauri command returning just the access token from the keychain (reusing
`auth::session_tokens()`), so the frontend can set the `Authorization` header:

```rust
// auth.rs
#[tauri::command]
pub fn access_token() -> Option<String> {
    session_tokens().map(|(access, _refresh)| access)
}
```

Exposed via `bridge.ts` as `accessToken(): Promise<string | null>`. (The refresh token stays in the
keychain; we never put either in a URL — consistent with the handoff hardening.)

### 4. Frontend: build + upload, then advance (the orchestration)

In the desktop UI's Synthesizing handler (field-study view), when the study enters `Synthesizing`:

1. `events = await bridge.reviewEvents()`
2. `study = ` current study snapshot (for `studyId`); `now = ` current ISO time
3. `packet = await segmentStudy(study.studyId, events, now)` (the diagnosis-shape packet; throws
   `PacketLeakError` if the re-scan trips)
4. `token = await bridge.accessToken()` → if null, surface "sign in to finish" (should not happen
   mid-study, but fail loud)
5. `POST {web}/api/study/packet` with `Authorization: Bearer ${token}`, body = `packet` (the
   `SynthesisPacket` object — exactly the shape `validateSynthesisPacket` accepts)
6. **On 200:** `await bridge.sendControl('synthesis_complete')` → daemon advances to `RawDeleting`,
   deletion runs, `DeletionVerified → Complete`.
7. **On non-200 / network error:** stay in `Synthesizing`, show an inline retry ("Couldn't reach
   Nibbin — your data is still on your device. Retry"). **Never** send `synthesis_complete`.

UI states for the Synthesizing step: `building` → `uploading` → `done` (brief, then the daemon
moves on) / `error` (retry button). Copy stays in the warm field-study register.

## Data flow

```
Review (user finishes)
  → daemon: Synthesizing
      frontend: reviewEvents() → segmentStudy() → POST /api/study/packet (Bearer)
        endpoint: getUser(bearer) → ensureAccount → validate → synthesize → upsert diagnoses(study_id)
      ← 200 { diagnosisId }
  → frontend: sendControl('synthesis_complete')
  → daemon: RawDeleting → (delete raw) → DeletionVerified → Complete
```

The diagnosis is now readable in the web app (`/app/diagnosis`) under the same account — the
desktop and web share the prod Supabase identity.

## Error handling

- **Upload fails (network/5xx):** stay Synthesizing, inline retry, raw data preserved (C3 holds).
- **Packet too large:** `diagnoses.packet` has a 256KB cap (`pg_column_size <= 262144`). A 14-day
  study could exceed it. Out of scope to chunk now; the endpoint returns a clear 413-style error and
  the frontend shows "study too large to sync — contact support" rather than silently failing. Flag
  as a follow-up (packet compression / chunking) in STATE.md.
- **PacketLeakError** (re-scan trips): the build throws before any upload; surface as a hard error
  ("we found something that looked sensitive and stopped — nothing was sent") and do **not** advance.
  This is the privacy backstop doing its job.
- **Token missing/expired:** `getUser(bearer)` returns null → 401. Frontend surfaces re-auth.

## Testing

- **Segmenter** (`packages/redaction`): given a fixture `ObserverEvent[]` spanning multiple
  categories, `segmentStudy` returns one workflow per category with correct `minutesObserved`
  (sum of `duration_ms`/60000), `sessions` (distinct session count), and `apps` (distinct, deduped);
  `user_deleted` events are excluded; `capturedFrom/To` + `studyDays` are computed from the window;
  an empty/all-deleted input yields zero workflows.
- **Drift guard:** `validateSynthesisPacket(segmentStudy(studyId, fixture, now))` is non-null and the
  workflows survive validation — locks the segmenter output to the cloud contract.
- **Re-scan:** a fixture seeded with a residual PII shape in a label makes `segmentStudy` throw
  `PacketLeakError` (the backstop fires before upload).
- **Endpoint Bearer path** (`apps/web`): a valid Bearer token resolves the user and inserts/upserts;
  a missing/garbage token 401s; the cookie path still works (existing behavior).
- **Idempotency:** two uploads with the same `(account_id, study_id)` produce **one** row, second
  overwrites.
- **Frontend orchestration:** the Synthesizing handler does not call `sendControl` on upload
  failure (C3 guard) — testable against a mocked bridge + fetch.

## Out of scope (follow-ups)

- Packet compression / chunking for >256KB studies.
- Background/resumable upload (current design is foreground, on the Synthesizing screen).
- Day-14 reveal UX in the web app (Group A / Maya-demo parity — tracked separately).
