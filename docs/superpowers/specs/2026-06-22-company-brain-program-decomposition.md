# Company Brain — Program Decomposition & Ground-Truth Reconciliation

**Date:** 2026-06-22
**Status:** Program-level plan. Canonical positioning/spec lives in [`docs/COMPANY-BRAIN.md`](../../COMPANY-BRAIN.md) (stored verbatim — do not silently edit; change decisions in its §16 Decision Log or here).
**Purpose:** Reconcile the Company Brain spec against what is actually shipped in the codebase (2026-06-22), record the decisions made during the brainstorm that refine it, and decompose the work into independently-buildable chunks for parallel worktrees.

---

## 1. Framing (decided with John, 2026-06-22)

This is **option "(1) reframe over existing work, with pockets of (2) course-correction"** — *not* a rewrite. The existing roadmap (Agent Synthesis, connector batch, capture bring-up, Action Levels, agent memory/RAG, reach-me/notifications) already circles what this doc distills and centralizes. The job is **refine + add + fine-tune**, plus a **real reposition**:

> Broaden the target from individuals / freelancers / creators → **a general work tool that fits one person *or* a large organization.** "The same brain either way." Multi-user remains roadmap-not-present-tense (do not claim it shipped).

Where the spec *seriously* diverges from what's built (beyond target customer), it's flagged in §3 and was resolved in §4.

---

## 2. Ground-truth: what's already built vs. what's genuinely new

Verified by four parallel codebase explorers, 2026-06-22.

### Already shipped — the spec lists these as "to build," but they exist (verify/harden only)

| Spec item | Reality | Key files |
|---|---|---|
| §11-1 Tenancy seam ("load-bearing") | `accounts → memberships(owner/admin/member) → users`; every domain table `account_id`-scoped; RLS via `private.is_account_member()`. Multi-user = permissions on top, **not a migration**. | `supabase/migrations/20260610170000_m1_account_hierarchy_and_credit_ledger.sql` |
| §8.1 / §11-4 Hybrid retrieval on pgvector | `match_memory()` RPC = 60% vector (Voyage `voyage-3`) + 25% FTS + 15% recency. **Done — but agent-internal only** (RPC revoked from authenticated). | `supabase/migrations/20260618030000_agent_memory.sql`, `apps/web/lib/memory/retrieve.ts`, `apps/web/lib/llm/embed.ts` |
| §5.1 / §11-2 Promote Connections (NIB-3/NIB-5) | Already top-level nav; errors render in-page. **Stale claim — effectively closed.** | `apps/web/components/shell/AppShell.tsx`, `apps/web/app/app/connections/page.tsx` |
| §10 Notification center, quiet-hours, digest, push rail | Present: `notifications`, `notification_settings`, `channel_prefs`, reach channels. Type-extensible via `insert_system_notification()`. | `supabase/migrations/20260612000000_m5_drip_email.sql`, `20260618120000_notifications_reach_kind.sql`, `apps/web/components/shell/NotificationBell.tsx` |
| Grovekeeper "no hands" | Confirmed (C10 — zero side-effect tools; reads + talks only). | `apps/web/app/app/grove/actions.ts`, `packages/keeper/src/prompt.ts` |
| Action Levels gate; Agent School (advisory); approvals/edit-distance history | Shipped. Gate in runner; School advisory. | `supabase/migrations/20260620190000_nibbin_action_level.sql`, `packages/runtime/src/runner.ts`, `packages/runtime/src/school.ts` |
| Grove Home "Needs you" badge | Exists — but approval-count only. | `apps/web/app/app/page.tsx` |
| Gmail day-1 seeding → Grove Memory | Shipped (voice/facts/FAQ sweep, fills empty slots only). | `apps/web/lib/sweep/gmail-onboarding.ts`, `apps/web/lib/sweep/derive.ts` |
| Generic MCP/API rail (for proprietary systems, §7) | Exists: deny-by-default egress proxy, quarantined results, user-supplied HTTPS MCP URL + token. | `packages/connectors/src/rails/mcp.ts` |

### Genuinely new work (the real spec)

1. **Memory data model** — no first-class *evidence/Sources* store, no *typed claim→evidence link*, no *append-only history* under `grove_memory` (only a `version` counter). Provenance *data* exists on `memory_entries` (`provenance`, `source`, `confidence`, `last_seen_at`) but is not linked to curated fields. **← keystone.**
2. **One shared propose→review→approve→write loop** — today only the Gmail sweep writes memory; no generic review queue. Doc-drop, capture, collate, and conflict all need this same primitive.
3. **Sources tab + per-field provenance/staleness UI** — net-new surface over partly-existing data.
4. **Document ingestion** — zero today (no upload/parse/extract anywhere). Fully new.
5. **Passive-capture propose loop** — capture + review-to-*exclude* exist (`/app/study/*`); no propose-*into*-memory path. Captured work does not reach Grove Memory.
6. **Ingestion breadth** — calendar/files/contacts/Stripe not feeding memory; registry declares many connectors, only Gmail+Calendar wired.
7. **User-facing synthesis (`think`) + gap analysis** — retrieval engine exists; the *user-facing* cited-answer surface is new.
8. **Attention-queue wiring** — item-level stakes field, conflict/review notification *types*, **Grovekeeper read-access to pending items** (none today), Grove Home roll-up, **Keeper-dock unread red-bubble**.
9. **Conflict resolution + learned source-authority** — fully new. Raw `approvals`/edit-distance data exists to build on; no conflict algorithm, no source-authority ranking.
10. **Repositioning + doc reconciliation** — see §5.

---

## 3. Where the spec diverged — and how it was resolved (§4)

| # | Spec said | Reality | Resolution |
|---|---|---|---|
| A | §8 synthesis "genuinely missing" | RAG/hybrid retrieval **is** built; only the *user-facing* surface is missing | Build the user-facing surface only (D18) |
| B | §7 "generic MCP declarative substrate; no per-company builds" | Core connectors hand-coded; generic-MCP rail exists as escape hatch | **Two lanes** (D17): out-of-box catalog **on Nango** + generic MCP/API rail for proprietary |
| C | §11-1 tenancy "build the seam" | Seam already exists | Verify/harden; no migration |
| D | §5.1 Connections "buried in Settings / errors below fold" (NIB-3/5) | Already top-level + in-view errors | Closed; reduce §11-2 to "wire more sources" |
| E | §9.6 source-authority ranking | Not built | New build (C2) |

---

## 4. Decisions added this session (extends COMPANY-BRAIN.md §16)

- **D17 — Adopt Nango now for the out-of-box connector lane.** Wire the *existing* Google (Gmail + Calendar) and Stripe connectors into Nango this batch (a contained migration, not a replatform). The generic MCP/API rail (`packages/connectors/src/rails/mcp.ts`) is retained for proprietary/company systems that aren't out-of-the-box. **This supersedes** `docs/decisions/2026-06-22-connector-strategy-diy-vs-aggregator.md` (which said *DIY now, revisit Nango at inflection*) — a superseding ADR note is part of D1.
- **D18 — Synthesis is Grovekeeper-only as a *surface*, with a *reusable engine* behind it.** The synthesis/`think` engine (cited answer + gap note) is a standalone internal service the Keeper calls — *not* logic embedded in chat — so it can later feed the morning brief, provenance affordances, etc. No second user-facing query surface and no second budget tally: synthesis runs on the **one centralized Keeper chat budget**. Discoverability comes from the Keeper **surfacing prompts like notifications** (ties to the Keeper-dock red-bubble in P6); structured output via a **"view details" → modal**. Matches §8.2's framing.
- **D19 — Repositioning is real and broadens scope** (individuals → one-person-or-org), but multi-user stays roadmap-not-present-tense per §3 of the spec.
- **D20 — The curated Memory tab gets a real UX overhaul, not "as-is."** Overrides COMPANY-BRAIN §4.2's "keep the current UX largely as-is." The Grove Memory (truth) tab must be **deliberately editable** (fields locked → explicit Edit → Save, so gospel can't be fat-fingered), **well-formatted**, and **human-readable** — not a wall of textareas — directly serving §13's "inspectable, correctable surfaces a non-technical person can trust" moat. Built with the frontend-design skill (P1). Foundation already provisions the data (history on save, `field_meta`/`field_evidence` for provenance/staleness), so no Foundation change is required.
- **D21 — Keep the hybrid retrieval engine; extend, don't replace (P5).** The existing `match_memory` hybrid (dense vector + FTS + recency over derived `memory_entries`) is the correct baseline — do not re-architect it. Company Brain adds, in P5: (a) **extend retrieval to the new `sources` corpus** with document chunking + embedding (same hybrid approach, new corpus); (b) a **bounded-agentic synthesis layer** (retrieve → compose+cite → gap-analyze → optional ONE targeted re-query) — the "agentic RAG" shape, kept bounded for cost/latency and run on the centralized Keeper budget (D18); (c) **multi-modal only at extraction** — P2 reads image/scanned PDFs via a vision model to extract text/facts; true multi-modal embeddings/retrieval are **deferred** (YAGNI; the brain is textual). Add a small synthesis-quality eval (citation correctness, gap detection, no hallucination).

---

## 5. Doc reconciliation list (handled in D1)

| Doc | Action | Why |
|---|---|---|
| `SPEC.md` §1 | Rewrite positioning | Currently "consumer product for solo entrepreneurs/creatives/sole-proprietors" → broaden to "one person or a company, same brain." |
| `SPEC.md` §4.2 / §4.8 | Clarify | Grovekeeper / Grove Memory framed per-individual; affirm per-account brain that scales to multi-seat. |
| `SPEC.md` §12 (row 21) | Amend | Affirm multi-user is the company-brain expansion, not deferred-by-default. |
| `.claude/skills/brand-voice/SKILL.md` | Rewrite tagline + vocab | "AI agents that nibble your busywork away" is individual-only. Adopt locked §14.1 lines: hero = *"Nibbin is the AI team that learns how you operate — and runs your day so you don't have to."*; pitch opener = *"Every other AI makes you explain how you work. Nibbin learns on the job."* |
| `STATE.md` | Update | Add Company Brain milestone; reflect ground-truth. |
| `docs/GTM.md`, `docs/MOAT.md`, `docs/PRODUCT-FOUNDATION.md` | Review/reconcile | Positioning docs — align to the new narrative + spectrum line ("simple for a layman, extensible to a full enterprise — the same brain either way"). |
| `docs/decisions/2026-06-22-connector-strategy-diy-vs-aggregator.md` | Supersede | Per D17 (Nango now). |
| Landing-page hero copy | Persist locked tagline | §14.1. |

---

## 6. Decomposition into worktree chunks

Each chunk = one worktree (`C:\nib-<slug>` off `origin/main`) + its own spec → plan → PR. Gate order below.

### Foundation (gates everything; land first — small & serial)
- **F1 · Memory data model.** First-class evidence/Sources store + typed claim→evidence provenance link + `grove_memory` append-only history. *(blocks P1, P2, P5-sources, C1, C2)*
- **F2 · The one review loop.** Generic propose→review→approve→write primitive + review queue; emits a "review item" notification type. *(blocks P2, P3, C1, C2)*

> F1+F2 may share a single worktree (interdependent; serial anyway).

### Parallel wave (depends only on F1/F2)
- **P1 · Memory page redesign (both tabs)** *(elevated; see D20)* — *Grove Memory (truth) tab:* view/edit mode (fields **locked by default**, deliberate Edit→Save so gospel can't be fat-fingered), real formatting + human readability ("safer," not just agent-readable), hard-rules emphasized, per-field provenance/staleness. *Sources (evidence) tab:* retrieval-backed evidence list + Reference catch-all. The curated-tab UX polish (view/edit + formatting) is **independent of Foundation and can start in parallel now**; only provenance/staleness overlays wait on F1. Build with the frontend-design skill. *(needs F1 for provenance overlays only)*
- **P2 · Document ingestion** — extract-on-drop → propose *(needs F1+F2)*
- **P3 · Passive-capture propose loop** *(needs F2)*
- **P4 · Connector lane on Nango** — migrate Gmail/Calendar/Stripe to Nango; retain generic MCP/API rail; then seed calendar/files/contacts into memory *(D17)*
- **P5 · User-facing synthesis + gap analysis** — reusable engine + Keeper surface + "view details" modal + unified budget *(D18; engine usable over `memory_entries` now, over Sources once F1 lands)*
- **P6 · Attention-queue wiring** — item-level stakes; conflict/review types; **Grovekeeper read-access to pending items**; **Keeper-dock unread red-bubble**; Grove Home roll-up

### Follow-on (need the wave)
- **C1 · Periodic collate pass** — dedup/reconcile/surface contradictions → morning brief *(needs F1+F2 + sources from P2/P3/P4)*
- **C2 · Conflict resolution + learned source-authority** — persistent field flags, Grovekeeper surfacing (high-stakes proactive; trivial batched), user-pick = approval, metabolize into source-authority ranking *(needs F1+F2, P6, C1)*

### Independent (starts immediately, no code deps)
- **D1 · Repositioning + doc reconciliation** — §5 above + store canonical doc (this worktree).

### Deferred / ongoing
- Full declarative MCP connector substrate for arbitrary proprietary systems (§7 / §11-9) — primarily a B2B enabler; trails the consumer loop.
- **Parallel/ongoing:** SOC 2 readiness (the B2B gate); security + business-logic review of every new data path; PR code-review discipline on all merges.

### Dependency graph (text)
```
D1 ─ (independent)
F1 ┐
F2 ┼─→ P1, P2, P3, P5, P6 ─┐
   │            P4 (indep.) ┘
   └─→ C1 ─→ C2  (C2 also needs P6)
```

---

## 7. Acceptance criteria

Inherited from COMPANY-BRAIN.md §17. Each chunk's spec restates the slice it satisfies. The program is "done" when all §17 boxes pass with security + business-logic review on every new data path and no path writes the curated layer without a logged human approval.
