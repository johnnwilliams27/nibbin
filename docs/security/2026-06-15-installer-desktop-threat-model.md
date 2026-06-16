# Installer & Desktop Distribution Threat Model — Nibbin

- **Date:** 2026-06-15
- **Branch analyzed:** `feature/nibbin-desktop-unified-app`
- **Scope:** The build → sign → publish → download → run supply chain for the Nibbin desktop app (Tauri 2). Covers `.github/workflows/desktop-release.yml`, the `/download/{mac,windows}` redirector, the Tauri bundle/signing config, and the cross-repo publish to the **public** `johnnwilliams27/nibbin-desktop` releases repo.
- **Out of scope:** the daemon's runtime privacy invariants (C2–C7), Supabase RLS, web auth. This model is about *getting a trustworthy binary onto a user's machine*, not what it does once there.
- **Method:** STRIDE-flavored scenario analysis grounded in the actual files. No code was changed.

---

## Summary

The distribution chain is **architecturally sound but not yet hardened for wide release**. The good bones: builds run in CI on tagged inputs, artifacts get SHA256SUMS + signed build-provenance attestation, the redirector never trusts user input for the asset path, and `RELEASES_REPO_TOKEN` is scoped to a single public repo. Signing is wired and flips on by secret-presence with no code change.

The dominant residual risk is that **the Windows build currently ships UNSIGNED** (Azure Trusted Signing account blocked per project memory), so first-run shows a SmartScreen warning that trains users to click through — and **nothing in the user-facing download flow surfaces the checksums or the attestation**, so the strong integrity primitives that *do* exist are effectively invisible to the people who would need them. Combined with a public, mutable releases repo, the highest-leverage attack is **replacing or adding a release asset in `nibbin-desktop`**, which the `/download` redirector would then hand to every user automatically.

The user's explicit billing question has a **definitive answer: no.** Code-signing happens once per release at CI build time, not per download. GitHub Releases serves the downloads for free. Mass downloads cannot incur per-certificate charges. The real cost lever is *CI build frequency* and the Azure Trusted Signing tier/quota — and the workflow's `workflow_dispatch` trigger is the thing to lock down so a stray actor can't burn signing operations or CI minutes.

**There is no auto-updater.** No `tauri-plugin-updater` in any `Cargo.toml`, no `updater`/`endpoints`/`pubkey` in `tauri.conf.json`. Updates are 100% manual (user re-downloads). That eliminates a whole class of update-channel-hijack risk, at the cost of slow patch propagation.

---

## Assets & Trust Boundaries

| Asset | Where it lives | Why it matters |
|---|---|---|
| **Windows signing identity** (Azure Trusted Signing cert profile) | Azure; accessed in CI via `AZURE_TENANT_ID` / `AZURE_CLIENT_ID` / `AZURE_CLIENT_SECRET` service principal | Whoever can sign as "Nibbin" can produce installers that pass SmartScreen as us. Currently **dormant/blocked**, so builds are unsigned. |
| **Apple signing + notarization identity** | `APPLE_CERTIFICATE`, `APPLE_ID`, `APPLE_PASSWORD`, `APPLE_TEAM_ID` secrets | Same, for macOS Gatekeeper. |
| **`RELEASES_REPO_TOKEN`** | Repo secret; fine-grained PAT, `Contents:write` on `nibbin-desktop` | The keys to the public download repo. Blast radius = can create/overwrite releases that all users pull. **Was rotated after a transcript leak** (see Supply-chain section) — treat as a known-exposed-once credential. |
| **Release artifacts** (`.dmg` / `.msi` / `.nsis .exe` + `SHA256SUMS.txt`) | Public repo `johnnwilliams27/nibbin-desktop` releases | The thing users run with full OS privileges. |
| **Private source repo** (`Nibbin`) | Private GitHub repo | Holds the workflow + all signing secrets. Compromise here = compromise of everything downstream. |
| **Public releases repo** (`nibbin-desktop`) | Public GitHub repo | Distribution surface. Anyone who can push a release here reaches every user. |
| **The user's machine** | End user | Runs the installer with their privileges; NSIS `installMode: currentUser` (no admin elevation), which limits blast radius somewhat. |
| **`/download/{mac,windows}` redirector** | `apps/web` (nibbin.com), unauthenticated, `revalidate: 600` | The funnel. Trusts the *latest GitHub release* implicitly. |

**Primary trust boundaries crossed:**
1. Private repo → public repo (the cross-repo publish; one PAT bridges them).
2. CI → Azure/Apple (the signing identities).
3. nibbin.com → GitHub API → user's browser (the redirector hands off to an external URL).
4. Internet → user's machine (download + execute).

---

## Threat Scenarios

Severity scale: **Critical / High / Medium / Low**, judged on likelihood × impact *for the current beta state*.

### 1. Tampering / poisoned installer (Spoofing + Tampering)

| | |
|---|---|
| **Threat** | User installs a malicious binary believing it's Nibbin. |
| **Vectors** | (a) **MITM** of the download — defeated by HTTPS end-to-end (nibbin.com → `api.github.com` → `objects.githubusercontent.com`, all TLS). (b) **Typosquatting** the download — an attacker stands up `nibbin-app.com` or a lookalike GitHub repo and serves malware; nothing we control prevents this. (c) **Replacing/adding a release asset** in the public `nibbin-desktop` repo — see Scenario 3, this is the sharp one. |
| **Current mitigations** | HTTPS for the whole chain. GitHub hosts the assets. `SHA256SUMS.txt` is published alongside every release (`desktop-release.yml:179–184`). Signed **build-provenance attestation** via `actions/attest-build-provenance@v2` (`:186–196`), verifiable with `gh attestation verify <file> --repo johnnwilliams27/nibbin`. macOS notarization + Gatekeeper *when* Apple secrets are set. |
| **Residual risk** | **Windows is UNSIGNED today** (`certificateThumbprint: null` in `tauri.conf.json:56`; Azure account blocked). Unsigned `.exe`/`.msi` → SmartScreen "unrecognized app" warning on first run, which **trains users to click "Run anyway."** Once trained, a swapped malicious asset sails through. The SHA256SUMS and attestation are **real but unused**: the download UI (`apps/web/app/app/page.tsx:570–584`) links straight to `/download/mac` and `/download/windows` with **no checksum shown and no "how to verify" guidance** — so no normal user verifies anything. The attestation note is buried in GitHub release notes (`:215`). |
| **Severity** | **High** (drops to Medium once Windows signing is live; the unverified-checksum gap persists regardless). |

### 2. Supply chain on the release pipeline (Tampering + Elevation of Privilege)

| | |
|---|---|
| **Threat** | An attacker subverts the build/publish pipeline to ship a backdoored installer under our identity. |
| **Vectors** | (a) Compromise `RELEASES_REPO_TOKEN` → push a release directly to the public repo. (b) Compromise a CI dependency / unpinned action → inject into the build. (c) Compromise the source repo / a maintainer account → trigger a malicious signed build. |
| **Current mitigations** | `RELEASES_REPO_TOKEN` is a **fine-grained PAT scoped to `Contents:write` on `nibbin-desktop` only** — blast radius is the public repo, not the org. Top-level `permissions: contents: read` (`:44–45`); the publish job narrowly adds `id-token: write` + `attestations: write` (`:168–172`). `github.ref_name`/`ref_type` are passed via **env, not interpolated into the shell** (`:202–208`), closing the classic script-injection hole. `actions/checkout` and `actions/setup-node` **are pinned by SHA** (`:64`, `:66`). |
| **Residual risk** | **`RELEASES_REPO_TOKEN` was rotated after a transcript leak** (per project memory) — the rotation was the right call, but it confirms the token *has* been exposed once and lives in a CI context where logs/transcripts can leak it; keep it short-TTL and monitored. **Several actions are NOT pinned** and carry explicit TODOs: `dtolnay/rust-toolchain@stable` (`:72`), `actions/cache@v4` (`:77`), `tauri-apps/tauri-action@v0` (`:126` — `@v0` is a *moving* tag, the worst case), `actions/upload-artifact@v4` (`:148`), `actions/download-artifact@v4` (`:174`), `actions/attest-build-provenance@v2` (`:191`), and `cargo install trusted-signing-cli` is **unversioned** (`:123`, `--version` TODO). Any of these upstream tags could be moved to malicious code and would be pulled into a build that then gets signed and published. The attestation proves *which workflow run* built an artifact, but **only helps if someone actually verifies it** — and nothing forces that. Anyone with write access to the private repo can move the `desktop-v*` tag or hit `workflow_dispatch`. |
| **Severity** | **High** (unpinned `@v0` tauri-action + signing-on-the-same-run is the concrete path; the token blast-radius is well-contained). |

### 3. Distribution integrity — the redirector trusts "latest release" (Tampering)

| | |
|---|---|
| **Threat** | A compromised `nibbin-desktop` repo serves malware to **every** user via the official `/download` links, with no extra attacker work. |
| **Vectors** | The redirector (`route.ts:32–43`) fetches `…/releases?per_page=10` and 302s to the **first asset whose name ends in `.exe`/`.msi`/`.dmg`** in the **newest** release. There is **no pinning** to a known version, **no checksum check**, **no signature/attestation check** before redirect. Whoever controls the public repo (or the `RELEASES_REPO_TOKEN`) just publishes a new prerelease and it becomes the official download within the 600s cache window. |
| **Current mitigations** | The redirector is **read-only and version-proof** — it never trusts user input for the asset path (the `platform` param only selects an extension allowlist, `route.ts:15`), so there's no SSRF/open-redirect via the request itself. HTTPS throughout. Falls back safely to the releases page on API error. |
| **Residual risk** | The redirector's *trust root is the public repo's latest release* — exactly the asset an attacker would replace (Scenario 1c / 2a). There is **no allowlist of expected asset hashes**, no "minimum version," no verification gate. A single compromised release = mass distribution. The 10-minute cache slightly *widens* the window (a poisoned asset stays "official" for up to 10 min even after takedown). |
| **Severity** | **High** — this is the amplifier that turns "one bad release" into "every user." |

### 4. Update mechanism (Tampering)

| | |
|---|---|
| **Threat** | A hijacked update channel pushes malware to already-installed users silently. |
| **Finding** | **No updater exists.** Confirmed: no `tauri-plugin-updater` in any `Cargo.toml` under `apps/desktop/src-tauri/**`; no `updater`, `endpoints`, or `pubkey` keys in `tauri.conf.json`; grep for `updater|pubkey|endpoints|createUpdaterArtifacts` across `apps/desktop` returns nothing. |
| **Implication** | **No auto-update attack surface** — there is no signed-update-manifest channel to hijack, no updater pubkey to compromise. That's a security positive. **The trade-off:** updates are entirely manual (the user must re-visit `/download` and reinstall). So **patch propagation is slow** — if a vulnerable or backdoored build ships, there's no fast remote kill/replace; you're dependent on users noticing and re-downloading. There's also no in-app "you're out of date" nudge. |
| **Severity** | **Low** as a *threat* (nothing to attack). Note as an **operational gap** for incident response: no fast remediation path post-install. |

### 5. Deep-link / IPC surface (Spoofing) — adjacent, worth flagging

| | |
|---|---|
| **Threat** | The app registers the `nibbin://` URL scheme (`tauri.conf.json:35–38`, `lib.rs`) for auth handoff. Any local app can invoke a custom scheme; a malicious local process could feed a crafted `nibbin://auth…` deep link. |
| **Current mitigations** | The code comment at `lib.rs:46–49` shows awareness: session tokens are injected **out-of-band via init script, never in the URL**. CSP is locked down (`tauri.conf.json:31`) to `self` + Supabase + `nibbin.com`. |
| **Residual risk** | Custom-scheme registration is inherently spoofable by co-resident apps; ensure the deep-link auth handler validates/authenticates the payload rather than trusting scheme invocation. (Outside the core installer-distribution scope, but it's part of the install-time trust surface.) |
| **Severity** | **Low–Medium**, depends on the auth handler's validation (not fully reviewed here). |

---

## Signing-Cost Analysis — the billing question, answered definitively

**Question:** *Can scaled / mass downloads charge us per certificate?*

**Answer: No. Signing is a one-time-per-release CI build operation, not a per-download operation.** Mass downloads incur **zero** signing cost.

**Evidence from `desktop-release.yml`:**
- Signing happens **inside the `build` job**, at `tauri build` time (`:125–145`). The Windows `signCommand` (`trusted-signing-cli …`) is injected as a build-time `--config` patch (`:106–115`) and runs **once, in CI, while bundling the installer** — before any user ever sees it.
- The artifact is then uploaded once (`:147–155`) and **published a single time** to GitHub Releases (`gh release create`, `:212–218`).
- **Downloads are served by GitHub Releases**, free and unmetered for public repos. The `/download` redirector just 302s to `objects.githubusercontent.com` (`route.ts:41`). **No signing operation, and no Nibbin-controlled infrastructure, is on the download path.** A million downloads = a million free GitHub fetches of the *already-signed* bytes = $0 in signing.

So the cost model is **per build, not per install.** The actual cost levers are:
1. **CI build frequency** — each tag push / `workflow_dispatch` run consumes GitHub Actions minutes (macOS runners are the pricey ones, `:59`) and performs **one** Azure Trusted Signing operation per Windows build.
2. **Azure Trusted Signing tier/quota** — Trusted Signing bills on a subscription/quota basis (signing-operations allotment), not per artifact byte and *definitely* not per download. Each *build* = ~1 signing call.

**Can an attacker drive cost?** The relevant lever is **who can trigger the workflow**:
- Triggers are `workflow_dispatch` **+ `push: tags: desktop-v*`** (`:38–42`). Both are **maintainer-gated** — only someone with write access to the private repo can dispatch the workflow or push a `desktop-v*` tag. **A fork or an external PR cannot trigger it** (no `pull_request` trigger), so a drive-by attacker cannot cause a signed build or burn CI/signing minutes. Good.
- The realistic abuse is therefore **insider / compromised-maintainer**: someone with repo write could spam `workflow_dispatch` to drain CI minutes and signing quota. There is **no branch/tag protection or environment-approval gate** documented on the release path to slow that down.

**Recommended guardrails:**
- Restrict `workflow_dispatch` and `desktop-v*` tag pushes to a small set of release owners (GitHub Environments with required reviewers on the publish job, or a protected tag ruleset).
- Set an **Azure Trusted Signing quota / spend alert** so anomalous signing volume pages someone.
- Keep the macOS leg (the expensive runner) from running on every trivial dispatch — gate releases behind tags only for routine flow, reserve `workflow_dispatch` for owners.

---

## Prioritized Recommendations

### Fix before wider distribution / GA

| # | Recommendation | Why | Rough effort |
|---|---|---|---|
| 1 | **Get Windows code-signing live** (unblock Azure Trusted Signing; the workflow already flips on by secret-presence, `:106–115`). Until then, treat Windows distribution as beta-only. | Unsigned `.exe`/`.msi` trains users through SmartScreen — the single biggest real-world risk. | High (mostly Azure identity validation, already in flight per memory) |
| 2 | **Pin every action by SHA** and version `trusted-signing-cli` — clear the TODOs at `:72, :77, :123, :126, :148, :174, :191`. Especially `tauri-apps/tauri-action@v0` (moving tag) since it runs *with the signing secrets in env*. | A moved upstream tag injects into a signed, published build. | Medium |
| 3 | **Surface verification to users.** Show the SHA-256 on the download page and/or link a one-line `gh attestation verify` / `sha256sum` instruction near the `/download` buttons (`apps/web/app/app/page.tsx:570–584`). | The integrity primitives exist but are invisible; no one verifies what they can't see. | Low–Medium |
| 4 | **Lock down release triggers.** GitHub Environment with required reviewers on the `publish` job (or protected `desktop-v*` tag ruleset), restricting who can dispatch a signed/published release. | Contains insider/compromised-maintainer abuse of the publish path and signing quota. | Low |
| 5 | **Add Azure Trusted Signing quota + spend alerts.** | Anomalous signing volume = early signal of pipeline abuse; also the one place cost can actually run. | Low |

### Acceptable for beta (track, revisit before GA)

| # | Recommendation | Why | Rough effort |
|---|---|---|---|
| 6 | **Pin the redirector to a known-good minimum version / asset-hash allowlist** instead of blindly trusting "latest release" (`route.ts:32–43`). At minimum, prefer `/releases/latest` semantics over the first-of-10 prerelease scan once stable releases exist. | Turns "one compromised release" back into "doesn't auto-reach all users." | Medium |
| 7 | **Confirm `RELEASES_REPO_TOKEN` hygiene post-leak:** short expiry, fine-grained scope verified (Contents:write on `nibbin-desktop` only), and on the rotation calendar. Consider replacing the PAT with a GitHub App installation token to drop standing-credential risk. | Token was leaked-and-rotated once; reduce the standing blast radius. | Low (audit) / Medium (App token) |
| 8 | **Decide the update story before GA.** Either adopt `tauri-plugin-updater` *with* its signed-manifest model (new pubkey to protect, new attack surface — design it deliberately), or formalize a manual "you're out of date" in-app nudge + a documented fast-replace incident runbook. | Today there is no remote remediation path for a bad post-install build. | Medium–High |
| 9 | **Review the `nibbin://` deep-link auth handler** for payload validation against malicious local invocation (`lib.rs` auth path). | Custom schemes are spoofable by co-resident apps. | Low (review) |
| 10 | **Shorten the redirector cache** or add a cache-bust on takedown (`revalidate: 600`, `route.ts:19`) so a poisoned asset can be pulled fast. | 10-min window keeps a bad asset "official" after remediation begins. | Low |
