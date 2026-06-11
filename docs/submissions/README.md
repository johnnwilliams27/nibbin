# Platform approval submissions

Long-lead external approvals that SPEC §6.9 mandates **filing at M1** (because M3 connectors
depend on them and they take weeks–months). These are **drafts** — the content to lift into the
Google / Meta consoles once the accounts exist (task #4). The M1 DoD is "both processes
**initiated and tracked** in docs/STATE.md," not "approved."

| File | What | Blocks |
|---|---|---|
| [google-oauth-verification.md](google-oauth-verification.md) | Google OAuth verification + CASA (Gmail/Calendar/Drive scopes) | M3 Google connectors past the 100-user cap |
| [meta-app-review.md](meta-app-review.md) | Meta App Review + Business Verification (Instagram DMs) | M3 Instagram-DM connector |

**Rule:** every data-handling statement in these drafts must match `docs/INVARIANTS.md` (C1–C11)
exactly. If the build ever diverges from a claim made here, fix the build or amend the Decision
Log — never weaken the claim to match a gap (that's a claims-auditor finding *and* a platform-policy
violation).

**When filing:** record the submission date (and CASA/business-verification dates) in
`docs/STATE.md` under the M1 approval-tracking lines.
