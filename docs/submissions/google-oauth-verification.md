# Google OAuth Verification + CASA — submission draft

**Status:** DRAFT — ready to file once the Google Cloud project + OAuth consent screen exist
(blocked on task #4). Per SPEC §6.9 this is a long-lead process (weeks–months) filed at M1
because M3 connectors depend on it; unverified apps cap at 100 users.

**Owner:** John. **Source of truth for all data-handling claims:** `docs/INVARIANTS.md` (C1–C11).
Every statement below must stay true to those invariants — if the build diverges, fix the build
or the Decision Log, never soften a claim here to match a gap.

---

## 0. Prerequisites (do these first, in order)

1. Create a Google Cloud project (e.g. `nibbin-prod`) under a Google Workspace org on the
   `nibbin.com` domain (Workspace gives you domain ownership + the verified-business path).
2. Configure the **OAuth consent screen**: User Type **External**, Publishing status **In
   production** (verification is required to leave "Testing"). Fill App name **Nibbin**, user
   support email, developer contact, App logo (120×120 PNG, brand mark), **App home page**
   `https://nibbin.com`, **Privacy policy** `https://nibbin.com/privacy`, **Terms**
   `https://nibbin.com/terms`. Authorized domain: `nibbin.com`.
3. Publish `privacy.html` / `terms.html` at those URLs (counsel review first, per §6.9) — the
   privacy policy MUST describe the Google user data accessed and the Limited Use commitment
   (see §4 below) or verification is auto-rejected.
4. Register OAuth client(s) with exact redirect URIs (Supabase Auth callback + the connector
   callback). Keep redirect URIs to an exact allow-list — no wildcards (see GOTCHAS.md).
5. Decide the verification path: **sensitive scopes** → brand/consent review only;
   **restricted scopes** (Gmail/Drive read) → brand review **+ annual CASA** (§5).

---

## 1. Scopes requested + per-scope justification

Google grants the **narrowest** scope that supports a real, user-visible feature. Request only
these; justify each as minimal. Connect requests read **and** write scopes together at consent
time, with a plain-language explanation for each — but acquiring a scope never authorizes an
action. Execution is gated by the owner-set action level (Observe / Draft / Act): holding a write
scope never authorizes action on its own. The owner grants each Nibbin what it may do, and Agent
School grades how accurately it has been working so the owner knows when to grant more. State this
explicitly in the submission, because it is the strongest possible minimal-scope + user-control story.

| Scope | Class | Feature it powers | Why minimal |
|---|---|---|---|
| `.../auth/gmail.readonly` | **Restricted** | Inquiry / overdue / FAQ **scan modules** (§4.4); drafting reply suggestions a Nibbin proposes for user approval | Read is required to understand the inbox; no narrower Gmail read scope exists |
| `.../auth/gmail.send` | **Restricted** | Send a reply **only after the user approves the draft** (Agent School: Student drafts → user approves) | `send` cannot read mail; chosen over `gmail.modify` to avoid label/delete power we don't need |
| `.../auth/calendar.readonly` | Sensitive | Availability answers, scheduling scan | Read is enough to answer "when am I free" |
| `.../auth/calendar.events` | Sensitive | Create/edit events **on user-approved actions** (scheduling Nibbins) | Scoped to events, not calendar settings/ACLs |
| `.../auth/drive.file` | Recommended | File-delivery chains — Nibbin touches **only files the user picks via the Google Picker** | `drive.file` (per-file consent) instead of restricted `drive.readonly`; keeps us out of full-Drive CASA scope where possible |

**Deliberately NOT requested:** full `drive.readonly`/`drive`, `gmail.modify`, contacts,
admin SDK, anything broader than the table. Note this in the submission — reviewers reward an
explicit "scopes we declined."

> If you want to minimize the CASA surface for the first filing, you can file **sensitive scopes
> only** (Calendar + `drive.file`) to unblock those connectors fast, and file the **restricted**
> Gmail scopes as a second submission with the CASA assessment in parallel. Recommended: file both
> together so the clock starts once, but know the split exists if Gmail CASA lags.

---

## 2. OAuth consent screen — field-by-field draft copy

- **App name:** Nibbin
- **App description (if prompted):** "Nibbin connects a solo business owner's tools and runs
  small, supervised agents that draft replies, answer scheduling questions, and surface overdue
  items. Write scopes are requested at connect with a plain-language explanation; holding a write scope never authorizes action — execution is gated by the owner-set action level (Observe / Draft / Act). Agent School grades each Nibbin's accuracy so the owner knows when to grant it more."
- **Scope justification (the free-text box, per restricted scope) — Gmail readonly:**
  "Nibbin reads the signed-in user's Gmail to (1) produce a one-time 'connector scan' — counts of
  unanswered inquiries, overdue threads, and FAQ candidates — and (2) draft reply suggestions
  that the user reviews and approves before anything is sent. The user can
  revoke it one click at any time, which immediately stops all processing. Gmail content is
  processed to provide these user-facing features only and is never sold, never used for
  advertising, and never used to train general models without the user's explicit, separate,
  default-off opt-in."
- **Scope justification — Gmail send:** "Used solely to send a reply the user has explicitly
  approved in the Nibbin app. Nibbin never sends autonomously without an approved draft; new
  accounts have send-velocity caps and a cooldown, and outbound is complaint-rate monitored with
  automatic pause (anti-abuse, §6.9)."

---

## 3. Demonstration video (Google requires a screencast)

Record one unlisted YouTube video (~3–5 min) that shows, in this order:

1. The Nibbin sign-in, landing on the connect step.
2. Clicking "Connect Gmail" → the **Google consent screen** showing the exact scopes →
   granting.
3. In-product: the connector **scan result** (the read scope's purpose), then a Nibbin **drafting
   a reply** and the user **approving** it → the **send** (the send scope's purpose).
4. The **Connections** screen showing one-click **revoke**, and a sentence of narration that
   revoking immediately halts processing and the token is deleted from the vault.
5. Calendar + Drive (`drive.file` Picker) shown the same way if filed in this submission.

Narration must name each scope as it's used and state the Limited Use commitment aloud.

---

## 4. Limited Use / data-handling statement (must match INVARIANTS exactly)

Paste this in the submission and mirror it in the privacy policy:

> Nibbin's use and transfer of information received from Google APIs adheres to the
> [Google API Services User Data Policy](https://developers.google.com/terms/api-services-user-data-policy),
> including the **Limited Use** requirements.
> - Google user data is used **only** to provide and improve the user-facing features the user
>   connected the integration for (inbox scan, supervised drafts, scheduling answers, file
>   delivery).
> - We do **not** sell Google user data and do **not** share it with third parties except as
>   strictly necessary to provide these features, to comply with law, or as part of a
>   merger the user is notified of. (C11)
> - We do **not** use Google user data for advertising.
> - **Humans do not read** Google user data except: with the user's explicit consent (e.g. a
>   time-boxed "share with support" grant initiated by the user), for security/abuse
>   investigation, or to comply with law. Staff have no standing access to message content; the
>   admin console exposes account metadata only and logs every staff access. (§6.10)
> - We do **not** use Google user data to train generalized AI/ML models. Any
>   model-improvement contribution is a **separate, explicit, default-off** opt-in. (C11)

Supporting facts the reviewer may ask about (all true per INVARIANTS):
- **Token storage (C9):** OAuth tokens live in a KMS-backed vault with envelope encryption,
  never in the application database; one-click revoke per connection; revocation cascades to
  dependent agents. Refresh-token rotation; PKCE + state + nonce on the flow (§6.5).
- **Retention (§6.11 / INVARIANTS):** run logs default 90 days (configurable); account data
  deleted ≤30 days after account deletion; backups roll off ≤35 days; deletions are receipted.
- **Encryption in transit/at rest;** least-privilege access; audit logging on staff actions.

---

## 5. CASA (Cloud Application Security Assessment) — restricted scopes only

Restricted scopes (Gmail read/send, full Drive) require an **annual** CASA assessment.

- **Tier:** Tier 2 (independent lab verification) is typically required for restricted scopes at
  any real user volume. Confirm the current tier requirement in the verification console — Google
  states it per app.
- **How:** Google's verification flow routes you to an authorized assessor (e.g. via the
  [App Defense Alliance](https://appdefensealliance.dev/casa) — labs such as TAC Security,
  Bishop Fox, Leviathan, NCC). Expect: a **Self-Assessment Questionnaire (SAQ)**, a scan/pen-test
  of the OAuth-handling surface, and evidence of the controls above.
- **Evidence we already have / will have:** the security-engineering controls in SPEC §6.5
  (parameterized queries, RLS, PKCE, webhook signatures, SSRF guards), the append-only audit
  trail, the M8 external pen test + `THREATS.md`, and the CI SAST/dependency-audit gates. Map the
  SAQ questions to these.
- **Cost/lead time:** budget several weeks and an assessor fee. **Start the SAQ the day the
  Google Cloud project exists** — this is the long pole.

---

## 6. Filing checklist (track status in docs/STATE.md per the M1 DoD)

- [ ] Google Cloud project + Workspace org on nibbin.com
- [ ] OAuth consent screen configured (External, Production), logo, support emails
- [ ] privacy.html + terms.html live, counsel-reviewed, with the Limited Use language
- [ ] OAuth client(s) with exact redirect URIs (no wildcards)
- [ ] Scope list finalized (the §1 table); "declined scopes" noted
- [ ] Demo video recorded + unlisted link
- [ ] Verification submitted → record the **submission date** in STATE.md
- [ ] CASA: assessor engaged + SAQ started → record date; track to completion
- [ ] Business verification (if prompted) submitted

**M1 DoD is "process initiated and tracked"** — submitting + recording the dates satisfies it;
full approval lands later and gates M3 going past 100 users.
