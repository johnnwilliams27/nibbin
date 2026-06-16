//! Best-effort "a newer version is available" check. NOT an updater: it never
//! downloads or installs anything — it just asks GitHub whether a release newer
//! than the running build exists, so the UI can surface a dismissable banner
//! pointing at the public download page.
//!
//! The network call lives HERE, in Rust (via `ureq`, same pattern as auth.rs) —
//! deliberately NOT in the webview. The webview CSP is pinned to
//! supabase + nibbin.com, and api.github.com is intentionally NOT added to it;
//! doing the GET natively keeps that pin untouched.
//!
//! Every failure mode (offline, rate-limited, malformed JSON, weird tag) folds
//! to `update_available: false` — the check must never panic, throw, or block
//! app startup.

use serde::Serialize;
use tauri::AppHandle;

/// Public repo where the desktop installers + releases are published.
const RELEASES_REPO: &str = "johnnwilliams27/nibbin-desktop";

/// Result handed to the webview. `latest_version` is `None` when the lookup
/// failed for any reason (the UI then simply shows no banner).
#[derive(Debug, Serialize)]
pub struct UpdateInfo {
    pub current_version: String,
    pub latest_version: Option<String>,
    pub update_available: bool,
    pub download_url: String,
}

/// Platform-specific public download URL (nibbin.com redirects to the newest
/// installer asset for the platform — see apps/web/app/download/[platform]).
fn download_url() -> String {
    if cfg!(target_os = "macos") {
        "https://nibbin.com/download/mac".to_string()
    } else {
        "https://nibbin.com/download/windows".to_string()
    }
}

/// Strip the release-tag dressing down to the semver core.
/// `desktop-v0.3.0` → `0.3.0`; `v0.2.0` → `0.2.0`; `desktop-v0.2.0-17` → `0.2.0`
/// (the `-17` run-number / build suffix is dropped before parsing).
fn semver_core(tag: &str) -> &str {
    let s = tag
        .strip_prefix("desktop-v")
        .or_else(|| tag.strip_prefix('v'))
        .unwrap_or(tag);
    // Keep only the leading X.Y.Z; cut at the first '-' (run-number / pre-release
    // suffix) so a publish tag like `0.2.0-17` compares as plain `0.2.0`.
    match s.split_once('-') {
        Some((core, _)) => core,
        None => s,
    }
}

/// PURE, testable comparison: is the release `tag` strictly newer than the
/// running `current` version? Returns `false` on ANY parse error (best-effort:
/// a tag we can't understand never triggers an update prompt).
pub fn newer_available(current: &str, tag: &str) -> bool {
    let (Ok(cur), Ok(latest)) = (
        semver::Version::parse(current),
        semver::Version::parse(semver_core(tag)),
    ) else {
        return false;
    };
    latest > cur
}

/// Minimal shape of a GitHub release we care about.
#[derive(serde::Deserialize)]
struct GhRelease {
    tag_name: String,
    #[serde(default)]
    draft: bool,
    #[serde(default)]
    prerelease: bool,
}

/// Ask GitHub for the newest published (non-draft, non-prerelease) release tag.
/// Returns `None` on any network/parse failure — caller folds that to "no
/// update available".
fn fetch_latest_tag() -> Option<String> {
    let response = ureq::get(&format!(
        "https://api.github.com/repos/{RELEASES_REPO}/releases?per_page=10"
    ))
    .set("User-Agent", "nibbin-desktop")
    .set("Accept", "application/vnd.github+json")
    .call()
    .ok()?;
    let releases: Vec<GhRelease> = response.into_json().ok()?;
    releases
        .into_iter()
        .find(|r| !r.draft && !r.prerelease)
        .map(|r| r.tag_name)
}

/// `check_for_update` IPC command. Best-effort, account-agnostic, never blocks
/// or panics. The current version comes from the Tauri package info (which
/// mirrors tauri.conf.json `version`), so bumping that single field is all it
/// takes to make this report a new release.
#[tauri::command]
pub fn check_for_update(app: AppHandle) -> UpdateInfo {
    let current_version = app.package_info().version.to_string();
    let download_url = download_url();

    match fetch_latest_tag() {
        Some(tag) => {
            let update_available = newer_available(&current_version, &tag);
            UpdateInfo {
                current_version,
                latest_version: Some(semver_core(&tag).to_string()),
                update_available,
                download_url,
            }
        }
        None => UpdateInfo {
            current_version,
            latest_version: None,
            update_available: false,
            download_url,
        },
    }
}

/// Open a URL in the user's default browser, natively (the download page —
/// never inside the pinned webview). Thin wrapper over the opener plugin's
/// Rust API; used because `@tauri-apps/plugin-opener`'s JS binding isn't a
/// dependency of the frontend.
/// Allowlist of hosts the update banner is permitted to open. The command takes
/// a URL from the webview, so validate it (https + known host) before handing it
/// to the OS opener — a bare `open_url(arbitrary)` is a confused-deputy hole
/// (file://, custom schemes, arbitrary sites) even from the trusted local UI.
fn open_allowed(url: &str) -> bool {
    match url::Url::parse(url) {
        Ok(u) => {
            u.scheme() == "https"
                && matches!(
                    u.host_str(),
                    Some("nibbin.com") | Some("www.nibbin.com") | Some("github.com")
                )
        }
        Err(_) => false,
    }
}

#[tauri::command]
pub fn open_external(app: AppHandle, url: String) -> Result<(), String> {
    if !open_allowed(&url) {
        return Err("refused to open: only https nibbin.com / github.com URLs are allowed".into());
    }
    use tauri_plugin_opener::OpenerExt;
    app.opener()
        .open_url(url, None::<&str>)
        .map_err(|e| e.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn newer_release_triggers_update() {
        // A published 0.3.0 is newer than the running 0.2.0.
        assert!(newer_available("0.2.0", "desktop-v0.3.0"));
    }

    #[test]
    fn open_external_only_allows_https_known_hosts() {
        assert!(open_allowed("https://nibbin.com/download/windows"));
        assert!(open_allowed("https://www.nibbin.com/download/mac"));
        assert!(open_allowed(
            "https://github.com/johnnwilliams27/nibbin-desktop/releases"
        ));
        // rejected: wrong scheme, file://, other hosts, garbage
        assert!(!open_allowed("http://nibbin.com/x"));
        assert!(!open_allowed("file:///etc/passwd"));
        assert!(!open_allowed("https://evil.example.com/"));
        assert!(!open_allowed("javascript:alert(1)"));
        assert!(!open_allowed("not a url"));
    }

    #[test]
    fn same_version_is_not_an_update() {
        // Equal cores → no update (the `desktop-v` prefix is stripped first).
        assert!(!newer_available("0.2.0", "desktop-v0.2.0"));
    }

    #[test]
    fn run_number_suffix_compares_equal() {
        // The publish tag `desktop-v0.2.0-17` has core 0.2.0 == current → no update.
        assert!(!newer_available("0.2.0", "desktop-v0.2.0-17"));
    }

    #[test]
    fn garbage_tag_is_false() {
        // Unparseable tag must never trigger an update prompt.
        assert!(!newer_available("0.2.0", "not-a-version"));
    }

    #[test]
    fn plain_v_prefix_and_older_tag() {
        // `v` prefix is also stripped; an older release does not trigger.
        assert!(newer_available("0.2.0", "v0.2.1"));
        assert!(!newer_available("0.2.0", "v0.1.9"));
    }

    #[test]
    fn semver_core_strips_prefix_and_suffix() {
        assert_eq!(semver_core("desktop-v0.3.0"), "0.3.0");
        assert_eq!(semver_core("v0.2.0"), "0.2.0");
        assert_eq!(semver_core("desktop-v0.2.0-17"), "0.2.0");
        assert_eq!(semver_core("0.2.0"), "0.2.0");
    }
}
