# M7-READINESS.md — everything between here and the study

M7 starts the testing/GTM motion: the product gets used end-to-end by user zero, then design
partners. This is the entry checklist beyond M6.5. Three buckets: BLOCKERS (M7 doesn't start
without them), STRONGLY-SHOULD (M7 is materially worse without them), DEFERRABLE (explicitly
fine to skip, with the revisit trigger).

The meta-lesson that produced this file: two implicit workstreams (model bring-up, landing
page port) were never named in any DoD and therefore never got built. Rule going forward:
**anything not named in a DoD does not exist.**

> **Reconciliation 2026-06-15.** Most entry items shipped between when this file was written
> (2026-06-13) and now — and M7 *build* work (diagnosis pipeline #69/#70/#72, Grove Memory #67,
> §6.12 #68) has already landed, so M7 is underway, not merely pending. Boxes below are ticked
> only where verified against merged PRs or the code on `main`; items that are infra/calendar/
> process (mail warm-up, OAuth/CASA filing, dress rehearsal, founder posts, separate Scout/Scribe
> repos) can't be verified from this repo and are left unchecked with a **confirm** flag rather than
> asserted. Two stale facts corrected throughout: auth is **email + password** (magic links removed,
> #65), and the public category line is now **"AI Agents. Simplified."** (#86).

---

## 0. The landing page gap (why production showed a placeholder)

> **✅ RESOLVED 2026-06-15.** `/` is the real ported page now — #54 (port + waitlist + SEO),
> then #56 (Maya demo), #57/#59 (copy), #74 (nav), #86 (tagline/mobile-login/pill polish).
> nibbin.com serves the production page over HTTPS; Vercel prod deploys green. The prompt below
> is kept as the historical DoD artifact.

`reference/nibbin-demo.html` is the design source-of-truth, not deployed code. M0's DoD was
"web shell" — `/` was a scaffold placeholder because no milestone owned the port. Fixed with
the task below (ran in parallel with M6.5 — different surfaces).

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
> 5. SEO/meta: title + description using the category line ("AI Agents. Simplified." —
>    audience-agnostic, per #86), OG image from the brand suite, sitemap.xml, robots.txt, favicons.
> 6. Cookieless analytics (Plausible-class) + the §6.12 web events. No consent banner needed
>    — verify nothing sets tracking cookies.
> 7. Verify on the Vercel production deploy: nibbin.com serves the real page, Lighthouse
>    ≥90 performance/accessibility/SEO, both themes correct.
> Commit as "web: landing page port + waitlist + legal routes + SEO". Do not edit docs/
> memory files; run the relevant reviewer subagents on the diff before PR.

---

## 1. BLOCKERS — M7 does not start without these

- [x] **M6.5 gated and signed** (models live, budgets durable, eval suite green, pricing fixed)
      — ✅ PR #51, signed 2026-06-12 (STATE.md). Pricing later revised Grove $29 / Canopy $79 (#66).
- [x] **Landing page port live on nibbin.com** — ✅ #54 → polished through #86; production page live.
- [x] **#29 pair landed:** account-deletion clock + scan-results purge on disconnect.
      — ✅ #75 (revoke purges scan_results) + #76 (deletion clock); plus #78 (irreversible purge
      carve-out) and #80 (nightly runner, gated off). Issue **#29 is CLOSED**.
- [ ] **#46 claims-wording corrections** in privacy/terms/data-ai (incl. the C8 client-layer
      reality for QuickBooks/Instagram) — then attorney review of the corrected pages.
      **PARTIAL:** journal/suppression/C8 wording was corrected on reference/data-ai.html +
      reference/privacy.html at the M4+M5 gate, but issue **#46 is still OPEN** and the attorney
      review isn't recorded. Still gates routing the legal pages.
- [x] **§6.12 instrumentation live, TTFAD measurable** — ✅ #68 (`account_created` + TTFAD readout).
- [ ] **mail.nibbin.com warm-up STARTED** — the 2–4 week low-volume ramp (DMARC p=none→quarantine,
      bounce/complaint webhooks). **Confirm (infra/calendar):** Resend on nibbin.com is verified and
      transactional/waitlist mail sends (#61), but the warm-up ramp itself can't be verified from the
      repo. Longest non-engineering pole besides CASA.
- [ ] **Google OAuth test-mode allowlist populated** — John + first design partners' emails.
      **Open:** STATE.md M1 tracking shows Google OAuth verification/CASA NOT YET FILED (needs the
      Google Cloud project). Confirm the test-mode allowlist before partners onboard.
- [ ] **End-to-end dress rehearsal** (separate from M7's synthetic study): fresh account →
      **invite → set password** (auth is email+password now, #65) → connector OAuth → scan → adopt →
      first draft → approve → TTFAD recorded. Run it twice: once on dev, once on production with a
      throwaway account. **Process — confirm when run.**

## 2. STRONGLY-SHOULD — M7 is materially worse without these

- [ ] **Push approvals (PWA + web push), minimum version** — during a 14-day study John is
      living his life; if drafts wait for laptop time, Agent School velocity (and the GTM
      proof's "≥1 agent to Senior") suffers (PRODUCT-FOUNDATION §2.2). **Not built:** no
      web-push / service-worker / PWA manifest in apps/web as of 2026-06-15. Highest-value
      STRONGLY-SHOULD still open.
- [x] **Grove Memory, minimum version** — ✅ #67 (per-account business brain + router injection);
      seed-serialization fix #83. The Marketing Grove agents now have business facts/voice/rules.
- [ ] **Windows code-signing — approach changed, not yet active.** Signing is wired via **Azure
      Trusted Signing** (#85), not an EV-cert order; the first signed Windows run is gated on Azure
      identity validation (dormant until the secrets land). Unsigned installers still hit SmartScreen.
- [ ] **Founder post + outreach templates drafted** and the 20-warm list ready to fire the
      day the waitlist is live (standing offer: I draft these on request). **Process.**
- [ ] **Scout + Scribe stood up** (separate repos per GTM §6) so Phase-0 listening and
      content run before the study generates material. **Separate repos — confirm; not verifiable here.**
- [ ] **Support path live:** hello@ receiving, Concierge triage at Student stage. **PARTIAL:**
      hello@nibbin.com is in the landing footer; mailbox-receiving + the Concierge triage surface
      aren't verified in-repo.

## 2.5 Tester onboarding & access — named 2026-06-13 (founder)

The meta-lesson in action: these were implicit and therefore unbuilt. Named then so a
design partner can be invited, get in, install the app, and act from the website
without hand-holding. **Most of this shipped 2026-06-13 (#60/#61/#64/#65/#77).**

- [x] **Public Login — email + password (not passwordless).** ✅ #60 (public invite-gated Login
      + tester-access scope), #64 (invite links via token_hash + verifyOtp), #65 (email+password
      across the shared identity; **magic links removed**), #86 (compact Login in the mobile header).
      **Corrected model:** identifier is the email with a **password**; sign-up stays invite-only
      (an unknown email can't self-mint — admin-minted invite links only); "forgot password" sends a
      **recovery link** (`forgot-password/actions.ts`), not "another magic link."
- [x] **Waitlist → admin invite → account creation** — ✅ #58 (waitlist view, read-only) +
      #61 (invite action + account-creation/invite email). The "missing half" the original note
      flagged shipped in #61.
- [x] **Branded transactional & auth emails** — ✅ #61 (branded transactional + generate-link-and-
      send path); recovery/invite links sent via our own branded path (`forgot-password/actions.ts`,
      `api/internal/invite`). **Confirm:** that Supabase's *default* auth emails are fully superseded
      (custom-SMTP/template is a dashboard step) so a tester never sees an unbranded default.
- [ ] **App download + distribution** — **PARTIAL:** `/download` (+ `/download/[platform]`) surface
      and the Windows download handoff shipped (#77, first cut). Still open: signed installers (gated
      on Azure identity validation, #85), an update channel, and the macOS artifact.
- [ ] **macOS build** (promoted from §3) — testers skew macOS, so the deferral trigger fired.
      Needs a Mac + Apple Developer signing; infra/hardware, not a code change. **Open.**

## 3. DEFERRABLE — explicitly fine to skip for M7, with triggers

- **macOS bring-up** — PROMOTED to §2.5 (2026-06-13): the design-partner trigger has fired
  (testers skew macOS). M6 caveat still applies (budgets + <100ms pause unverified); needs a
  Mac mini (or MacStadium/GitHub macOS runners) + an Apple Developer cert
- **Stripe live mode** — user-zero on test mode is fine (STATE.md confirms prod still runs test-mode
  Stripe). TRIGGER: first paying design partner
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

> **Status 2026-06-15.** Steps 1–4 are largely executed in code: M6.5 signed (#51), landing live
> (#54→#86), #29 pair closed (#75/#76/#78/#80), #46 wording corrected on the reference pages
> (issue still open), Grove Memory min shipped (#67). The remaining real poles are **not code**:
> mail.nibbin.com warm-up, Google OAuth/CASA filing, the #46 attorney review, the ×2 dress
> rehearsal, **push approvals** (the one unbuilt STRONGLY-SHOULD), and the **macOS build/signing**.
