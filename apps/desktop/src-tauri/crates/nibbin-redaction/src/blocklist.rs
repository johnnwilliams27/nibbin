//! Layer 2 — category blocklist (C5), evaluated BEFORE persistence. A hit
//! drops the event entirely; nothing is recorded, not even a gap.

use serde::Deserialize;
use std::collections::HashMap;
use std::sync::OnceLock;

const BLOCKLIST_JSON: &str =
    include_str!("../../../../../../packages/redaction/rules/category-blocklist.json");

#[derive(Deserialize)]
struct BlocklistFile {
    #[serde(rename = "blockedCategories")]
    blocked_categories: Vec<String>,
    matchers: HashMap<String, CategoryMatchers>,
}

#[derive(Deserialize)]
struct CategoryMatchers {
    hosts: Vec<String>,
    #[serde(rename = "bundleIds")]
    bundle_ids: Vec<String>,
    #[serde(rename = "titleTerms")]
    title_terms: Vec<String>,
}

fn blocklist() -> &'static BlocklistFile {
    static LIST: OnceLock<BlocklistFile> = OnceLock::new();
    LIST.get_or_init(|| {
        serde_json::from_str(BLOCKLIST_JSON).expect("category-blocklist.json must parse")
    })
}

/// User-added exclusions (layer 4 feeds layer 2). Stored locally only.
#[derive(Debug, Clone, Default)]
pub struct UserExclusions {
    pub hosts: Vec<String>,
    pub bundle_ids: Vec<String>,
    pub app_names: Vec<String>,
}

fn host_matches(host: &str, suffix: &str) -> bool {
    let h = host.to_lowercase();
    let s = suffix.to_lowercase();
    h == s || h.ends_with(&format!(".{s}"))
}

/// Returns the blocking category for a window/app/host, or None.
pub fn blocked_category_for(
    window_title: &str,
    window_category: Option<&str>,
    app_bundle_id: &str,
    app_name: &str,
    url_host: Option<&str>,
    exclusions: &UserExclusions,
) -> Option<String> {
    let list = blocklist();

    if let Some(category) = window_category {
        if list.blocked_categories.iter().any(|c| c == category) {
            return Some(category.to_string());
        }
    }

    let bundle = app_bundle_id.to_lowercase();
    let title = window_title.to_lowercase();

    for (category, m) in &list.matchers {
        if let Some(host) = url_host {
            if m.hosts.iter().any(|h| host_matches(host, h)) {
                return Some(category.clone());
            }
        }
        if m.bundle_ids.iter().any(|b| {
            bundle == b.to_lowercase() || bundle.starts_with(&format!("{}.", b.to_lowercase()))
        }) {
            return Some(category.clone());
        }
        if m.title_terms
            .iter()
            .any(|t| title.contains(&t.to_lowercase()))
        {
            return Some(category.clone());
        }
    }

    if let Some(host) = url_host {
        if exclusions.hosts.iter().any(|h| host_matches(host, h)) {
            return Some("user_exclusion".to_string());
        }
    }
    if exclusions
        .bundle_ids
        .iter()
        .any(|b| bundle == b.to_lowercase())
    {
        return Some("user_exclusion".to_string());
    }
    if exclusions
        .app_names
        .iter()
        .any(|n| app_name.to_lowercase() == n.to_lowercase())
    {
        return Some("user_exclusion".to_string());
    }

    None
}
