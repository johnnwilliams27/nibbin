# Memory Page — P1 Redesign (Company Brain)

**Date:** 2026-06-22
**Status:** Design — approved direction (D20 overrides §4.2 keep-as-is); pending implementation plan
**Surfaces:** `apps/web/app/app/memory/` (page, actions, CSS module)
**Branch:** feature/company-brain-memory-redesign

---

## 1. Problem

The current Memory page (`page.tsx`) is a form of naked textareas: seven fields in two `<details>` sections, one "Save" button. It reads and saves correctly — `save_grove_memory` + `loadGroveMemoryBlock` both work — but the UX sends the wrong signal:

- **Gospel feels editable by accident.** Textareas are always writeable. A fat finger on a phone can wipe the pricing section your Nibbins have used for 30 drafts. There is no friction protecting truth from sloppiness.
- **Content is unformatted.** `pricing: "Portraits start at $800 / 2hr session, includes 50 edited images. Add-ons: albums $400, prints at cost. 50% deposit, remainder 48h before shoot."` renders as a single grey paragraph. A bullet list would be scannable in 2 seconds; the paragraph takes 10.
- **Hard rules have no visual weight.** They're labelled "Hard rules" but appear identical to every other textarea — no urgency, no authority.
- **Provenance is invisible.** There is no way to know if the business facts came from onboarding last year or were typed this morning, whether they've been reviewed since the last Nibbin was added, or where a particular value came from.
- **There's no Sources tab.** The Foundation (when it lands) will give each field evidence from the connectors and Field Study. Today the page has nowhere to put that.

The redesign commits to a single framing shift: **this is not a settings form; it is the Company Brain — a document your Nibbins read as scripture.** The visual language must reflect that weight.

---

## 2. Design direction

**Tone:** editorial authority — a living document, not a settings pane. Calm, dense, inspectable. The interaction model (view → deliberate edit → save) is borrowed from how legal documents and medical records work: you can always change them, but you make a considered choice to do so.

**Visual direction:** soft-and-organic within the Nibbin token system. No new tokens; no custom palette. The redesign uses the existing system (`--canopy`, `--understory`, `--moss-tint`, `--moss-deep`, `--coral-deep`, `--ink`, `--ink-soft`, `--ink-faint`, `--line`, shadows, border-radii, display font) applied with more intention than the current form.

**One thing the user should remember:** "My Nibbins are reading this right now."

---

## 3. Page structure overview

```
/app/memory
├── Page header ("Company Brain" / "What your grove knows")
├── Tab bar — [Grove Memory] [Sources]          ← client tab state, no URL change
│
├── TAB 1: Grove Memory (truth)                 ← the headline
│   ├── Framing strip: "Your Nibbins read this as truth"
│   ├── Section: About your business
│   │   ├── FieldBlock: Business facts          ← view/edit pattern per §5
│   │   ├── FieldBlock: Pricing
│   │   └── FieldBlock: Policies
│   ├── Section: Voice & rules
│   │   ├── FieldBlock: Voice & tone
│   │   ├── FieldBlock: Common questions
│   │   ├── FieldBlock: Anything else (notes)
│   │   └── HardRulesBlock (visually distinct)  ← see §7
│   └── Empty state (first-run)                 ← §9
│
└── TAB 2: Sources (evidence)                   ← §8
    ├── Evidence list (per-field sources, Foundation-gated)
    └── Reference catch-all (freeform, always live)
```

---

## 4. Tab bar

A minimal two-tab bar anchored below the page heading. Uses the existing tab pattern established in `/app/connections` and `/app/settings`:

- **[Grove Memory]** — truth, always available
- **[Sources]** — evidence; badge shows source count once Foundation lands; shows "0 sources" with a note "Sources attach when the Foundation is live" until then

Tab state lives in `useState` (client component). No URL parameter — the page is already `force-dynamic`; a URL-driven tab is unnecessary for v1.

The two tabs are implemented as a client wrapper around the server-fetched data. The page remains a server component; it fetches `grove_memory` and passes field values as props. The tab bar and all field-level interaction (edit mode, confirm dialogs) are a `'use client'` component tree that receives the initial values as props and manages local state.

---

## 5. Grove Memory tab — the view/edit interaction model

### 5.1 Default state: VIEW mode (locked and formatted)

Every field renders in **view mode by default.** There are no textareas visible on load. Content is displayed as formatted output, not raw strings. An "Edit" affordance per field (or per section) allows the user to enter edit mode for that field only.

This is the most load-bearing design decision: the default state communicates that this content is **authoritative**, not a draft.

### 5.2 Edit granularity: per-field (recommended) or per-section

**Per-field** means each `FieldBlock` has its own `[Edit]` → `[Save] [Cancel]` controls. Only one field can be in edit mode at a time (opening a second field closes the first with a cancel, or prompts to confirm unsaved changes first).

**Per-section** means the "About your business" section (facts + pricing + policies) shares an edit button, and all three textareas appear together on edit. This is less precise but feels more natural if users tend to update all three after a rate change.

**Recommendation:** per-field. Finer granularity → lower error surface → fewer fat-finger wipes. It also makes the "confirm before clear" pattern cheaper (applies only to the field being edited). See §11 for the open fork.

### 5.3 Edit flow (per-field)

1. **View mode:** formatted content is displayed. A small `Edit` button (ghost, `--moss-deep` text, `--r-button`, 12px, sits at the top-right of the field's header row) is the sole affordance for entering edit mode.
2. **Entering edit mode:** the formatted view dissolves (opacity+translate, `--dur-2 --ease-settle`); a textarea (same styling as today's `.textarea`) replaces it with the raw text content. `Save` and `Cancel` appear below the textarea. The field's container gets a `--moss` left border accent (2px) to signal active editing. No other field changes.
3. **Saving:** calls `saveGroveMemory` as today (single `FormData` POST, server action). Since only one field changes at a time, the server action must accept a partial update — see §6 for the action contract.
4. **Cancelling:** no save, field returns to view mode. If the textarea value differs from the original, a one-line inline confirmation ("Discard changes?") appears inline before the cancel completes — not a modal.
5. **Clearing a field:** the "Clear field" action (a tertiary destructive link, `--coral-deep`, shown only in edit mode below the textarea) triggers an inline confirm: "Clear [field name]? Your Nibbins won't have this to draw on." Two buttons: `[Clear] [Keep it]`. On confirm, saves an empty value for that field via the same action.
6. **Success/error feedback:** the existing `?saved=1` redirect pattern works but is jarring in per-field edit mode (full page reload). Replace with an optimistic local state update: on action response, update the displayed value in the client and show a transient `Saved` indicator (the `--moss-tint` banner shrunk to an inline check + "Saved" for 2.5s). If the server action returns an error, restore the prior value and show the error inline.

### 5.4 The action contract change for per-field saves

Today's `saveGroveMemory` writes **all seven fields** in one call. Per-field editing needs a partial-write variant. Two options:

**Option A (recommended):** Keep `save_grove_memory` as-is (it upserts the full `sections` + `hard_rules` + `notes` blob). The client maintains a local mirror of all field values; when the user saves one field, the action is called with the full current mirror (the other fields unchanged from their loaded state). This requires zero RPC changes and works today.

**Option B:** Add a `save_grove_memory_field(field_key, value)` RPC for true surgical field writes. Cleaner semantically; requires a migration. Deferred — Option A unblocks the UX without schema work.

**Decision: Option A.** The client component holds `Record<string, string>` state initialized from the server-fetched values; each per-field save transmits the full record with the one changed field. This is safe because the page is non-collaborative (single user per account editing their brain).

---

## 6. Field rendering by type

The "view mode" display is not a generic `<pre>` block. Each field type gets formatting that makes it more scannable:

### 6.1 Freeform text fields (facts, voice, notes)

**Voice & tone:** rendered as a styled blockquote — left border in `--moss-tint` (4px), italic, `--ink` color, `--sans` 15px, `1.65` line-height. The quote treatment signals "this is how you sound" rather than a list of instructions.

**Business facts:** multi-line content split on `\n` (how the onboarding seeder produces it) and rendered as a `<dl>` (definition list): each `Label: value` pair becomes a `<dt>` + `<dd>`. Unstructured freeform paragraphs (no label prefix) render as `<p>` elements. If the content has no `:\s` separator pattern, it renders as one or more `<p>` blocks.

**Anything else (notes):** rendered as `<p>` blocks split on double-newlines; single newlines preserved as line breaks. Plain text.

### 6.2 List-structured fields (pricing, policies, faq)

Content is split on `\n` and rendered as an unordered list (`<ul>`) of `<li>` items. Empty lines become visual separators (a thin `<hr>`-equivalent gap). Single-item content renders as a plain `<p>` rather than a one-item list (lists of one feel incomplete).

**Pricing** gets one additional affordance: if a line matches a price pattern (`\$[\d,]+`) the numeric part is rendered in `font-variant-numeric: tabular-nums` + slight weight boost — the number stands out without needing a separate class.

### 6.3 Hard rules (see §7)

Separate component; distinct visual treatment.

### 6.4 Empty field view

When a field has no content, view mode shows a faint placeholder line in `--ink-faint`: `"Add your pricing..."` etc., plus the `Edit` button. The placeholder communicates the field's purpose without demanding the user fill it. Not a textarea — not editable without an explicit action.

### 6.5 Markdown note

The spec does not introduce a markdown parser. All formatting is derived structurally from the raw text (newlines, price patterns, colon-label pairs). This keeps the rendering deterministic and compatible with `loadGroveMemoryBlock`'s plain-text output — the raw `sections` stored in the DB stays unchanged.

---

## 7. Hard rules — distinct visual treatment

Hard rules are the load-bearing invariants. The `HardRulesBlock` is visually distinct from every other field:

**View mode:**
- Container: `--understory` background, `2px solid --coral-soft` left border (4px), `--r-card` radius.
- Eyebrow: `HARD RULES` in `--mono` 11px uppercase `--coral-deep`, letter-spaced.
- Sub-label: "Your Nibbins never break these" in `--ink-soft` 12px.
- Rules list: each rule rendered as a `<li>` with a small coral square bullet (CSS `content: "■"` in `--coral-deep` 8px) to the left of the rule text. Rule text is `--ink`, 14px, `1.5` line-height.
- Empty state: "No hard rules yet" in `--ink-faint` + Edit affordance.

**Edit mode:**
- The `HardRulesBlock` switches to a single textarea (one rule per line, matching today's behavior). The container retains its coral left border accent. The hint copy ("One per line. Your Nibbins treat these as non-negotiable — never broken in a draft.") appears above the textarea.

**Why not the same as other fields:** hard rules are the one category where the user explicitly intended zero ambiguity. The coral accent — used nowhere else in the grove experience for non-error states — signals authority and irreversibility without alarming the user (it is the soft coral, not the error coral).

---

## 8. Sources tab

### 8.1 Independent-of-Foundation: Reference catch-all (always live)

A free-text textarea (or small rich-text editor) where the user can paste anything the grove should reference: a full rate guide PDF paste, a long policies document, a bio, example client emails. This is the §6.4 "Reference" catch-all in the COMPANY-BRAIN spec.

The Reference field saves to `grove_memory.notes` (the existing column, max 8000 chars). It is labelled clearly as "Reference material — overflow context your Nibbins can draw on" to distinguish it from the structured fields. It does not render formatted in view mode (too varied); it renders as `<pre>` wrapped at 100% width, `--sans` 13px, `--ink` color.

In view mode, long Reference content is truncated at ~20 lines with a "Show all" / "Collapse" toggle (pure CSS `max-height` + overflow, animated `--dur-3 --ease-settle`).

The Sources tab is functional from day one because of this catch-all. The tab is not an empty waiting room.

### 8.2 Foundation-gated: Evidence list (attaches when Foundation lands)

When the Foundation ships (`sources`, `field_evidence`, `field_meta` tables), the Sources tab gains an evidence list:

**Layout:** a vertical list of source cards, grouped by field. Each card shows:
- Source type icon (connector glyph for Gmail/Calendar/Stripe; Field Study icon for observed data; manual icon for user-entered)
- Source label ("From Gmail — 3 client threads", "From Field Study — observed 14 days")
- A one-line excerpt of the evidence (the text fragment that informed this field value)
- `Last seen` timestamp
- A `View` link that opens an evidence detail drawer (outside scope of this spec, designed when Foundation lands)

**Empty state (pre-Foundation):** a single info banner replaces the evidence list:
> "Evidence attaches automatically when the Foundation is live. Your Nibbins are reading the truth fields you've written — that's what matters right now."

The banner uses `--understory` background, `--ink-soft` text, `--line` border. No spinner, no skeleton — just an honest empty state with Nibbin voice.

**Graceful degradation contract:** the Sources tab code must not import any types from the Foundation tables at build time (they don't exist yet). Evidence rendering is a separate dynamic segment or guarded by a feature flag (`SOURCES_ENABLED=false` env var). The tab itself renders without error in either state.

---

## 9. Empty state (first-run)

When all fields are empty (`allEmpty` as today), the Grove Memory tab shows:

A centered illustration zone (the creature at its egg stage, 80×80px SVG, the existing creature component at `packages/creatures`) above a two-line message:

> **"Your grove doesn't know much yet"**
> Fill in a few sections and your Nibbins will start sounding unmistakably like you. Even one or two sentences per field makes a real difference.

Below the message, two affordance chips: `[Start with business facts]` and `[Set your voice]` — ghost buttons that open that specific field in edit mode immediately (keyboard focus into the textarea, field scrolled into view).

The first-run banner from today (`firstRun` CSS class) is replaced by this. The creature illustration gives the page warmth without being precious about it — it's the same creature already shown on the Grove home and other empty states.

---

## 10. Framing strip

Below the tab bar and above the first section, a single-line framing strip in `--understory`, `--r-card` radius, `10px 14px` padding:

> Small leaf glyph (14px) — "Your Nibbins read this as truth. They'll quote it, paraphrase it, and follow it — every draft."

Font: `--sans` 13px, `--ink-soft`. This strip appears only in the Grove Memory tab and only when there is content. It disappears on first-run (the empty state carries its own framing). It also disappears in edit mode for the active field (to keep the editing surface clean).

---

## 11. Provenance / staleness line (attaches when Foundation lands)

Each `FieldBlock` has a reserved slot below the field content (in view mode) for a provenance/staleness line:

> `Last reviewed · 14 days ago · From Field Study`

Rendered in `--ink-faint` 11px, `--mono`, the same eyebrow font. The slot height is fixed in CSS so the page layout does not shift when provenance data loads or is absent.

**Pre-Foundation:** the slot is empty (no visible text, just the reserved space). No placeholder text, no "unknown" fallback — silence is more honest than fabricated provenance.

**Post-Foundation:** populated from `field_meta.last_reviewed_at` + `field_meta.primary_source`. The source label maps to human text: `'field_study'` → "From Field Study", `'connector:gmail'` → "From Gmail", `'user_entered'` → "You wrote this", `'seeded'` → "From your onboarding".

**Staleness signal:** if `last_reviewed_at` is > 60 days ago, the provenance line gets a soft amber tint (`--honey-deep` text instead of `--ink-faint`) and the text becomes `"Last reviewed · 3 months ago — worth a check?"`. No warning icon (would be alarmist); just the color shift and the question. This threshold is a constant in the component, not hardcoded to 60 days everywhere.

---

## 12. Component breakdown

All components live in `apps/web/app/app/memory/`. The module CSS stays co-located.

```
memory/
├── page.tsx                   — server component (unchanged contract: fetches grove_memory,
│                                passes fieldValues + is_empty as props to MemoryClient)
├── actions.ts                 — saveGroveMemory (mostly unchanged; see Option A note §5.4)
├── memory.module.css          — extended; new classes for view-mode, edit-mode, hard-rules,
│                                provenance line, tab bar, sources tab
└── MemoryClient.tsx           — 'use client'; receives initialValues + tabState
    ├── TabBar.tsx             — two tabs, client state
    ├── GroveMemoryTab.tsx     — the truth tab
    │   ├── FramingStrip.tsx   — "Your Nibbins read this as truth" banner
    │   ├── MemorySection.tsx  — section wrapper (heading + hint + field list)
    │   ├── FieldBlock.tsx     — view/edit toggle, formatted display, provenance slot
    │   │   ├── FieldView.tsx  — formatted rendering by type (list / dl / quote / p)
    │   │   └── FieldEditor.tsx— textarea + Save/Cancel + clear destructive link
    │   ├── HardRulesBlock.tsx — distinct coral-accented block for hard_rules
    │   └── EmptyState.tsx     — first-run creature + affordance chips
    └── SourcesTab.tsx         — Sources tab
        ├── ReferenceCatchAll.tsx — always-live freeform textarea (saves to notes)
        └── EvidenceList.tsx   — SOURCES_ENABLED-gated evidence list + empty state
```

`FieldBlock` maintains `mode: 'view' | 'editing'` + `localValue: string` in `useState`. The top-level `MemoryClient` holds the full `values: Record<string, string>` mirror and passes `onSave(field, newValue)` down; `onSave` updates the mirror and calls the server action.

---

## 13. Motion

- **View → edit transition:** textarea fades in (`opacity 0→1`, `translateY(4px)→0`), `--dur-2 --ease-settle`. The formatted view fades out simultaneously (crossfade). No layout shift — the field container height grows smoothly via `height: auto` transition handled with a CSS `grid-template-rows: 0fr → 1fr` trick (already used in the Keeper dock).
- **Edit → view transition:** reverse — same duration, same easing. The "Saved" indicator fades in then out on a 2.5s timer.
- **Tab switch:** fade `opacity 0→1`, `--dur-2 --ease-settle`. The tab content does not slide.
- **Destructive confirm (inline):** confirm buttons fade in below the "Clear field" link, `--dur-1`. No modal, no overlay.
- `prefers-reduced-motion`: all durations collapse to `0.01ms` via the global rule already in `globals.css`.

---

## 14. Accessibility

- Every `FieldBlock` edit button has `aria-label="Edit [field label]"`.
- When edit mode opens, focus moves to the textarea (`autoFocus` on the `<textarea>` in `FieldEditor`).
- When edit mode closes (save or cancel), focus returns to the `Edit` button for that field.
- `HardRulesBlock` textarea is labelled by the existing hint text (`aria-describedby`).
- Tab bar uses `role="tablist"` + `role="tab"` + `aria-selected` + keyboard arrow-key navigation (standard pattern already used in `/app/settings`).
- The "Clear field?" inline confirm uses `role="alertdialog"` equivalent: an `aria-live="assertive"` region so screen readers announce it without focus loss.

---

## 15. Compatibility with `loadGroveMemoryBlock`

`loadGroveMemoryBlock` reads `grove_memory.sections`, `grove_memory.hard_rules`, `grove_memory.notes` and formats them as plain text for the agent context. This redesign makes **zero changes** to the DB schema, the RPC, or the data shape. The only change to `actions.ts` is the Option A field-mirror pattern (§5.4), which still calls `save_grove_memory` with the same signature. `loadGroveMemoryBlock` does not need to be touched.

MEMORY_SECTIONS (`lib/grove/memory.ts`) is not changed. The section keys, order, and labels remain identical. The redesign is purely a presentation layer sitting above the existing data model.

---

## 16. What ships without the Foundation vs. what waits

### Ships independently (over today's `grove_memory`)

| Feature | Status |
|---|---|
| Two-tab structure (Grove Memory + Sources) | Ships |
| View/edit toggle per field | Ships |
| Formatted field rendering (lists, dl, quote) | Ships |
| Hard rules visual treatment | Ships |
| Framing strip | Ships |
| Empty state with creature + affordance chips | Ships |
| Per-field save (Option A client mirror) | Ships |
| Destructive clear with inline confirm | Ships |
| Reference catch-all in Sources tab | Ships |
| Motion (view↔edit crossfade, tab switch) | Ships |

### Attaches when Foundation lands

| Feature | Gate |
|---|---|
| Provenance / staleness line per field | `field_meta` table |
| Evidence list in Sources tab | `sources` + `field_evidence` tables |
| Source type icons | Same |
| Staleness amber tint | `field_meta.last_reviewed_at` |

### Never built here

| | Reason |
|---|---|
| Rich-text / markdown editor | See §11 open fork — plain text + structural rendering keeps DB/LLM compatibility; defer until there is a real user need |
| Per-user contribution tracking | Foundation concern |
| Export / copy-to-clipboard | Nice-to-have; not blocking |

---

## 17. Open forks for human review

**Fork 1 — Per-field vs. per-section edit granularity (§5.2):**
The spec recommends per-field (finer protection, lower error surface). The alternative is per-section (facts + pricing + policies together; voice + faq + notes together) which may feel more natural to users who update all three business details after a rate change. Pick before writing the implementation plan. If in doubt, ship per-field — it is the safer default and can be relaxed.

**Fork 2 — Rich-text vs. structural plain-text rendering (§6):**
The spec commits to structural rendering (split on `\n`, detect label: patterns, render as `dl`/`ul`). The alternative is accepting light markdown in the textareas (rendered with a minimal parser — asterisks for bold, hyphens for bullets). Markdown would give users explicit control over formatting at the cost of: (a) markdown leaking into `loadGroveMemoryBlock`'s plain-text output (asterisks appearing in agent context), (b) a parser dependency, (c) a slightly higher cognitive load. Structural rendering is safer for LLM compatibility. **Recommendation: structural.** Only override if user testing shows the `\n`-based auto-formatting produces wrong results frequently.

**Fork 3 — `notes` as Reference catch-all vs. a new column (§8.1):**
The Reference catch-all saves to `grove_memory.notes` (max 8000 chars). If the Reference field needs to be kept strictly separate from the "Anything else" notes field shown in the Grove Memory tab, a new `reference_text` column would be needed (migration + RPC change). For v1 this is unnecessary: `notes` can serve both purposes, with the Grove Memory tab's "Anything else" field and the Sources tab's Reference field being the same underlying value, which means "Anything else" is removed from the Grove Memory section (it becomes Reference-only). This simplifies the model. Decide before implementation.
