# Nibbin Capability Taxonomy (R4)

**Date:** 2026-06-17  
**Status:** Living roadmap — see §"Built vs Planned" key below  
**Companion spec:** [`2026-06-17-agent-synthesis-design.md`](./2026-06-17-agent-synthesis-design.md) (§4, §15 R4)

---

## Purpose

This document is the **~150-capability map** committed as build-task R4 in the synthesis design spec (§4, §15). It is the durable vocabulary that couples observation → diagnosis → action: a field study can only recognize work it can map here; a Composer can only build agents from what is listed here; an agent can only do what is registered here. **Library breadth is the product ceiling** (design §2 P1).

It is a **living roadmap**: capabilities are added as the seed-then-grow flywheel (§4) surfaces observed gaps. It must stay co-designed with the observation/diagnosis taxonomy.

---

## The model

### `(resource, verb) → side-effect`

Every capability is a triple:

| Dimension | Values | Meaning |
|-----------|--------|---------|
| **resource** | noun (email, event, file, row, …) | what the capability acts on |
| **verb** | `get` · `search` · `list` · `create` · `update` · `upsert` · `delete` · `nudge` · `digest` · `draft` · `navigate` · `click` · `type` · `extract` · `scroll` · `screenshot` · `send` · `trigger` | what it does |
| **side-effect** | `read` · `draft` · `write` | how it is gated |

**Side-effect routing (design §2 P2 — the spine):**
- `read` — auto-runs; no external commit; quarantined results.
- `draft` — produces an artifact (email draft, document, summary) but does **not** commit externally.
- `write` — approval-gated; routes through the approval/School gate + `nibbin_write_grants` + send-velocity caps. **No `write` capability ever executes without explicit approval.**

### Kinds

| Kind | Description |
|------|-------------|
| **atomic** | Yields one gated step. The base unit. |
| **primitive** | A trusted composite that bundles multiple atomic steps (read → detect → draft) into one named reusable unit. The Composer composes by primitive id + typed params; the LLM never emits the internal read paths or effectArgs. |
| **computer\_use** | Driven by an injected `BrowserDriver`, not an OAuth connector. Runs at the `computer_use` weight class (10×). The universal fallback rail when no API or connector exists. |

### Computer-use as the universal fallback rail

When no connector or API covers a service, `computer_use.*` verbs (navigate / extract / screenshot / scroll for reads; click / type for writes) let the Planner (mode C) drive any web app or desktop UI. This means **the entire web is reachable on day one**, even before a connector is built. It runs under tighter ceilings and mandatory plan-preview because it is write-capable and inherently less deterministic than connector-backed capabilities.

### Generic-web and MCP rails

For the long tail beyond the 24 existing connectors, three additional rails give coverage without per-service connectors:
- **Authenticated HTTP** — `GET` → `read`; `POST` / `PUT` / `DELETE` → `write` (approval-gated).
- **Inbound webhook** — trigger on any service that can POST a webhook.
- **User-supplied MCP rail** — routes through the existing deny-by-default MCP egress proxy (quarantined results, public-IP-only).

---

## Built vs Planned key

| Mark | Meaning |
|------|---------|
| **BUILT** | Registered in `packages/runtime/src/capabilities.ts` today. Registry id cited. |
| **PLANNED** | In the design spec scope; not yet in the registry. Connector exists but capability not yet wired. |
| **PLANNED (new connector)** | Capability + connector both planned; neither built yet. |
| **PLANNED (generic rail)** | Covered by the authenticated-HTTP / MCP / computer-use fallback rails, not a dedicated capability entry. |

---

## Domain taxonomy

### 1. Email

Connector: `gmail` (built). Scope: `gmail.readonly` (read) + write scopes (draft/send, spec §4 Connections).

| Capability id | Resource | Verb | Side-effect | Kind | Status |
|---------------|----------|------|-------------|------|--------|
| `email.read` | email | get | read | atomic | **BUILT** (`email.read`) |
| `email.draft` | email | draft | draft | atomic | **BUILT** (`email.draft`) |
| `email.send` | email | send | write | atomic | **BUILT** (`email.send`) |
| `nudge.overdue-email` | email | nudge | draft | primitive | **BUILT** (`nudge.overdue-email`) — read mailbox → detect stale thread → draft follow-up |
| `reply.new-inquiry` | email | draft | draft | primitive | **BUILT** (`reply.new-inquiry`) — detect first-contact → draft warm reply |
| `digest.inbox-cleanup` | email | digest | read | primitive | **BUILT** (`digest.inbox-cleanup`) — sweep mailbox → group high-volume senders → present keep-or-clear digest |
| `digest.morning` | email | digest | read | primitive (cross-resource) | **BUILT** (`digest.morning`) — aggregate calendar + payments + email → morning briefing |
| `email.search` | email | search | read | atomic | PLANNED — full-text / label / sender query |
| `email.label` | email | update | write | atomic | PLANNED — apply / remove labels |
| `email.archive` | email | delete | write | atomic | PLANNED — archive (soft remove from inbox) |
| `email.move` | email | update | write | atomic | PLANNED — move to folder/label |
| `email.forward` | email | send | write | atomic | PLANNED — forward with optional note |
| `email.triage` | email | classify | read | primitive | PLANNED — judgment capability: classify thread urgency/action-required |
| `email.unsubscribe` | email | delete | write | atomic | PLANNED — detect unsubscribe link, fire it |

### 2. Calendar

Connector: `google-calendar` (built).

| Capability id | Resource | Verb | Side-effect | Kind | Status |
|---------------|----------|------|-------------|------|--------|
| `calendar.read` | event | get | read | atomic | **BUILT** (`calendar.read`) |
| `nudge.unconfirmed-event` | calendar | nudge | draft | primitive (cross-resource) | **BUILT** (`nudge.unconfirmed-event`) — read calendar → detect unconfirmed attendees → draft confirmation email |
| `calendar.list` | event | list | read | atomic | PLANNED — list events in a time window |
| `calendar.create` | event | create | write | atomic | PLANNED — create event with attendees, location, description |
| `calendar.update` | event | update | write | atomic | PLANNED — reschedule, add attendee, update description |
| `calendar.delete` | event | delete | write | atomic | PLANNED — cancel/delete event |
| `calendar.find-slot` | event | search | read | primitive | PLANNED — find free slot for N participants in a window |
| `calendar.rsvp` | event | update | write | atomic | PLANNED — accept/decline/tentative on behalf of user |
| `calendar.digest` | event | digest | read | primitive | PLANNED — daily/weekly agenda summary |
| `calendar.conflict-detect` | event | search | read | primitive | PLANNED — detect double-bookings or back-to-back without travel time |

### 3. Payments & Invoicing

Connector: `stripe` (built).

| Capability id | Resource | Verb | Side-effect | Kind | Status |
|---------------|----------|------|-------------|------|--------|
| `payments.read` | payment | get | read | atomic | **BUILT** (`payments.read`) |
| `invoice.nudge` | invoice | nudge | draft | atomic | **BUILT** (`invoice.nudge`) |
| `nudge.overdue-invoice` | invoice | nudge | draft | primitive | **BUILT** (`nudge.overdue-invoice`) — watch Stripe invoices → detect worst overdue → draft nudge |
| `invoice.list` | invoice | list | read | atomic | PLANNED |
| `invoice.create` | invoice | create | write | atomic | PLANNED — create and send invoice |
| `invoice.update` | invoice | update | write | atomic | PLANNED — update line items, due date |
| `invoice.void` | invoice | delete | write | atomic | PLANNED — void an invoice |
| `payment.refund` | payment | create | write | atomic | PLANNED — issue full or partial refund (approval-gated) |
| `subscription.read` | subscription | get | read | atomic | PLANNED |
| `subscription.update` | subscription | update | write | atomic | PLANNED — change plan, pause, cancel |
| `customer.read` | customer | get | read | atomic | PLANNED |
| `customer.create` | customer | create | write | atomic | PLANNED |
| `revenue.digest` | payment | digest | read | primitive | PLANNED — MRR, ARR, churn summary |
| `payment.link` | payment | create | write | atomic | PLANNED — generate Stripe payment link |
| `coupon.create` | coupon | create | write | atomic | PLANNED |
| `payout.read` | payout | get | read | atomic | PLANNED |
| `dispute.read` | dispute | get | read | atomic | PLANNED |
| `dispute.respond` | dispute | update | write | atomic | PLANNED — draft evidence / submit response |

### 4. Files & Storage

Connectors: planned (`google-drive`, `dropbox`, `onedrive`, `s3`, `notion-files`).

| Capability id | Resource | Verb | Side-effect | Kind | Status |
|---------------|----------|------|-------------|------|--------|
| `file.read` | file | get | read | atomic | PLANNED — download / read file content |
| `file.list` | file | list | read | atomic | PLANNED — list folder contents |
| `file.search` | file | search | read | atomic | PLANNED — full-text or name search |
| `file.create` | file | create | write | atomic | PLANNED — upload / create new file |
| `file.update` | file | update | write | atomic | PLANNED — overwrite / append |
| `file.delete` | file | delete | write | atomic | PLANNED — trash / permanent delete |
| `file.move` | file | update | write | atomic | PLANNED — move / rename |
| `file.share` | file | update | write | atomic | PLANNED — set sharing permissions, create share link |
| `file.summarize` | file | digest | read | primitive | PLANNED — extract key points from doc/PDF |
| `file.extract-table` | file | extract | read | primitive | PLANNED — pull structured data from spreadsheet / PDF table |
| `file.convert` | file | create | write | primitive | PLANNED — convert format (e.g. DOCX → PDF) |
| `folder.create` | folder | create | write | atomic | PLANNED |
| `folder.organize` | folder | update | write | primitive | PLANNED — file sorting / naming-convention enforcement |
| `photo.cull` | file | classify | read | primitive | PLANNED — rate/select best shots (judgment kind) |
| `photo.rename` | file | update | write | primitive | PLANNED — batch rename by EXIF/date/event |
| `photo.resize` | file | create | write | primitive | PLANNED — batch resize / watermark / export selects |
| `video.transcode` | file | create | write | primitive | PLANNED — convert format, compress, extract clip |
| `video.caption` | file | create | write | primitive | PLANNED — transcribe + burn/attach captions |

### 5. Tasks & Projects

Connectors: planned (`notion`, `linear`, `asana`, `jira`, `todoist`, `trello`).

| Capability id | Resource | Verb | Side-effect | Kind | Status |
|---------------|----------|------|-------------|------|--------|
| `task.list` | task | list | read | atomic | PLANNED |
| `task.create` | task | create | write | atomic | PLANNED |
| `task.update` | task | update | write | atomic | PLANNED — status, assignee, due date, priority |
| `task.delete` | task | delete | write | atomic | PLANNED |
| `task.search` | task | search | read | atomic | PLANNED |
| `task.triage` | task | classify | read | primitive | PLANNED — prioritize backlog by urgency/impact (judgment) |
| `task.digest` | task | digest | read | primitive | PLANNED — overdue / blocked / due-today summary |
| `project.read` | project | get | read | atomic | PLANNED |
| `project.create` | project | create | write | atomic | PLANNED |
| `project.update` | project | update | write | atomic | PLANNED |
| `project.status-digest` | project | digest | read | primitive | PLANNED — status rollup across projects |
| `doc.read` | document | get | read | atomic | PLANNED — read Notion page / Confluence page |
| `doc.create` | document | create | write | atomic | PLANNED |
| `doc.update` | document | update | write | atomic | PLANNED |
| `doc.summarize` | document | digest | read | primitive | PLANNED |
| `database.query` | row | search | read | atomic | PLANNED — Notion DB / Airtable / Supabase select |
| `database.upsert` | row | upsert | write | atomic | PLANNED — find-or-create row (upsert is first-class per §4) |
| `database.delete` | row | delete | write | atomic | PLANNED |

### 6. Messaging & Social

Connectors: planned (`slack`, `telegram`, `twitter-x`, `instagram`, `linkedin`). Telegram notification already live as a reach-me channel.

| Capability id | Resource | Verb | Side-effect | Kind | Status |
|---------------|----------|------|-------------|------|--------|
| `slack.read` | message | get | read | atomic | PLANNED |
| `slack.send` | message | send | write | atomic | PLANNED |
| `slack.search` | message | search | read | atomic | PLANNED |
| `slack.react` | message | update | write | atomic | PLANNED — add emoji reaction |
| `slack.digest` | message | digest | read | primitive | PLANNED — summarize unread channel activity |
| `slack.draft` | message | draft | draft | atomic | PLANNED |
| `discord.send` | message | send | write | atomic | PLANNED (new connector) |
| `twitter.post` | post | create | write | atomic | PLANNED (new connector) |
| `twitter.reply` | post | create | write | atomic | PLANNED (new connector) |
| `twitter.search` | post | search | read | atomic | PLANNED (new connector) |
| `instagram.post` | post | create | write | atomic | PLANNED (new connector) |
| `instagram.caption-draft` | post | draft | draft | primitive | PLANNED (new connector) — generative: draft caption in brand voice |
| `linkedin.post` | post | create | write | atomic | PLANNED (new connector) |
| `linkedin.connect-request` | connection | create | write | atomic | PLANNED (new connector) |
| `post.draft` | post | draft | draft | primitive | PLANNED — generative: draft social post in user voice from brief |
| `post.schedule` | post | update | write | atomic | PLANNED — schedule post for later publish |

### 7. CRM, Leads & Booking

Connectors: planned (`hubspot`, `salesforce`, `pipedrive`, `calendly`, `acuity`).

| Capability id | Resource | Verb | Side-effect | Kind | Status |
|---------------|----------|------|-------------|------|--------|
| `contact.read` | contact | get | read | atomic | PLANNED |
| `contact.list` | contact | list | read | atomic | PLANNED |
| `contact.search` | contact | search | read | atomic | PLANNED |
| `contact.create` | contact | create | write | atomic | PLANNED |
| `contact.update` | contact | update | write | atomic | PLANNED |
| `contact.enrich` | contact | update | write | primitive | PLANNED — pull public data, update record |
| `lead.qualify` | contact | classify | read | primitive | PLANNED — judgment: score / route by fit criteria |
| `deal.read` | deal | get | read | atomic | PLANNED |
| `deal.create` | deal | create | write | atomic | PLANNED |
| `deal.update` | deal | update | write | atomic | PLANNED — stage, amount, close date |
| `deal.digest` | deal | digest | read | primitive | PLANNED — pipeline health summary |
| `booking.read` | booking | get | read | atomic | PLANNED |
| `booking.create` | booking | create | write | atomic | PLANNED — schedule a meeting via booking page |
| `booking.cancel` | booking | delete | write | atomic | PLANNED |
| `follow-up.draft` | contact | draft | draft | primitive | PLANNED — generative: draft personalized follow-up in user voice |
| `outreach.sequence-draft` | contact | draft | draft | primitive | PLANNED — generative: draft multi-step outreach in user voice |

### 8. Web & Research

Connector: built-in (no OAuth connector needed). Covers the universal research/scrape rail.

| Capability id | Resource | Verb | Side-effect | Kind | Status |
|---------------|----------|------|-------------|------|--------|
| `computer_use.navigate` | browser | navigate | read | computer\_use | **BUILT** (`computer_use.navigate`) |
| `computer_use.extract` | browser | extract | read | computer\_use | **BUILT** (`computer_use.extract`) |
| `computer_use.screenshot` | browser | screenshot | read | computer\_use | **BUILT** (`computer_use.screenshot`) |
| `computer_use.scroll` | browser | scroll | read | computer\_use | **BUILT** (`computer_use.scroll`) |
| `computer_use.click` | browser | click | write | computer\_use | **BUILT** (`computer_use.click`) |
| `computer_use.type` | browser | type | write | computer\_use | **BUILT** (`computer_use.type`) |
| `web.search` | web | search | read | atomic | PLANNED — query a search engine, return results |
| `web.fetch` | web | get | read | atomic | PLANNED — fetch a URL, return content |
| `web.scrape` | web | extract | read | primitive | PLANNED — structured extraction from a page (CSS selector / LLM-guided) |
| `web.monitor` | web | trigger | read | primitive | PLANNED — watch a URL for changes, trigger on diff |
| `http.get` | endpoint | get | read | atomic | PLANNED (generic rail) — authenticated GET to any API |
| `http.post` | endpoint | create | write | atomic | PLANNED (generic rail) — authenticated POST (approval-gated) |
| `http.put` | endpoint | update | write | atomic | PLANNED (generic rail) — authenticated PUT |
| `http.delete` | endpoint | delete | write | atomic | PLANNED (generic rail) — authenticated DELETE |
| `webhook.inbound` | event | trigger | read | atomic | PLANNED (generic rail) — receive and route inbound webhook payload |
| `mcp.call` | tool | create | write | atomic | PLANNED (generic rail) — call any MCP tool via the deny-by-default egress proxy |

### 9. Content Generation (Generative Kind)

These are **generative** capabilities (design §4A) — non-deterministic, quality-judged, style-profile-consuming. Always `draft` side-effect; auto-`write` only at high trust + explicit policy.

| Capability id | Resource | Verb | Side-effect | Kind | Status |
|---------------|----------|------|-------------|------|--------|
| `text.draft` | text | draft | draft | primitive | PLANNED — generative text in user voice from brief |
| `text.rewrite` | text | update | draft | primitive | PLANNED — rewrite / improve existing text |
| `text.summarize` | text | digest | read | primitive | PLANNED — summarize long-form content |
| `text.translate` | text | create | draft | primitive | PLANNED — translate to target language |
| `image.generate` | image | create | draft | primitive | PLANNED — generate image from prompt + style profile |
| `image.edit` | image | update | draft | primitive | PLANNED — inpaint / outpaint / retouch |
| `image.describe` | image | get | read | primitive | PLANNED — alt-text / structured description of an image |
| `image.grade` | image | classify | read | primitive | PLANNED — rate image quality / pick best from set (judgment) |
| `video.rough-cut` | video | create | draft | primitive | PLANNED — assemble rough cut from clips (prep-and-handoff tier) |
| `video.subtitle` | video | update | draft | primitive | PLANNED — auto-transcribe + subtitle attachment |
| `audio.transcribe` | audio | get | read | primitive | PLANNED — speech-to-text |
| `audio.generate` | audio | create | draft | primitive | PLANNED — text-to-speech / music stub |

### 10. E-Commerce & Inventory

Connectors: planned (`shopify`, `woocommerce`, `square`).

| Capability id | Resource | Verb | Side-effect | Kind | Status |
|---------------|----------|------|-------------|------|--------|
| `product.read` | product | get | read | atomic | PLANNED (new connector) |
| `product.list` | product | list | read | atomic | PLANNED (new connector) |
| `product.create` | product | create | write | atomic | PLANNED (new connector) |
| `product.update` | product | update | write | atomic | PLANNED (new connector) |
| `order.read` | order | get | read | atomic | PLANNED (new connector) |
| `order.list` | order | list | read | atomic | PLANNED (new connector) |
| `order.fulfil` | order | update | write | atomic | PLANNED (new connector) |
| `order.refund` | order | create | write | atomic | PLANNED (new connector) |
| `inventory.read` | inventory | get | read | atomic | PLANNED (new connector) |
| `inventory.update` | inventory | update | write | atomic | PLANNED (new connector) |
| `product-description.draft` | product | draft | draft | primitive | PLANNED — generative: write product copy in brand voice |
| `low-stock.alert` | inventory | trigger | read | primitive | PLANNED — detect below-threshold stock → escalate |

### 11. Accounting & Finance

Connectors: planned (`xero`, `quickbooks`, `freshbooks`).

| Capability id | Resource | Verb | Side-effect | Kind | Status |
|---------------|----------|------|-------------|------|--------|
| `bill.read` | bill | get | read | atomic | PLANNED (new connector) |
| `bill.list` | bill | list | read | atomic | PLANNED (new connector) |
| `bill.create` | bill | create | write | atomic | PLANNED (new connector) |
| `bill.approve` | bill | update | write | atomic | PLANNED (new connector) |
| `expense.read` | expense | get | read | atomic | PLANNED (new connector) |
| `expense.create` | expense | create | write | atomic | PLANNED (new connector) |
| `expense.categorize` | expense | update | write | primitive | PLANNED — classify + code expenses |
| `report.profit-loss` | report | get | read | primitive | PLANNED — pull P&L for a period |
| `report.cashflow` | report | get | read | primitive | PLANNED |
| `reconcile.bank` | transaction | update | write | primitive | PLANNED — match transactions to bank feed |
| `tax.estimate` | report | get | read | primitive | PLANNED — estimated tax liability for period |

### 12. HR & Recruiting

Connectors: planned (`greenhouse`, `lever`, `bamboo-hr`, `rippling`).

| Capability id | Resource | Verb | Side-effect | Kind | Status |
|---------------|----------|------|-------------|------|--------|
| `candidate.read` | candidate | get | read | atomic | PLANNED (new connector) |
| `candidate.list` | candidate | list | read | atomic | PLANNED (new connector) |
| `candidate.advance` | candidate | update | write | atomic | PLANNED — move pipeline stage |
| `candidate.reject` | candidate | update | write | atomic | PLANNED |
| `outreach.candidate-draft` | candidate | draft | draft | primitive | PLANNED — generative: personalized outreach to candidate |
| `job.post` | job | create | write | atomic | PLANNED (new connector) |
| `job.close` | job | delete | write | atomic | PLANNED (new connector) |
| `employee.read` | employee | get | read | atomic | PLANNED (new connector) |
| `employee.onboard` | employee | create | write | primitive | PLANNED — provisioning steps sequence |
| `timeoff.read` | timeoff | list | read | atomic | PLANNED (new connector) |
| `timeoff.approve` | timeoff | update | write | atomic | PLANNED (new connector) |
| `payroll.digest` | payroll | digest | read | primitive | PLANNED — upcoming payroll summary |

### 13. Developer & System Tools

Connectors: planned (`github`, `gitlab`, `jira`, `pagerduty`, `datadog`).

| Capability id | Resource | Verb | Side-effect | Kind | Status |
|---------------|----------|------|-------------|------|--------|
| `repo.read` | repository | get | read | atomic | PLANNED (new connector) |
| `issue.list` | issue | list | read | atomic | PLANNED (new connector) |
| `issue.create` | issue | create | write | atomic | PLANNED (new connector) |
| `issue.update` | issue | update | write | atomic | PLANNED (new connector) — assign, label, close |
| `pr.list` | pull-request | list | read | atomic | PLANNED (new connector) |
| `pr.review-draft` | pull-request | draft | draft | primitive | PLANNED — generative: draft review comment in user voice |
| `commit.read` | commit | get | read | atomic | PLANNED (new connector) |
| `alert.read` | alert | list | read | atomic | PLANNED (new connector) — PagerDuty / Datadog |
| `alert.acknowledge` | alert | update | write | atomic | PLANNED (new connector) |
| `alert.digest` | alert | digest | read | primitive | PLANNED — on-call summary |
| `deploy.trigger` | deployment | create | write | atomic | PLANNED (new connector) — trigger CI/CD pipeline |
| `log.search` | log | search | read | atomic | PLANNED (new connector) |

### 14. System / Utility (Cross-cutting Control Flow)

These are the **standard utility toolset** every agent receives (design §7.2), distinct from connector capabilities. They are not OAuth-backed and require no connector grant.

| Capability id | Resource | Verb | Side-effect | Notes | Status |
|---------------|----------|------|-------------|-------|--------|
| `util.wait` | time | get | read | pause until a datetime or duration | PLANNED |
| `util.if` | control | — | read | branch on a condition | PLANNED |
| `util.loop` | control | — | read | iterate over a list | PLANNED |
| `util.try-retry` | control | — | read | retry with back-off | PLANNED |
| `util.transform` | data | create | read | map / filter / reshape structured data | PLANNED |
| `util.request-approval` | approval | create | draft | pause run, emit AgentRequest, resume on resolution | PLANNED |
| `util.ask-human` | input | get | read | request a value or decision from the user | PLANNED |
| `util.delegate` | task | create | write | spawn a sub-task to another agent | PLANNED |
| `util.done` | artifact | create | read | return a final artifact / mark run complete | PLANNED |
| `util.memory-read` | memory | get | read | retrieve relevant agent or user memory | PLANNED |
| `util.memory-write` | memory | upsert | draft | persist a fact / correction to memory | PLANNED |
| `util.style-read` | style-profile | get | read | inject user's Style/Taste Profile into context | PLANNED |

### 15. Notification & Reach-Me Channels (Escalation Layer)

These are the **reach-me** channels (design §11) — distinct from work connectors; used for escalation, HITL, and agent notifications only. Not general automation surfaces.

| Capability id | Resource | Verb | Side-effect | Notes | Status |
|---------------|----------|------|-------------|-------|--------|
| `notify.push` | notification | send | write | in-app push; no connector needed | PLANNED |
| `notify.email` | notification | send | write | escalation email via the Nibbin send-path | PLANNED |
| `notify.sms` | notification | send | write | Twilio SMS; inert until offline reg | PLANNED |
| `notify.telegram` | notification | send | write | Telegram; live in reach-me (#147) | PLANNED |
| `notify.whatsapp` | notification | send | write | WhatsApp Business; inert until offline reg | PLANNED |

---

## Summary counts

| Category | BUILT | PLANNED | Total |
|----------|-------|---------|-------|
| Email | 7 | 7 | 14 |
| Calendar | 1 | 9 | 10 |
| Payments & Invoicing | 3 | 15 | 18 |
| Files & Storage | 0 | 19 | 19 |
| Tasks & Projects | 0 | 17 | 17 |
| Messaging & Social | 0 | 16 | 16 |
| CRM, Leads & Booking | 0 | 16 | 16 |
| Web & Research | 6 | 10 | 16 |
| Content Generation | 0 | 12 | 12 |
| E-Commerce & Inventory | 0 | 12 | 12 |
| Accounting & Finance | 0 | 11 | 11 |
| HR & Recruiting | 0 | 12 | 12 |
| Developer & System Tools | 0 | 12 | 12 |
| System / Utility | 0 | 12 | 12 |
| Notification Channels | 0 | 5 | 5 |
| **Total** | **17** | **165** | **182** |

> **17 capabilities are BUILT today** (6 atomics + 5 primitives in the connector stack + 6 computer\_use verbs). **165 are PLANNED** — this is the living roadmap the seed-then-grow flywheel (§4) populates.

---

## Connector build order (implied by this taxonomy)

The following connectors are needed to unlock planned capabilities. Prioritized by cross-domain breadth and universal-core coverage (design §4):

1. **google-drive** — unlocks files/storage + doc primitives
2. **notion** — unlocks tasks + docs (many personas)
3. **slack** — unlocks messaging + team coordination
4. **hubspot / salesforce** — unlocks CRM + outreach
5. **github** — unlocks developer tools
6. **shopify** — unlocks e-commerce
7. **xero / quickbooks** — unlocks accounting
8. **linear / asana** — unlocks project management
9. **twitter-x / linkedin / instagram** — unlocks social publishing

Connectors not listed here fall to the **generic-web / MCP / computer-use rail** until a dedicated connector is built.

---

## Growth process

1. The **field study** surfaces frequent tasks with no matching capability → logged as a demand signal in the `capabilities` table.
2. The **shop-seed sourcing pass** (build deliverable R37) surveys MCP servers, agent marketplaces, and vendor offerings → new PLANNED entries.
3. The **capability demand dashboard** (Tier-2 fleet signal, §12B) prioritizes the build order.
4. When a capability is built and registered in `packages/runtime/src/capabilities.ts`, this doc is updated: mark PLANNED → **BUILT** and cite the registry id.

This doc is the **single source of truth** for what Nibbin can do and what it intends to do next.
