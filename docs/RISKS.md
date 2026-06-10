# RISKS — production-gap register (distinguished-engineer pass)

Summary lives in SPEC §6.9. This is the working register: each item gets an owner,
milestone, and status as the build proceeds.

## 1. Platform & API compliance (long-lead; can kill timelines)
- **Google restricted scopes (Gmail):** OAuth app verification + annual CASA security
  assessment. Weeks-to-months. Unverified apps capped at 100 users. FILE AT M1; M3
  depends on it. Mitigation while pending: metadata/readonly-minimal scopes, allowlisted
  testers.
- **Meta/Instagram messaging:** app review + business verification; long-lead. File at M1.
- API quotas & ToS: Gmail per-user send limits; no scraping posture anywhere; respect
  automation clauses (LinkedIn connector is read/compose-assist only).
- **Stripe + credits law:** prepaid credits can fall under gift-card/expiry rules in some
  states — credits roll over or follow compliant expiry; refund policy + ToS/Privacy
  authored before public signup. PCI scope stays SAQ-A (Stripe-hosted fields only).

## 2. Scaled abuse vectors
- **Free-tier farming:** bot challenge (Turnstile-class) at signup; disposable-email
  detection; per-IP/device velocity limits; scan depth tier-gated; per-account and
  per-IP scan caps; diagnosis compute requires verified email.
- **Outbound-send abuse (the OAuth-app killer):** spammers using Nibbins to send through
  their own Gmail gets OUR app flagged. Per-account send velocity caps; new-account
  cooldowns; T0 moderation pass on autonomous outbound; complaint-rate monitoring with
  auto-pause; per-capability kill switches.
- **Generic MCP / webhook rail = SSRF surface:** deny-by-default egress proxy; resolve
  to public IPs only; DNS-rebinding protection; response size/time limits; never forward
  credentials; per-connector egress allowlists.
- **Credit fraud:** Stripe Radar + 3DS on top-ups; chargeback monitoring; ledger
  clawback entries (append-only, never mutation).
- **Prompt injection at scale:** SPEC §6.5 plus quarantined tool results, injection eval
  suite in CI, suspicious-instruction flagging with human review queue.
- **Scan-as-free-analytics scraping:** rate caps; depth behind paid tiers.

## 2.5 Insider threat & staff access
- Admin console (admin.nibbin.com) is the ONLY staff path to user data — direct DB
  access in prod is break-glass only, logged, and reviewed at the next gate.
- Staff MFA = passkeys/hardware keys, mandatory. Offboarding checklist revokes SSO,
  sessions, and any break-glass credentials same-day.
- Impersonation: reasoned, time-boxed, default read-only, user-visible in audit log;
  content access requires explicit user consent grant. Quarterly access review.

## 3. Reliability & DevOps
- Migrations: forward-only, expand/contract pattern; rollback runbook.
- Zero-downtime deploys; queue worker drain on deploy; dead-letter queues with
  poison-message quarantine; webhook idempotency keys + replay windows; exactly-once
  side effects via idempotency table.
- Backups: nightly + PITR, and **quarterly restore drills** — an unrestored backup is
  a hope, not a backup.
- Feature flags + kill switches per connector, per capability, per model tier.
- Incident response: severity matrix, auto-pause levers, status page, alerting on
  error rate, queue depth, COGS spike, complaint rate, provider outage. Solo-founder
  reality: alerts must be actionable from a phone.
- LLM provider redundancy: multi-provider fallback per tier; outage runbook; provider
  hard spend caps + per-env budget alarms.
- Observability hygiene: PII scrubbing in logs and error tracker (beforeSend); no
  secrets in logs (lint rule + CI scan); sampling on high-volume paths.
- Supply chain: lockfiles committed; audit gate; Dependabot; Actions pinned by SHA.

## 3.5 Final-pass items
- OSS license compliance: Screenpipe MIT attribution + NOTICE; license-scan CI gate (GPL block).
- External pen test before public launch; auth endpoint throttling.
- Founder break-glass: 2 hardware keys + sealed recovery codes; lockout runbook.
- Desktop: macOS permission-revocation auto-pause; Windows EV cert + AV submissions; staged
  updater rollout w/ version blocklist; uninstall data-wipe option.
- Email warm-up schedule + DMARC ramp before first drip send.

## 4. Legal & data
- CAN-SPAM/CASL: unsubscribe in every drip email; suppression list; bounce/complaint
  webhooks honored before first send.
- GDPR/CCPA: deletion SLA (<=30d) and export flows from day one; subprocessor list page;
  retention schedule (run logs default 90d, user-configurable; journals user-deletable).
- AI-disclosure: configurable signature on autonomous sends; monitor evolving state law.
- SOC 2 trajectory: evidence collection starts at M8 (access reviews + change management
  fall out of the PR workflow for free).
