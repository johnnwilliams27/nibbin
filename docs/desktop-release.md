# Desktop installers — build, sign & release

The Nibbin Observer (`apps/desktop`, Tauri 2) is built into installers by
`.github/workflows/desktop-release.yml` and published to the **public** repo
[`nibbin-desktop`](https://github.com/johnnwilliams27/nibbin-desktop) (this
source repo is private, so its release assets aren't anonymously downloadable).

The web onboarding handoff links to `/download/mac` and `/download/windows`
(`apps/web/app/download/[platform]/route.ts`), which redirect to the newest
matching asset (`.dmg` / `.msi`) in that public repo — version-proof, and falls
back to the releases page until the first build is published.

## Triggering a release

- Push a tag: `git tag desktop-v0.1.0 && git push origin desktop-v0.1.0`, **or**
- Run the **desktop-release** workflow manually (Actions → Run workflow).

The workflow builds on macOS (universal `.dmg`) + Windows (`.msi`) runners, then
a publish job creates a prerelease in `nibbin-desktop` with both installers.

## Required GitHub secrets (in the **nibbin** repo settings)

### Cross-repo publishing (required for *any* release)
- **`RELEASES_REPO_TOKEN`** — a fine-grained Personal Access Token with
  **Contents: Read and write** scoped to the `nibbin-desktop` repo. (Settings →
  Developer settings → Fine-grained tokens.) The default `GITHUB_TOKEN` can't
  write to another repo, so without this the publish job fails.

### macOS signing + notarization (optional — unsigned builds work without it)
- **`APPLE_CERTIFICATE`** — base64 of the Developer ID Application `.p12`
- **`APPLE_CERTIFICATE_PASSWORD`** — the `.p12` export password
- **`APPLE_SIGNING_IDENTITY`** — e.g. `Developer ID Application: John Williams (QDYH5889Y2)`
- **`APPLE_ID`** — `jnwilliams27@gmail.com`
- **`APPLE_PASSWORD`** — an app-specific password (appleid.apple.com → Sign-In & Security → App-Specific Passwords)
- **`APPLE_TEAM_ID`** — `QDYH5889Y2`

#### Producing the Apple `.p12` (on Windows, via Git Bash `openssl`)
```bash
openssl genrsa -out nibbin-devid.key 2048
openssl req -new -key nibbin-devid.key -out nibbin-devid.csr \
  -subj "/emailAddress=jnwilliams27@gmail.com/CN=Nibbin Developer ID/C=US"
# Apple Developer → Certificates → + → "Developer ID Application" → upload the .csr → download the .cer
openssl x509 -inform DER -in developerID_application.cer -out devid.pem
openssl pkcs12 -export -out nibbin-devid.p12 -inkey nibbin-devid.key -in devid.pem
base64 -w0 nibbin-devid.p12 > nibbin-devid.p12.b64   # paste into APPLE_CERTIFICATE
```

### Windows signing (follow-up — unsigned `.msi` works until then)
Recommended: **Azure Trusted Signing** (~$10/mo, cloud, CI-friendly) or an OV
cert via SSL.com eSigner / DigiCert KeyLocker. A physical USB-token EV cert can't
be used on GitHub-hosted runners. Once chosen, wire the signing step into the
Windows matrix leg.

## Unsigned builds
Until the certs are configured the installers are **unsigned**: they download and
run, but macOS Gatekeeper ("unidentified developer") and Windows SmartScreen warn
on first launch. SmartScreen reputation accrues with downloads.

## Known first-cut follow-ups
- Pin `dtolnay/rust-toolchain`, `actions/cache`, `tauri-apps/tauri-action`,
  `actions/upload-artifact`, `actions/download-artifact` by commit SHA (repo
  policy — `ci.yml` pins everything).
- The Tauri shell is in the nested layout `apps/desktop/src-tauri/app`; the
  bundle artifact paths in the workflow may need tuning after the first run.
- The `app` shell crate has never been bundled before — the first macOS/Windows
  build may surface compile/asset issues to fix (the privacy-core crates already
  build green in `ci.yml`).
- Replace the placeholder tray icon (`icons/tray.png`, currently a copy of the
  32px app icon) with a proper monochrome macOS template image.
