# Ad-hoc Quick Scan (Phase 3) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Capture + diagnose one workflow on demand ("quick scan") outside the 14-day study, reusing the whole pipeline; give every study a unique id (fixing the diagnosis-overwrite bug); surface quick scans + the full study together in a web diagnoses history with badges.

**Architecture:** Studies stay SEQUENTIAL locally (one `study.json` at a time); each gets a unique id + `kind` (`FullStudy`/`QuickScan`) + optional `label`; runs to completion (upload+delete) then a fresh one can start. `kind`/`label` ride the packet to the diagnosis. Quick scans are user-stopped with a 6h auto-stop backstop (vs 14d). The cloud accumulates all diagnoses; the web shows a unified history.

**Tech Stack:** Rust/Tauri (study machine + daemon), TypeScript (the study-machine TS twin, segmenter, validator, desktop UI, Next.js web), Supabase migration, Vitest + cargo test.

**Reference:** `docs/superpowers/specs/2026-06-15-adhoc-quick-scan-design.md`. Tests from repo root via `npm test -- <substring>`; Rust via `cargo test --manifest-path apps/desktop/src-tauri/app/Cargo.toml` (and the `nibbin-study` crate). The Rust study machine (`crates/nibbin-study/src/lib.rs`) and the TS twin (`apps/desktop/src/core/study-machine.ts`) MUST stay semantically identical — change BOTH together and keep the json-twin + day-14 tests green.

---

## Task A: Study machine — kind, label, unique id, CreateStudy, per-kind window

**Files:**
- Modify: `apps/desktop/src-tauri/crates/nibbin-study/src/lib.rs` (+ its `#[cfg(test)]` tests)
- Modify: `apps/desktop/src/core/study-machine.ts` (the TS twin — mirror EXACTLY)
- Modify: `apps/desktop/test/*` if a twin-parity/study-machine test exists (search `study-machine` under apps/desktop/test)

Context: both files implement the same state machine. Rust `StudySnapshot` is `camelCase` via serde; the TS twin uses the same JSON keys. New fields use serde defaults so existing `study.json` still loads.

- [ ] **Step 1 (Rust): add the kind enum + fields + window**

In `crates/nibbin-study/src/lib.rs`:

```rust
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Default)]
#[serde(rename_all = "snake_case")]
pub enum StudyKind {
    #[default]
    FullStudy,
    QuickScan,
}

/// Auto-stop backstop per kind: the full study is the 14-day C2 hard stop; a
/// quick scan is normally user-stopped, with a short safety net so an abandoned
/// scan cannot capture indefinitely.
fn window(kind: StudyKind) -> Duration {
    match kind {
        StudyKind::FullStudy => Duration::days(STUDY_DAYS),
        StudyKind::QuickScan => Duration::hours(6),
    }
}
```

Add to `StudySnapshot` (after `study_id`):
```rust
    #[serde(default)]
    pub kind: StudyKind,
    #[serde(default)]
    pub label: Option<String>,
```

- [ ] **Step 2 (Rust): new_study signature + CreateStudy command + Start uses window**

Change `new_study`:
```rust
pub fn new_study(study_id: &str, kind: StudyKind, label: Option<String>) -> StudySnapshot {
    StudySnapshot {
        v: 1,
        study_id: study_id.to_string(),
        kind,
        label,
        state: StudyState::NotStarted,
        consented_at: None,
        started_at: None,
        ends_at: None,
        stopped_by: None,
        aborted: false,
        deletion_receipt: None,
        clock_high_water: None,
    }
}
```

Add a command variant:
```rust
    CreateStudy {
        id: String,
        kind: StudyKind,
        label: Option<String>,
    },
```

In `transition`, handle it (valid only from a terminal/not-started state — never mid-capture):
```rust
        StudyCommand::CreateStudy { id, kind, label } => {
            if !matches!(snap.state, NotStarted | Complete | Deleted) {
                return Err(invalid(snap.state, "create_study"));
            }
            return Ok(new_study(&id, kind, label));
        }
```

In `StudyCommand::Start`, replace the hardcoded duration:
```rust
            next.ends_at = Some(at + window(snap.kind));
```

- [ ] **Step 3 (Rust): tests**

Keep ALL existing tests green (the `started()` helper now calls `new_study("s1", StudyKind::FullStudy, None)` — update it). Add:
```rust
    #[test]
    fn quick_scan_window_is_six_hours_full_is_fourteen_days() {
        let q = transition(&new_study("q", StudyKind::QuickScan, Some("Invoices".into())),
            StudyCommand::Consent { at: t("2026-06-10T08:00:00Z") }).unwrap();
        let q = transition(&q, StudyCommand::Start { at: t("2026-06-10T08:00:00Z") }).unwrap();
        assert_eq!(q.ends_at.unwrap(), t("2026-06-10T14:00:00Z")); // +6h
        assert_eq!(q.label.as_deref(), Some("Invoices"));
        // full study still +14 days
        assert_eq!(started().ends_at.unwrap(), t("2026-06-24T08:00:00Z"));
    }

    #[test]
    fn create_study_only_from_terminal_or_not_started() {
        let complete = { /* drive a study to Complete via the happy path (reuse happy_path_to_complete steps) */
            let mut s = transition(&started(), StudyCommand::StopDay14).unwrap();
            s = transition(&s, StudyCommand::FinishReview).unwrap();
            s = transition(&s, StudyCommand::SynthesisComplete).unwrap();
            transition(&s, StudyCommand::DeletionVerified { receipt: receipt() }).unwrap()
        };
        let fresh = transition(&complete, StudyCommand::CreateStudy {
            id: "q2".into(), kind: StudyKind::QuickScan, label: None }).unwrap();
        assert_eq!(fresh.state, StudyState::NotStarted);
        assert_eq!(fresh.study_id, "q2");
        assert_eq!(fresh.kind, StudyKind::QuickScan);
        // not allowed mid-capture
        assert!(transition(&started(), StudyCommand::CreateStudy {
            id: "x".into(), kind: StudyKind::FullStudy, label: None }).is_err());
    }
```
Also update `json_shape_matches_the_ts_twin` to assert `json["kind"] == "full_study"` for a default study and that a legacy snapshot without `kind`/`label` still loads (serde defaults).

Run: `cargo test --manifest-path apps/desktop/src-tauri/crates/nibbin-study/Cargo.toml` → all pass.

- [ ] **Step 4 (TS twin): mirror EXACTLY**

In `apps/desktop/src/core/study-machine.ts`:
```typescript
export type StudyKind = 'full_study' | 'quick_scan';
const QUICK_SCAN_DURATION_MS = 6 * 60 * 60 * 1000;
function windowMs(kind: StudyKind): number {
  return kind === 'quick_scan' ? QUICK_SCAN_DURATION_MS : STUDY_DURATION_MS;
}
```
Add `kind: StudyKind;` and `label: string | null;` to `StudySnapshot` (after `studyId`). Update `newStudy(studyId, kind = 'full_study', label = null)` to set them. Add the command:
```typescript
  | { type: 'create_study'; id: string; kind: StudyKind; label: string | null }
```
Handle it FIRST (like delete_everything, before the switch), valid only from terminal/NOT_STARTED:
```typescript
  if (cmd.type === 'create_study') {
    if (snap.state !== 'NOT_STARTED' && !TERMINAL.has(snap.state)) {
      throw new InvalidTransitionError(snap.state, cmd.type);
    }
    return newStudy(cmd.id, cmd.kind, cmd.label);
  }
```
In `case 'start'`, use the per-kind window:
```typescript
      const endsAt = new Date(new Date(cmd.at).getTime() + windowMs(snap.kind)).toISOString();
```

- [ ] **Step 5 (TS twin): tests + run**

If `apps/desktop/test/study-machine*.test.ts` exists, add quick-scan-window + create_study tests mirroring the Rust ones; otherwise add a small test file. Run: `npm test -- study-machine` and `npm run typecheck -w apps/desktop` → green. Confirm Rust + TS twin agree on the `kind` JSON value (`'full_study'`/`'quick_scan'`).

- [ ] **Step 6: Commit**

```bash
git add apps/desktop/src-tauri/crates/nibbin-study/src/lib.rs apps/desktop/src/core/study-machine.ts apps/desktop/test
git commit -m "feat(study): study kind + label + CreateStudy + per-kind auto-stop window"
```

---

## Task B: Daemon wiring — unique id on boot + create_study control

**Files:**
- Modify: `apps/desktop/src-tauri/observerd/src/lib.rs`
- Modify: `apps/desktop/src-tauri/app/src/commands.rs`
- Modify: `apps/desktop/src-tauri/app/src/lib.rs` (register the bridge command)
- Modify: `apps/desktop/src/ui/bridge.ts`

Context: `observerd/src/lib.rs:121` does `new_study("study_local")` on boot. `commands.rs` has `ALLOWED_CONTROL` + `send_control` + `write_control`. The daemon drains `control.jsonl` and applies commands.

- [ ] **Step 1: Boot mints a unique FullStudy id**

In `observerd/src/lib.rs`, replace `new_study("study_local")` with a unique id (timestamp-based; the daemon may use `chrono::Utc::now()`):
```rust
nibbin_study::new_study(
    &format!("full_{}", chrono::Utc::now().timestamp_millis()),
    nibbin_study::StudyKind::FullStudy,
    None,
)
```

- [ ] **Step 2: Daemon handles the `create_study` control line**

The daemon's control-drain must parse a `create_study` line carrying `study_id`, `kind`, `label`, apply `StudyCommand::CreateStudy`, and CLEAR the observer-store (a fresh study starts empty). Find where the daemon parses control commands (search `"cmd"` / `stop_early` / `finish_review` in `observerd/src/lib.rs`) and add the `create_study` arm: build `StudyCommand::CreateStudy { id, kind, label }` from the JSON, `transition`, persist, and reset the store (reuse whatever the post-deletion store reset/`purge` path uses; if none, open the store and clear events). Keep parsing defensive (ignore malformed lines, as the existing loop does).

- [ ] **Step 3: Allow + expose `create_study`**

In `commands.rs`, add `"create_study"` to `ALLOWED_CONTROL`, and add a typed command:
```rust
#[tauri::command]
pub fn create_study(app: AppHandle, id: String, kind: String, label: Option<String>) -> Result<(), String> {
    if kind != "full_study" && kind != "quick_scan" {
        return Err(format!("bad study kind: {kind}"));
    }
    let line = serde_json::json!({ "cmd": "create_study", "study_id": id, "kind": kind, "label": label }).to_string();
    write_control(&app, &line).map_err(|e| e.to_string())
}
```
Register `commands::create_study` in `app/src/lib.rs` `generate_handler![...]`.

- [ ] **Step 4: Bridge wrapper**

In `apps/desktop/src/ui/bridge.ts`, add to the `bridge` object (matching the `call` helper style):
```typescript
  createStudy: (id: string, kind: 'full_study' | 'quick_scan', label: string | null) =>
    call<void>('create_study', { id, kind, label }, undefined),
```

- [ ] **Step 5: Verify**

Run: `cargo check --manifest-path apps/desktop/src-tauri/app/Cargo.toml` (incremental) and `cargo check --manifest-path apps/desktop/src-tauri/observerd/Cargo.toml` → clean. `npm run typecheck -w apps/desktop` → clean.

- [ ] **Step 6: Commit**

```bash
git add apps/desktop/src-tauri/observerd/src/lib.rs apps/desktop/src-tauri/app/src/commands.rs apps/desktop/src-tauri/app/src/lib.rs apps/desktop/src/ui/bridge.ts
git commit -m "feat(daemon): unique study ids on boot + create_study control command"
```

---

## Task C: Packet + contract carry kind/label

**Files:**
- Modify: `packages/redaction/src/segment.ts` (+ test)
- Modify: `apps/web/lib/diagnosis/types.ts`
- Modify: `apps/web/lib/diagnosis/synthesize.ts` (`validateSynthesisPacket`) (+ test)

- [ ] **Step 1 (segment): accept + emit meta**

Change `segmentStudy` to accept optional meta and emit it. In `segment.ts`, add to the local `SynthesisPacket` interface `kind?: 'full_study' | 'quick_scan';` and `label?: string;`, and:
```typescript
export async function segmentStudy(
  studyId: string,
  events: ObserverEvent[],
  now: string,
  meta?: { kind?: 'full_study' | 'quick_scan'; label?: string | null },
): Promise<SynthesisPacket> {
```
On the returned `packet` literal add:
```typescript
    ...(meta?.kind ? { kind: meta.kind } : {}),
    ...(meta?.label ? { label: meta.label.slice(0, 120) } : {}),
```
Keep the `batteryStillMatches` re-scan LAST. Add a test: `segmentStudy('q', events, NOW, { kind: 'quick_scan', label: 'Invoices' })` → `packet.kind === 'quick_scan'`, `packet.label === 'Invoices'`; omitting meta omits both.

- [ ] **Step 2 (contract + validator)**

In `apps/web/lib/diagnosis/types.ts` add to `SynthesisPacket`: `kind?: 'full_study' | 'quick_scan';` and `label?: string;`. In `validateSynthesisPacket`, before building `candidate`:
```typescript
  const kind = p.kind === 'quick_scan' ? 'quick_scan' : 'full_study';
  const label = clampStr(p.label, 120).trim();
```
Add to the `candidate` literal: `kind,` and `...(label ? { label } : {})`. Add a test: garbage `kind` → `'full_study'`; a 'quick_scan' passes; `label` clamped to 120.

- [ ] **Step 3: Run**

Run: `npm test -- segment diagnosis/synthesize diagnosis-packet-contract` → all green. `npm run typecheck -w apps/web` + `npm run typecheck -w packages/redaction` → clean.

- [ ] **Step 4: Commit**

```bash
git add packages/redaction/src/segment.ts packages/redaction/test/segment.test.ts apps/web/lib/diagnosis/types.ts apps/web/lib/diagnosis/synthesize.ts apps/web/lib/diagnosis/synthesize.test.ts
git commit -m "feat(diagnosis): packet carries study kind + label"
```

---

## Task D: Migration + endpoint store kind/label

**Files:**
- Create: `supabase/migrations/20260615130000_diagnoses_kind_label.sql`
- Modify: `apps/web/app/api/study/packet/route.ts` (+ the existing `apps/web/test/study-packet-route.test.ts`)

- [ ] **Step 1: Migration**

```sql
-- 20260615130000_diagnoses_kind_label.sql
-- Phase 3: quick scans coexist with the 14-day study. Tag each diagnosis with
-- its study kind + optional task label so the web history can badge + name them.
alter table public.diagnoses add column if not exists kind text not null default 'full_study'
  check (kind in ('full_study', 'quick_scan'));
alter table public.diagnoses add column if not exists label text
  check (label is null or char_length(label) <= 120);
```

- [ ] **Step 2: Apply to DEV only** (Supabase MCP `apply_migration`, project `oqnqzytctwlptfdvyagl`). Not prod.

- [ ] **Step 3: Endpoint writes kind/label**

In `route.ts`, the row built for insert/upsert adds `kind: packet.kind ?? 'full_study'` and `...(packet.label ? { label: packet.label } : {})`. (Both insert and upsert paths use the same `row`.) Update the existing route test to assert the upserted row includes `kind`.

- [ ] **Step 4: Run + commit**

Run: `npm test -- study-packet-route` → green. `npm run typecheck -w apps/web` → clean.
```bash
git add supabase/migrations/20260615130000_diagnoses_kind_label.sql apps/web/app/api/study/packet/route.ts apps/web/test/study-packet-route.test.ts
git commit -m "feat(api): store study kind + label on the diagnosis (migration + ingest)"
```

---

## Task E: Desktop UI — quick-scan entry + flow

**Files:**
- Modify: `apps/desktop/src/ui/views/field-study.ts`
- Modify: `apps/desktop/src/ui/views/consent.ts` (accept a variant for quick scan)
- Modify: `apps/desktop/src/ui/sync-study.ts` (pass `{kind, label}` to `segmentStudy`)
- Modify: `apps/desktop/src/ui/observer.css`

Context: `field-study.ts` renders per study state; `consent.ts` fires `consent`+`start`. `sync-study.ts` already calls `segmentStudy(studyId, events, now)` and reads `studyStatus`. The study snapshot now carries `kind`/`label`.

- [ ] **Step 1: Entry points (NOT_STARTED / terminal)**

When the study is `NOT_STARTED` (fresh) OR `COMPLETE`/`DELETED`, render two choices: **"Start 14-day field study"** (the existing consent→start path) and **"Quick scan a task"** (a small text input "What are you about to do?" + a Start button). From a terminal state, both first call `bridge.createStudy(crypto.randomUUID(), kind, label)` to mint a fresh study, then run consent→start. For the very first study (NOT_STARTED), the daemon already created one; calling `createStudy` to set the chosen kind/label is still correct (CreateStudy is valid from NOT_STARTED).

- [ ] **Step 2: Quick-scan capturing card**

For a `quick_scan` study in `ACTIVE`, render a capturing card WITHOUT the 14-day countdown — show the label, a "capturing…" state, a note ("stops automatically after 6 hours"), and a **"Stop scan"** button that sends `stop_early`. A `full_study` keeps the existing countdown UI. Branch on `study.kind`.

- [ ] **Step 3: Consent variant**

In `consent.ts`, accept a `kind` (default full). For `quick_scan`, swap claim 5 ("When it ends") copy to a short variant: "This scan stops the moment you tell it to — or after a few hours if you forget. Raw data auto-deletes after your map is built." Keep claims 1–4 + 6 verbatim.

- [ ] **Step 4: Pass kind/label through synthesis**

In `sync-study.ts`, read `kind`/`label` off the study snapshot (via the studyStatus the caller already has) and pass `segmentStudy(studyId, events, now, { kind, label })`.

- [ ] **Step 5: Verify**

Run: `npm run build -w apps/desktop` + `npm run typecheck -w apps/desktop` → clean. (UI is hard to unit test here; the `sync-study` unit test still passes since segmentStudy is mocked there.)

- [ ] **Step 6: Commit**

```bash
git add apps/desktop/src/ui/views/field-study.ts apps/desktop/src/ui/views/consent.ts apps/desktop/src/ui/sync-study.ts apps/desktop/src/ui/observer.css
git commit -m "feat(desktop): quick-scan entry, capture card, consent variant + kind/label through synthesis"
```

---

## Task F: Web — unified diagnoses history + detail route

**Files:**
- Create: `apps/web/app/app/diagnosis/DiagnosisReveal.tsx` (extract the reveal render)
- Modify: `apps/web/app/app/diagnosis/page.tsx`
- Create: `apps/web/app/app/diagnosis/[id]/page.tsx`
- Modify: `apps/web/app/app/diagnosis/diagnosis.module.css`

Context: `page.tsx` currently selects `.limit(1).maybeSingle()`. The diagnoses row now has `kind`, `label`; the packet (in `diagnoses.packet`) has `studyDays`. `Badge` + `Card` are from `../../../components/ui`. RLS scopes reads to account members.

- [ ] **Step 1: Extract the reveal into a shared component**

Move the hero render (letter card + total + "Where the hours go" workflow list + recommendations) from `page.tsx` into `DiagnosisReveal.tsx` as `function DiagnosisReveal({ map, letter }: { map: DiagnosisMap; letter: string | null })`. `page.tsx` imports + uses it for the newest diagnosis. (Pure refactor — no behavior change; verify the page still renders identically.)

- [ ] **Step 2: History query + list**

In `page.tsx`, change the query to select ALL diagnoses for the account (newest first), `select('id, map, letter, kind, label, created_at')` ordered `created_at desc` (cap e.g. `.limit(50)`). Render the newest via `DiagnosisReveal`. Below it, when there are older ones, a **History** section: for each, a `Card` linking to `/app/diagnosis/${id}` showing a badge (`kind === 'quick_scan' ? 'Quick scan' : '14-day study'`), the `label` (if any), `created_at` (formatted), and `map.totalHoursPerWeek` + workflow count. Keep the warm copy register.

- [ ] **Step 3: Detail route**

`apps/web/app/app/diagnosis/[id]/page.tsx` — server component: auth + `ensureAccount` (mirror page.tsx), `select('map, letter, kind, label').eq('id', id).eq('account_id', accountId).maybeSingle()` (RLS + the account scope), 404/redirect if missing, render `<AppShell active="diagnosis">` + the `kind`/`label` header + `<DiagnosisReveal map letter />`. A back link to `/app/diagnosis`.

- [ ] **Step 4: Verify**

Run: `npm run typecheck -w apps/web` → clean; `npm run build -w apps/web` if quick. Confirm `page.tsx` still renders the newest diagnosis identically (the refactor) and the history list + detail compile.

- [ ] **Step 5: Commit**

```bash
git add apps/web/app/app/diagnosis
git commit -m "feat(web): unified diagnoses history with kind/label badges + per-diagnosis detail route"
```

---

## Task G: STATE.md + final review

- [ ] **Step 1:** Record Phase 3 shipped in `docs/STATE.md` (quick scan: unique ids fix the overwrite bug; kind/label on study+packet+diagnosis; 6h backstop; web history+detail). Note follow-ups: concurrent studies, per-diagnosis web delete, scan scheduling. Move the Phase-3 follow-up under the field-study bullet to done.
- [ ] **Step 2:** Commit.
- [ ] **Step 3:** Final suite: `npm test -- segment diagnosis/synthesize diagnosis-packet-contract study-packet-route sync-study study-machine` + the Rust study-machine tests; both typechecks. Then dispatch a final code-reviewer over the Phase 3 diff (focus: the study-machine Rust↔TS twin parity, CreateStudy guard, per-kind window not breaking C2, RLS scoping on the detail route, validator clamping of kind/label).
