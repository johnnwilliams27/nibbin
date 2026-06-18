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

Self-contained — `cargo build` succeeds on Windows (clean, zero warnings) and
all 164 unit tests pass. The sibling path deps have been trimmed (see Local
modifications below). Not yet wired into the cargo workspace.

## Local modifications

### Task 2.0 — trim sibling deps; make self-contained (2026-06-18)

`screenpipe-a11y` originally depended on three un-vendored sibling crates.
All three have been eliminated:

**`screenpipe-core` and `screenpipe-config` → `src/local_compat.rs`**

- `window_pattern::{self, WindowPattern}` — replaced with a capture-everything
  stub. Nibbin never constructs pattern lists; filtering is Nibbin's own
  `UserExclusions` + redaction downstream. `matches_any` always returns
  `false`; `passes_includes` returns `true` when the include-list is empty
  (which it always is for Nibbin). Import repointed from
  `screenpipe_core::window_pattern` to `crate::local_compat::window_pattern`
  in: `src/config.rs`, `src/tree/windows.rs`, `src/tree/macos.rs`,
  `src/tree/linux.rs`.
- `pii_removal::remove_pii` — dropped entirely. Each call site replaced with
  the identity (`let text = content;` or the plain closure value). Nibbin's
  own redaction pipeline is authoritative. Affected:
  `src/platform/windows.rs` (2 sites), `src/platform/macos.rs` (6 sites),
  `src/platform/linux.rs` (5 sites).
- `paths::default_screenpipe_data_dir()` — replaced with
  `dirs::data_dir().unwrap_or_else(std::env::temp_dir).join("screenpipe")`.
  Used only for clipboard crash-marker files on macOS (2 sites in
  `src/platform/macos.rs`). Approximate path is fine.
- `screen_is_locked` / `set_screen_locked` — faithfully reimplemented as a
  global `AtomicBool` in `local_compat::lock_state`. Qualified calls
  `screenpipe_config::screen_is_locked()` / `set_screen_locked()` replaced
  with `crate::local_compat::screen_is_locked()` / `set_screen_locked()` in
  `src/platform/windows_uia.rs` (4 sites, all `#[cfg(target_os = "windows")]`).

**`screenpipe-db` — db feature and `to_db_insert` removed**

The `db` feature and its `screenpipe-db` optional path dep were removed from
`Cargo.toml`. The entire `#[cfg(feature = "db")] impl UiEvent { to_db_insert
}` block in `src/events.rs` was deleted. Nibbin uses its own DB schema.

**Test adjustments in `src/tree/windows.rs`**

- `test_extension_popup_ignored_via_child_text`: assertion updated from
  `hit=true` (window-pattern feature) to `hit=false` (capture-everything
  stub). Nibbin filters Bitwarden via `EXCLUDED_APPS` + redaction.
- `test_incognito_detection`: removed incorrect assertion that
  `is_title_private("Enter Password - Chrome")` returns true (that string
  is not an incognito indicator and was a pre-existing test bug); replaced
  with the negation.

**Tests deleted from `src/config.rs`**

Deleted 4 tests that exercised the now-stubbed window-scoping behavior:
`test_user_window_filters`, `test_scoped_ignore_per_window`,
`test_scoped_include_per_app_whitelist`,
`test_cached_pattern_path_is_consistent_with_lazy_path`. Kept:
`test_default_config`, `test_app_exclusion`, `test_window_exclusion`,
`test_password_field_detection`.
