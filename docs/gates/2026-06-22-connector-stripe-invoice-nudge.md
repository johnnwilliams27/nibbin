# Adversarial Gate — Stripe invoice nudge via personalized Gmail email (`feature/connector-stripe`)

**Date:** 2026-06-22
**Range:** `696149e7..4dc18725`
**Plan:** `docs/superpowers/plans/2026-06-22-connector-batch-plan.md` (Phase 2 / Task 4, owner decision "Option B")
**Reviewers:** red-team (opus), logic-skeptic (sonnet), claims-auditor (sonnet), cost-auditor (sonnet)
**Sensitive surface:** `packages/runtime/` + `packages/connectors/` + a customer-facing SEND path.

## Change

`nudge.overdue-invoice` reworked into a cross-resource primitive: read Stripe invoices (`payments.read`) → resolve the worst overdue OPEN invoice's `customer_email` + `hosted_invoice_url` → draft a personalized brand-voice **`email.send` to the customer via Gmail** with the pay link in the body. Reuses the existing email.send rail (no new Stripe write/executor); **Stripe stays read-only**. `deriveResourceClaim` extended so an `email.send` carrying `invoiceId` claims the invoice (no-double-nudge). `tally` template tools→`[payments.read,email.send]`, connectors→`[stripe,gmail]`. Atomic `invoice.nudge` kept vestigial.

## Verdicts

| Reviewer | Verdict | P0 | P1 | P2 |
|---|---|---|---|---|
| red-team | PASS-WITH-FIXES | 0 | 1 | 2 |
| logic-skeptic | PASS | 0 | 0 | 1 |
| claims-auditor | PASS-WITH-FINDINGS | 0 | 1 | 2 |
| cost-auditor | CONDITIONAL PASS | 0 | 1 | 0 |

**Overall: PASS** — 2 of 3 P1 resolved; 1 P1 documented + deferred (unreachable in this PR; see below).

## Positive confirmations

- **No header injection / mis-send (red-team):** recipient is bounded by `safeAddress` (strips CR/LF, one valid address or `''`); subject/amounts are numeric/server-built; an attacker controlling `customer_email` can only redirect to their own address, never inject a second recipient.
- **`deriveResourceClaim` abuse-safe (red-team):** the invoice nudge carries `invoiceId` never `threadId`, so it claims `invoice/<id>` deterministically; empty/missing id fails open to the already-gated send (no lock to bypass); id is the trusted server-selected `worst.id`; claims are accountId-scoped. No regression for the other email.send primitives (`nudge.unconfirmed-event` eventId, `reply.new-inquiry`/`nudge.overdue-email` threadId behave exactly as before; precedence is thread-over-invoice, tested).
- **No-email guard solid + parity guaranteed (logic):** garbage/empty `customer_email` → `safeAddress`→`''`→compose note, never an empty send; `tallyProgram` is a one-line delegation so parity is structural.
- **Bounded API + routing unchanged (cost):** one Stripe read + one email per run; `customer_email`/`hosted_invoice_url` from the list response (no N+1); no model-tier change.
- **Core copy accurate (claims):** primitive docstring, SAFETY paragraph, template spec, test names, draft copy all match the email.send path; the pay link is in the body; Stripe is genuinely read-only end to end.

## Findings → resolution

- **P1 (red-team) + P2 (logic) — unvalidated pay link → phishing vector.** `hosted_invoice_url` (external Stripe data) was interpolated raw into the customer email body; a crafted invoice could embed a `javascript:`/`data:`/phishing URL. **Resolved (`4dc18725`):** new `safeStripeUrl()` (requires `https:` + host `=== 'stripe.com'` or `.endsWith('.stripe.com')`, drop-and-degrade); the primitive validates the link before the body and yields a compose note when absent/invalid. 6 malicious-URL cases (`javascript:`, non-Stripe host, `data:`, `http:`, `stripe.com.evil.com`, malformed) + the empty case covered by new tests.
- **P1 + P2 (claims) — stale `invoice.nudge` comments.** **Resolved (`4dc18725`):** vestigial annotation on the stripe `CONNECTOR_REGISTRY` entry; corrected the stripe client header comment and the `templates.ts` docstring (no template carries `invoice.nudge`; nudges ride `email.send`); also dropped the retired "trust is earned, never unlocked" line.
- **P1 (cost) — cross-run repeat-nudge (DEFERRED, tracked).** Schedule triggers carry no `dedupeKey`, so `effectIdempotencyKey` falls back to `runId` per run; the invoice resource-claim releases at run-end. A still-overdue invoice would be re-nudged every scheduled run. **Not fixed in this PR** because: (a) it is **unreachable today** — Stripe is not connectable (`wired:false`, no creds) and the `tally` template defaults to **Draft** (owner approves each nudge); (b) the correct fix needs **persistent per-(nibbin, invoice) cooldown state** (the calendar primitive's stateless self-observation does not apply — an email is not visible in the Stripe read) plus a **dunning-cadence product decision** (weekly-until-paid is a legitimate reminder cadence; the harm is the unbounded/too-frequent case). Documented as a KNOWN LIMITATION in the primitive docstring. **MUST be resolved before the `send` action level is enabled for an adopted Tally Nibbin** — i.e. before/with Task 5 (making Stripe connectable). Owner sign-off on this deferral recorded at merge.

## Verification

Full suite **2155 passed** (only the 3 pre-existing `@sparticuz/chromium` env tests fail; green in CI); full `npm run typecheck` clean on touched files (only the pre-existing `@vercel/analytics` env error remains); lint clean.

**Gate status: PASS** (no P0; 2 P1 resolved; 1 P1 deferred-with-tracking and unreachable in this PR — requires owner sign-off + resolution before Tally ships at Send).
