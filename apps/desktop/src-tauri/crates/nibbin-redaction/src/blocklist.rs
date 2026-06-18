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
#[derive(Debug, Clone, Default, serde::Serialize, serde::Deserialize)]
pub struct UserExclusions {
    #[serde(default)]
    pub hosts: Vec<String>,
    #[serde(default)]
    pub bundle_ids: Vec<String>,
    #[serde(default)]
    pub app_names: Vec<String>,
}

impl UserExclusions {
    /// Merge another set in, preserving insertion order and dropping
    /// duplicates so the persisted file never grows unbounded on re-adds.
    pub fn merge(&mut self, more: UserExclusions) {
        for (dst, src) in [
            (&mut self.hosts, more.hosts),
            (&mut self.bundle_ids, more.bundle_ids),
            (&mut self.app_names, more.app_names),
        ] {
            for v in src {
                if !dst.contains(&v) {
                    dst.push(v);
                }
            }
        }
    }
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

#[cfg(test)]
mod tests {
    use super::UserExclusions;

    #[test]
    fn exclusions_serde_round_trips() {
        let ex = UserExclusions {
            hosts: vec!["evil.com".into()],
            bundle_ids: vec!["com.evil.app".into()],
            app_names: vec!["Evil".into()],
        };
        let json = serde_json::to_string(&ex).unwrap();
        let back: UserExclusions = serde_json::from_str(&json).unwrap();
        assert_eq!(back.hosts, ex.hosts);
        assert_eq!(back.bundle_ids, ex.bundle_ids);
        assert_eq!(back.app_names, ex.app_names);
    }

    #[test]
    fn merge_dedupes_repeated_entries() {
        let mut ex = UserExclusions {
            hosts: vec!["a.com".into()],
            ..Default::default()
        };
        ex.merge(UserExclusions {
            hosts: vec!["a.com".into(), "b.com".into()],
            ..Default::default()
        });
        assert_eq!(ex.hosts, vec!["a.com".to_string(), "b.com".to_string()]);
    }
}
