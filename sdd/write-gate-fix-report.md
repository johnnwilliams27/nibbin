# Write-Gate Fix Report — Gate Round 2
**Branch:** feature/connector-lever1  
**Date:** 2026-06-20  
**Reviewer pass:** adversarial-gate (red-team + claims-auditor + logic-skeptic + cost-auditor)

---

## The Model (framing applied everywhere)

Connect requests **read + write** scopes at OAuth connect time. Execution is gated by the earned-autonomy model: while a Nibbin is in School it **drafts every side effect for your approval**; once it earns trust (Graduate, or a Senior on a proven routine) it may act autonomously. Acquiring a scope never authorizes an unapproved action.

Phrases removed: "read-only at connect", "read-only until you say otherwise", "every action always requires your approval".

---

## PART A — Stale "read-only at connect" copy

### A1. SPEC.md:59 — C8 claim row (P0)
**Changed:** C8 claim and engineering meaning rewritten.  
**Old:** `"Your connections are read-only until you say otherwise" | Day One OAuth scopes are minimal and read-only; write scopes requested incrementally, per Nibbin, at adoption time...`  
**New:** `"Nothing acts on your behalf while a Nibbin is still learning" | Connect requests the access your Nibbins may use (read + write scopes, explained plainly). Execution is gated by the earned-autonomy model...`  
**Framing:** earned-autonomy model, scope ≠ authorization.

### A2. SPEC.md:106 — onboarding step 4 (P0)
**Changed:** "read-only scopes (C8)" → "OAuth consent covers read + write scopes explained plainly (C8)"  
**Framing:** accurate scope description, C8 reference retained.

### A3. docs/submissions/google-oauth-verification.md:35-37 (P1, external)
**Changed:** Three-line block rewritten. Removed "Read-only is the Day-One default (C8); write scopes are requested incrementally, per Nibbin, at adoption time."  
**New:** Accurate statement that connect requests read + write together at consent; execution gated by earned-autonomy model.  
**Framing:** strongest minimal-scope + user-control story for Google reviewer.

### A4. docs/submissions/google-oauth-verification.md:63 (P1, external)
**Changed:** App description line: "Connections are read-only until the user explicitly grants a specific write action" → accurate earned-autonomy description.

### A5. docs/submissions/google-oauth-verification.md:67 (P1, external)
**Changed:** Removed "Access is read-only;" from Gmail readonly scope justification (factually false — send scope is also being requested).

### A6. reference/nibbin-demo.html:425 (P1)
**Changed:** "connects your tools read-only" → "connects your tools"  
**Framing:** neutral, accurate.

### A7. reference/nibbin-demo.html:459 (P1)
**Changed:** "read-only until you say otherwise" → "nothing acts on its own while a Nibbin is still learning"  
**Framing:** earned-autonomy framing.

### A8. docs/help-compendium.md:58 (P1)
**Changed:** "Connections start read-only; a Nibbin asks for write access (drafting) separately and in plain words when it needs it (INVARIANT C8)" → accurate earned-autonomy description at connect.

### A9. docs/help-compendium.md:107 (P1)
**Changed:** "Read-only to start; write access is granted per Nibbin, by you" → "Write scopes are requested at connect with a plain-language explanation; while a Nibbin is learning it drafts every side effect for your approval."

### A10. docs/help-compendium.md:178 (P1)
**Changed:** "Read-only by default. A Nibbin requests write access (drafting) per-Nibbin, in plain words..." → earned-autonomy gated framing, accurate scope-at-connect description.

### A11. docs/help-compendium.md:179 (P1)
**Changed:** "`gmail.readonly` at connect; drafting scopes added per-Nibbin" → "`gmail.readonly` + `gmail.compose` + `gmail.send` requested at connect". Also added Calendar scope detail.  
**Framing:** factually accurate per current connect implementation.

### A12. docs/help-compendium.md:222 (P1)
**Changed:** "Connections are read-only until you say otherwise (C8)" → "Nothing acts on your behalf while a Nibbin is learning (C8)" with full earned-autonomy description.

### A13. docs/help-compendium.md:371 (P1)
**Changed:** "Are my connections read-only? Yes, to start." → accurate: scopes at connect, drafts while learning, autonomous once trusted.

### A14. docs/help-compendium.md:385 (P1)
**Changed:** "Gmail (read-only at first; voice-learning read optional)" → "Gmail (read + write scopes at connect; voice-learning read optional)"

### A15. packages/keeper/src/copy.ts:97 (P1, LIVE runtime)
**Changed:** "your connections start read-only, nothing acts without your approval while it's learning" → "connections request the access your Nibbins may use — nothing acts on its own while a Nibbin is still learning, it drafts for your approval"  
**Framing:** earned-autonomy model, accurate.

### A16. apps/web/lib/help/content.ts:99 (P2)
**Changed:** gs-connect-gmail body: "Connections start read-only; a Nibbin asks for write access (drafting) separately" → "OAuth consent covers read + write scopes at connect, explained plainly; while a Nibbin is learning every side effect is drafted for your approval."

### A17. apps/web/lib/help/content.ts:273-274 (P2)
**Changed:** priv-connections-data body: "Connections start read-only. When a Nibbin needs to act..." → "Connect requests read + write scopes at OAuth consent, with a plain-language explanation for each. While a Nibbin is in School..."  
Also updated keywords: removed "read-only", added "write scopes", "earned autonomy".

### A18. apps/web/lib/help/content.ts:377 (P2)
**Changed:** conn-what-do-connections-do: "Connections start read-only. When a Nibbin needs to take action... it asks for write access per Nibbin, in plain words" → OAuth consent + earned-autonomy framing.

### A19. apps/web/lib/help/content.ts:384 (P2)
**Changed:** conn-whats-live: "starts with read-only access (gmail.readonly). If you adopt a Nibbin that drafts replies, it will ask for drafting scope separately" → "OAuth consent covers gmail.readonly + gmail.compose + gmail.send — explained plainly."

### A20. apps/web/lib/help/content.ts:398-399 (P2)
**Changed:** conn-read-vs-write: "Every connection starts read-only... Write access is granted per Nibbin, by you, in plain words, only when a specific Nibbin needs it" → "Connect requests the scopes your Nibbins may use (read + write)... Holding a write scope doesn't authorize action — execution is gated by the earned-autonomy model."  
Also updated keywords.

### A21. apps/web/lib/help/content.ts:651 (P2)
**Changed:** faq-what-connections: "Gmail (read-only at first; drafting scope added per Nibbin)" → "Gmail (read + write scopes at connect; while a Nibbin is learning it drafts for your approval)"

### A22. apps/web/lib/privacy/panel.ts:20-21 (P2, comment)
**Changed:** "read-only-when-empty rule (no scopes → "Read-only access", since read-only is the default until a Nibbin requests writes" → "access display rule (no write grant → "Read-only access", since a write grant is required before a Nibbin can execute side effects"  
**Note:** The code behavior is unchanged; only the misleading comment is corrected.

### A23. reference/subprocessors.html:56 (P2)
**Changed:** "Google / Gmail" → "Google / Gmail + Calendar"; "read-only mail access" → "read and write scopes requested at connect... execution gated by earned-autonomy model". Added calendar events to data description.

### A24-A25. .agents/skills/connector-builder/SKILL.md:16 and .claude/skills/connector-builder/SKILL.md:16 (P2)
**Changed:** "Day One = read-only scopes (C8). Write scopes requested per-Nibbin at adoption with plain-language explanation." → "Connect requests read + write scopes at OAuth consent with plain-language explanation (C8). Execution of write side effects is gated by the earned-autonomy model — drafts-for-approval while in School, autonomous only once trusted."

---

## PART B — Overstated approval copy

### B1. packages/runtime/src/capabilities.ts:116-117 (P1, comment)
**Changed:** "event creation never auto-fires without a human yes until the Nibbin has earned it" → "while a Nibbin is learning (below Graduate / below proven-routine Senior) it drafts the event for approval; Graduate or proven-Senior may auto-execute."  
**Framing:** matches gateSideEffect logic exactly.

### B2. apps/web/lib/connections/grants.ts:28 (P1, comment)
**Changed:** CapabilityTier `event_create` comment: "gated per-event by approval" → "gated by earned-autonomy model — drafts while learning, autonomous once trusted"  
**Framing:** accurate to the runtime model.

### B3. docs/INVARIANTS.md:12 — C8 (authoritative register)
**Changed:** "every side effect requires the Nibbin's Agent School stage + your approval + send-velocity caps" → earned-autonomy model description: while in School → drafted for approval; Graduate or proven-routine Senior → may auto-execute. Send-velocity caps scoped to bulk-send rails only.  
**Framing:** matches gateSideEffect; no longer overstates "every side effect requires approval."

### B4. docs/help-compendium.md:387 — write/send permissions FAQ (P1)
**Changed:** "Read-only by default. Write access is granted per-Nibbin through a separate approval, climbing a tier ladder" → accurate: write scopes at connect, trust ladder, autonomous only at Graduate/proven-Senior.

---

## PART C — Code fixes

### C1. packages/runtime/src/runner.ts:deriveResourceClaim — calendar.event-create resource lock (P3)
**Added:** New branch for `calendar.event-create` capability. Uses `iCalUID` if present (stable Google identity); falls back to `summary|start` deterministic key. Returns `{ resourceType: 'calendar', resourceId: ... }` so two concurrent runs cannot both create the same logical calendar event. Mirrors email/invoice claim derivation pattern.

### C2. packages/connectors/src/connectors/google-calendar.ts:3 — header comment (P3)
**Changed:** "Read scope only on Day One; calendar.events write arrives per-Nibbin (C8)" → accurate: write scope requested at connect; runtime gateSideEffect is the primary authority; local scope-check is defense-in-depth.

### C3. packages/connectors/src/connectors/google-calendar.ts:97-100 — createEvent comment (P3)
**Changed:** "Post-adoption write path (calendar.events grant required — C8)" → "Write path — requires calendar.events scope (defense-in-depth check; the primary gate is gateSideEffect in the runtime...)". Error message updated accordingly.

### C4. packages/runtime/test/runner-invariants.test.ts — Senior+proven-routine test (P1, new test)
**Added:** "a Senior WITH the grant AND a proven routine EXECUTES the calendar event (earned-autonomy)" — seeds `routineMinApprovals` (5) approvals for pattern key `cal-1`, asserts outcome `'executed'` and 1 execution. Locks the intended earned-autonomy behavior so copy and code agree. Existing 4 C8 tests preserved.

### C5. apps/web/lib/connections/grants.ts:119-124 — deriveCapabilityTier both-grants bug (P2)
**Fixed:** Calendar branch previously only fired when `!active.has('email.draft')`, causing `draft_only` to be returned when a Nibbin held BOTH `email.draft` and `calendar.event-create`. Fixed by checking `active.has('calendar.event-create')` first (calendar takes priority).

### C6. apps/web/lib/connections/grants.test.ts — both-grants regression test (P2)
**Added:** "deriveCapabilityTier → event_create when BOTH email.draft and calendar.event-create active (calendar takes priority)" — verifies the bug fix.

---

## Test Output

```
Test Files  5 passed (5)
     Tests  63 passed (63)
  Start at  15:41:44
  Duration  3.31s

Files tested:
  packages/runtime/test/runner-invariants.test.ts  — 29 tests ✓ (incl. new Senior+proven-routine)
  apps/web/lib/connections/grants.test.ts           — 13 tests ✓ (incl. new both-grants regression)
  packages/connectors/test/calendar-delta.test.ts  — 15 tests ✓
  apps/web/lib/connections/begin.test.ts            — 5 tests ✓
  apps/web/test/begin-connect.test.ts               — 1 test  ✓
```

All tests pass. No regressions.

---

## Files Changed

| File | Change type |
|------|-------------|
| SPEC.md | A1, A2 |
| docs/submissions/google-oauth-verification.md | A3, A4, A5 |
| reference/nibbin-demo.html | A6, A7 |
| docs/help-compendium.md | A8–A14, B4, A (line 387) |
| packages/keeper/src/copy.ts | A15 |
| apps/web/lib/help/content.ts | A16–A21 |
| apps/web/lib/privacy/panel.ts | A22 |
| reference/subprocessors.html | A23 |
| .agents/skills/connector-builder/SKILL.md | A24 |
| .claude/skills/connector-builder/SKILL.md | A25 |
| packages/runtime/src/capabilities.ts | B1 |
| apps/web/lib/connections/grants.ts | B2, C5 |
| docs/INVARIANTS.md | B3 |
| packages/runtime/src/runner.ts | C1 |
| packages/connectors/src/connectors/google-calendar.ts | C2, C3 |
| packages/runtime/test/runner-invariants.test.ts | C4 |
| apps/web/lib/connections/grants.test.ts | C6 |
