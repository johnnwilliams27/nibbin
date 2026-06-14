# Security Policy

## Reporting a vulnerability

Please report security issues **privately** — do not open a public issue.

- **Email:** hello@nibbin.com (preferred)
- Or use GitHub's **private vulnerability reporting** (repo → Security → Report a vulnerability).

Include: affected component (web, desktop Observer, installer), a description, reproduction steps, and impact. We aim to acknowledge within 3 business days and to keep you updated through to a fix. Please give us a reasonable window to remediate before any public disclosure.

## Scope

- **Web app** (nibbin.com) and account/auth surfaces
- **Desktop Observer** (the Tauri client + `observerd` daemon)
- **Installers** distributed via the public `nibbin-desktop` repo

## Verifying desktop downloads

Installers are built only in CI from source (never locally) and published with:

- **SHA-256 checksums** (`SHA256SUMS.txt` on each release) — verify your download matches.
- **Signed build provenance** — verify an artifact is genuinely built from this repo's workflow:
  ```
  gh attestation verify <installer-file> --repo johnnwilliams27/nibbin
  ```
- **Code signing** (when configured): macOS Developer ID + notarization; Windows Authenticode. Until signing is enabled, installers are unsigned and the OS will warn on first launch.

## Handling of sensitive data (Observer)

The Observer captures screen/activity data to learn your workflow. By design:

- Capture and the study database stay **local to your machine** (SQLCipher; key in the OS keystore) — they are never uploaded.
- Multi-layer **redaction** runs before anything is persisted; secure fields are suppressed at capture.
- A **hard day-14 stop** and a **pause hotkey** are enforced by the daemon.
- Auth tokens live only in the **OS keychain** (never on disk or in the study DB).

## Supported versions

The project is pre-1.0; only the latest release receives security fixes.
