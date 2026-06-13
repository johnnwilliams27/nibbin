# M7-READINESS.md — everything between here and the study

M7 starts the testing/GTM motion: the product gets used end-to-end by user zero, then design
partners. This is the entry checklist beyond M6.5. Three buckets: BLOCKERS (M7 doesn't start
without them), STRONGLY-SHOULD (M7 is materially worse without them), DEFERRABLE (explicitly
fine to skip, with the revisit trigger).

The meta-lesson that produced this file: two implicit workstreams (model bring-up, landing
page port) were never named in any DoD and therefore never got built. Rule going forward:
**anything not named in a DoD does not exist.**

---

## 0. The landing page gap (why production shows a placeholder)

`reference/nibbin-demo.html` is the design source-of-truth, not deployed code. M0's DoD was
"web shell" — `/` is a scaffold placeholder because no milestone owned the port. Fix with
the task below (runs fine in parallel with M6.5 — different surfaces).

### Landing port prompt (paste into Claude Code)

> Read CLAUDE.md, the design-system and brand-voice skills, reference/nibbin-demo.html,
> reference/nibbin-style-guide.html (Plates 0W + all), and docs/GTM.md §1. Port the landing
> page into apps/web as the production `/` route:
> 1. Rebuild the reference design in Next.js using packages/creatures for all creature
>    renders (no copied SVG strings) and packages/shared tokens — visual parity with the
>    reference at desktop and mobile breakpoints, including the hero entrance motion and
>    reduced-motion behavior.
> 2. Wordmark per the logo guide: production wordmark SVG in the nav at 22px with 1Λ clear
>    space (run docs/tasks/wordmark-production-task.md first if the asset suite doesn't
>    exist yet).
> 3. Waitlist capture wired to the database: "Join the Founding Grove — 100 seats," email
>    validation, double-opt-in confirmation via the M5 email infrastructure, suppression-list
>    respected, `waitlist_joined` event emitted.
> 4. Route the legal pages (privacy, terms, data-ai) from reference/ as real routes — BUT
>    gate this step on the #29 deletion-clock + scan-purge work and the #46 claims-wording
>    corrections landing first (the gate ruled those become P0 the moment these pages route).
>    If those aren't merged yet, ship the landing with footer links marked "available at
>    launch" and open an issue.
> 5. SEO/meta: title + description using the category line ("AI agents for
>    freelancers"), OG image from the brand suite, sitemap.xml, robots.txt, favicons.
> 6. Cookieless analytics (Plausible-class) + the §6.12 web events. No consent banner needed
>    — verify nothing sets tracking cookies.
> 7. Verify on the Vercel production deploy: nibbin.com serves the real page, Lighthouse
>    ≥90 performance/accessibility/SEO, both themes correct.
> Commit as "web: landing page port + waitlist + legal routes + SEO". Do not edit docs/
> memory files; run the relevant reviewer subagents on the diff before PR.

---

## 1. BLOCKERS — M7 does not start without these

- [ ] **M6.5 gated and signed** (models live, budgets durable, eval suite green, pricing fixed)
- [ ] **Landing page port live on nibbin.com** (task above) — the GTM motion points people
      somewhere; a placeholder torches credibility with design partners
- [ ] **#29 pair landed:** account-deletion clock + scan-results purge on disconnect.
      M7's immutable exit half (C1–C7 + deletion verified) depends on them, and legal pages
      can't route without them
- [ ] **#46 claims-wording corrections** in privacy/terms/data-ai (incl. the C8 client-layer
      reality for QuickBooks/Instagram) — then attorney review of the corrected pages
- [ ] **§6.12 instrumentation live, TTFAD measurable** — "John's TTFAD published" is an M7
      exit criterion; if the stopwatch isn't running, the milestone can't exit
- [ ] **mail.nibbin.com warm-up STARTED** — calendar-critical: the 2–4 week low-volume ramp
      (with DMARC p=none→quarantine progression and bounce/complaint webhooks live) must
      begin NOW so deliverability exists when M7's drip beats and waitlist confirmations send.
      This is the longest non-engineering pole besides CASA
- [ ] **Google OAuth test-mode allowlist populated** — John + the first design partners'
      emails added (the 100-user cap path), so onboarding doesn't dead-end at consent
- [ ] **End-to-end dress rehearsal** (separate from M7's synthetic study): fresh account →
      magic link → connector OAuth → scan → adopt → first draft → approve → TTFAD recorded.
      Run it twice: once on the dev env, once on production with a throwaway account

## 2. STRONGLY-SHOULD — M7 is materially worse without these

- [ ] **Push approvals (PWA + web push), minimum version** — during a 14-day study John is
      living his life; if drafts wait for laptop time, Agent School velocity (and the GTM
      proof's "≥1 agent to Senior") suffers. The full Grove Home polish can follow; the
      notification→one-tap-approve path should not (PRODUCT-FOUNDATION §2.2)
- [ ] **Grove Memory, minimum version** — the Marketing Grove agents drafting outreach need
      business facts/voice/rules to draft from; without it, M6.5's drafts are generic and
      the study tests the wrong thing (PRODUCT-FOUNDATION §2.3)
- [ ] **Windows code-signing cert ORDERED** (EV has multi-week lead time) — user-zero can run
      a dev build, but design partners onboard right after M7 and SmartScreen will eat
      unsigned installers
- [ ] **Founder post + outreach templates drafted** and the 20-warm list ready to fire the
      day the waitlist is live (the standing offer: I draft these on request)
- [ ] **Scout + Scribe stood up** (separate repos per GTM §6) so Phase-0 listening and
      content are running before the study generates material
- [ ] **Support path live:** hello@ receiving, Concierge triage at Student stage

## 3. DEFERRABLE — explicitly fine to skip for M7, with triggers

- **macOS bring-up** (M6 caveat: budgets + <100ms pause unverified) — John's study runs on
  Windows. TRIGGER: before design-partner onboarding, because photographers skew heavily
  macOS; get a Mac mini (or MacStadium/GitHub macOS runners) on order now
- **Stripe live mode** — user-zero on test mode is fine. TRIGGER: first paying design partner
- **Status page + uptime monitoring** — TRIGGER: first external user
- **Business Pulse, template marketplace, everything in the anti-feature register** — per
  PRODUCT-FOUNDATION, unchanged
- **M8 hardening items** (monotonic-clock elapsed-time accounting, restore drill, pen test,
  license audit) — TRIGGER: public launch gate, as already specced

## 4. Suggested order (assuming M4+M5 signs today)

1. Sign M4+M5 → start mail warm-up + order Windows cert + populate allowlist (same day,
   all calendar-bound)
2. M6.5 (solo, main) ‖ landing-page port (worktree) — different surfaces, safe in parallel
3. #29 pair + #46 wording (small, fold into the landing PR's gate or a short follow-up) →
   attorney review
4. Push-approvals + Grove Memory minimum versions (one short worktree, PRODUCT-FOUNDATION
   Block A scope trimmed to "minimum")
5. Dress rehearsal ×2 → fix what it finds
6. M7 per the amended WORKTREES finale prompt. Founder post fires the same week.
