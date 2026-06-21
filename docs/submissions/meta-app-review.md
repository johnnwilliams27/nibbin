# Meta App Review (Instagram DMs) — submission draft

**Status:** DRAFT — ready to file once the Meta developer account + app + business exist
(blocked on task #4). Per SPEC §6.9 this is long-lead and filed at M1 because M3's Instagram-DM
connector depends on it. Instagram DMs are "the hardest API, biggest differentiation" (§4.3).

**Owner:** John. **Data-handling claims source of truth:** `docs/INVARIANTS.md` (C1–C11).

---

## 0. Prerequisites (in order)

1. Create a **Meta Business** (business.facebook.com) for Nibbin, Inc. and complete **Business
   Verification** (legal name, address, domain, documents) — required before advanced
   permissions are granted. This itself takes days–weeks; start first.
2. In developers.facebook.com create an app of type **Business**. Add the user as admin.
3. Add the **Instagram** product. Decide the integration path (see §1) — prefer the newer
   **Instagram API with Instagram Login** unless a Facebook-Page-linked flow is needed.
4. Verify domain `nibbin.com` in the app (meta-tag or DNS), set **App Domains**, **Privacy
   Policy URL** `https://nibbin.com/privacy`, **Terms** `https://nibbin.com/terms`, **App icon**
   (1024×1024), **Data Deletion** callback URL (see §4).
5. Set up the **messages webhook** (signature-verified per §6.5) and a test IG Business/Creator
   account to demonstrate the flow.

---

## 1. Integration path + permissions

Two viable paths — pick one and request only its permissions:

**Path A (preferred): Instagram API with Instagram Login**
| Permission | Use it powers | Minimal because |
|---|---|---|
| `instagram_business_basic` | Identify the connected IG professional account, read profile/basic | Needed to attach the connection to the account |
| `instagram_business_manage_messages` | Read incoming DMs (inquiry scan) and send a reply **the user approved** | The single permission for IG DM read+reply; no narrower one exists |

**Path B (legacy: Facebook Login + linked IG):** `instagram_basic`, `instagram_manage_messages`,
`pages_manage_metadata`, `pages_messaging`, `business_management`. More permissions, more review
surface — only if a Page-linked customer requires it.

**Deliberately NOT requested:** content publishing, ads, insights beyond what a scan needs,
comment moderation, anything unrelated to reading and replying to DMs. State this explicitly.

---

## 2. Platform-policy compliance (the part that gets IG-DM apps rejected)

Address each in the submission narrative — these are the Messenger/Instagram Platform policy
tripwires, and Nibbin's design satisfies them by construction:

- **Human in the loop / no unsolicited automation:** Nibbins **draft** replies; the user
  **approves** before anything sends (Agent School: Student stage). Nibbin does **not** send
  unsolicited or bulk DMs. This maps cleanly to Meta's "no spam, no automated unsolicited
  messaging" rules.
- **24-hour standard messaging window:** replies are sent within the standard window in response
  to a user-initiated message; if a human-handoff is needed beyond 24h, use the `human_agent`
  tag (≤7 days) — never message-tag abuse for marketing.
- **Write requires a grant + Send action level (C8):** the connection reads DMs to scan; sending
  requires both a write grant and the owner having set the Send action level on that Nibbin.
- **Abuse controls (§6.9):** per-account send-velocity caps, new-account cooldowns, moderation on
  autonomous outbound, complaint-rate monitoring with automatic pause, per-capability kill
  switches. Name these — Meta wants to see you can't become a spam vector.
- **No prohibited data use:** message content is used only to provide the scan + supervised-reply
  features; never sold, never used for ads, never used to train general models without explicit
  default-off opt-in (C11).

---

## 3. Per-permission use-case text + screencast (App Review requires both)

For each requested permission, the submission needs a written use case **and** a screencast
demonstrating it in the live app with a test user.

**`instagram_business_manage_messages` — use case draft:**
> "The signed-in Instagram professional account connects to Nibbin. Nibbin reads incoming direct
> messages to produce a connector scan (e.g. unanswered inquiries) and to draft suggested
> replies. A reply is sent **only after the account owner reviews and approves the draft inside
> Nibbin**. Nibbin never sends unsolicited or automated messages; outbound is rate-limited and
> complaint-monitored. The user can disconnect at any time, which immediately stops all access
> and deletes the stored token."

**Screencast script (~3–4 min, screen recording with a test IG account):**
1. Nibbin sign-in → "Connect Instagram" → Meta's permission dialog showing the exact
   permissions → grant.
2. A real test DM arrives at the IG test account → Nibbin shows it in the **scan / inbox** view
   (read permission's purpose).
3. A Nibbin **drafts a reply** → the user **edits/approves** → Nibbin **sends** it → show it
   landing in Instagram (manage_messages send purpose).
4. The **Connections** screen → **disconnect** → narrate that access stops immediately and the
   token is deleted from the vault.

Use a clear, unbranded test account Meta's reviewer can reproduce; provide test credentials and
step-by-step instructions in the submission notes.

---

## 4. Data deletion, retention, and token handling

- **Data Deletion Request callback** (required field): implement an endpoint that, on Meta's
  signed deletion callback, deletes the account's Instagram-derived data and returns the
  confirmation URL + code. Also document the user-initiated "delete account / disconnect" path.
- **Token handling (C9):** OAuth tokens in the KMS-backed vault, never in the app DB; one-click
  revoke; revocation cascades; refresh rotation.
- **Retention (§6.11):** run logs 90d default/configurable; account data deleted ≤30d after
  deletion; backups ≤35d roll-off; deletions receipted.
- **Webhooks (§6.5):** every inbound message webhook signature-verified; replay window enforced.

---

## 5. Privacy policy must explicitly cover Instagram data

The privacy policy (`nibbin.com/privacy`, counsel-reviewed) must state what Instagram data is
accessed (direct messages and basic profile of the connected professional account), why
(supervised reply drafting + inbox scan), how it's stored (vaulted tokens; processed to provide
features only), that it is not sold or used for ads or model training without explicit opt-in
(C11), and how to request deletion. Meta cross-checks the policy against the requested
permissions.

---

## 6. Filing checklist (track in docs/STATE.md per the M1 DoD)

- [ ] Meta Business created + **Business Verification** submitted (start first — slow)
- [ ] App (Business type) created; Instagram product added; path chosen (A or B)
- [ ] Domain verified; privacy/terms/icon/app-domains set
- [ ] Data Deletion callback URL implemented + set
- [ ] Messages webhook configured + signature-verified
- [ ] Test IG professional account + reviewer instructions prepared
- [ ] Per-permission use cases written (the §3 text)
- [ ] Screencast recorded per the §3 script
- [ ] App Review submitted → record the **submission date** in STATE.md
- [ ] Advanced Access requested for the messaging permission

**M1 DoD is "process initiated and tracked"** — submitting business verification + the app-review
request and recording the dates satisfies it; full approval gates the M3 Instagram-DM connector.
