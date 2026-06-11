# Vendored: Screenpipe capture primitives (MIT)

- **Upstream:** https://github.com/mediar-ai/screenpipe
- **Vendored commit:** `892199f742e46d0c5d9e8c06687b35ca7c2b6547`
  ("fix(connections): hide Apple Calendar tile on Windows (#3969)")
- **Vendored on:** 2026-06-11 (M6)
- **Subset:** `crates/screenpipe-a11y` — the macOS AX / Windows UIA / Linux
  AT-SPI accessibility-tree capture surface (platform/, tree/, events,
  incognito detection). This is the capture plumbing SPEC §3.1 forks to save
  months; Nibbin's moat is inference + agents, not capture.

## Why exactly this commit (license)

Upstream relicensed on 2026-06-10: commits `81e412ff53` → `f390fa9d29` moved
the core from MIT to the "Screenpipe Commercial License". That license states:
*"Versions of Screenpipe previously released under the MIT license remain
available under the MIT license."* This vendored snapshot is the **parent of
the relicense commit** — the last MIT-licensed state of the tree — and the
MIT `LICENSE.md` from that commit is preserved alongside it, as SPEC §3.1
requires. **Never** update this fork by pulling from upstream HEAD; anything
after `892199f742` is commercially licensed. (SPEC §9's "Fork Screenpipe
(MIT)" decision row should be revisited at the next gate: upstream is no
longer an MIT project going forward, so this fork is now frozen — we maintain
it ourselves.)

## Build status

NOT yet wired into the cargo workspace. The crate depends on upstream
siblings (`screenpipe-core`, `screenpipe-config`, `screenpipe-events`) and
workspace-level dependency pins that we do not vendor wholesale. The Observer
defines its own capture trait in
`apps/desktop/src-tauri/crates/nibbin-capture`; the macOS/Windows adapters
wrap this vendored tree-walking code during platform bring-up (macOS first,
on hardware), trimming the sibling dependencies at that point. Local
modifications, when they start, are tracked here.

## Local modifications

None yet — pristine copy of the subset at the commit above.
