# Desktop release `desktop-v0.2.2`

Supersedes the last shipped tag `desktop-v0.2.1`. Bundles every desktop change merged since then (the #195 D1–D8 pass, the #198 study-status POST) plus the terminal stopped-emit added in this PR.

## How to ship
The release workflow (`.github/workflows/desktop-release.yml`) reads the version from `apps/desktop/src-tauri/app/tauri.conf.json` (now `0.2.2`). Two ways to cut it:
- **Tag push** (canonical): push tag `desktop-v0.2.2` → the workflow builds + signs the bundles and publishes a release with that tag.
- **Manual dispatch**: run the workflow manually → it derives `desktop-v0.2.2-<run#>` from the conf version.

Builds are signed (Azure Trusted Signing on Windows `.msi`/`.exe`; signed macOS `.dmg`) and published to the public `nibbin-desktop` repo.

**Do not tag until the on-device checklist below passes.** Every desktop change since `0.2.1` is compile-verified only.

## What's in it
- **Tray lifecycle** — single tray icon (no more ~15 ghost icons); the icon is cleaned up on exit.
- **Fresh-install capture** — observerd is spawned immediately on first launch + single-instance guard, so a brand-new install captures without requiring a re-login.
- **Field Study** — first-render loader (no blank sub-tab), tab-chrome alignment with the nav, live study countdown, quick-scan consent copy.
- **Study web-visibility** — desktop POSTs a minimal study-status signal (start/stop) so the web grove shows an in-progress "Watching" card.
- **NEW (this PR): terminal stopped-emit** — the desktop now reports `status:'stopped'` on *every* end path (day-14 hard stop, quick-scan backstop, delete-everything, and on next launch after an offline stop), not just the two explicit stop buttons. The web already self-heals via `ends_at`/staleness, so this just clears the in-progress card faster.

## On-device verification checklist (Windows)
Run a fresh install of the `0.2.2` build on a clean Windows machine and confirm:

- [ ] **Tray:** exactly one Nibbin tray icon appears (check the "show hidden icons" tray overflow — should NOT be a row of duplicates).
- [ ] **Exit cleanup:** quitting the app removes the tray icon (no orphan), and the daemon stops.
- [ ] **Fresh-install capture:** on first launch (no prior login session), start a study and confirm capture begins **without** needing to log out / log back in.
- [ ] **Single instance:** launching the app a second time focuses the existing window instead of opening a duplicate.
- [ ] **Field Study tab:** opening the Field Study tab renders content on the first click (no blank state requiring a sub-tab round-trip).
- [ ] **Countdown:** an active study shows a live countdown that ticks down.
- [ ] **Study POST — start:** start a study → nibbin.com grove home shows the "Field study in progress / Watching" card.
- [ ] **Study POST — stop (button):** end the study early → the Watching card clears.
- [ ] **Study POST — stop (terminal/auto):** trigger an auto/terminal end (or let a quick-scan backstop fire) → the Watching card clears without pressing a stop button.
- [ ] **Auth under shell:** `bridge.accessToken()` returns a token when signed in (the POSTs actually authenticate).

## macOS
Same flow on macOS (tray = menu-bar item; signed `.dmg`). The macOS AX adapter remains a separate tracked item and is not gated by this release.
