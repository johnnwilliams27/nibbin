//! URL scrubbing (SPEC §5): query strings and fragments dropped entirely;
//! host kept; id-like path segments templated to `{id}`.

use crate::event::UrlRef;
use regex::Regex;
use std::sync::OnceLock;

fn id_patterns() -> &'static Vec<Regex> {
    static RES: OnceLock<Vec<Regex>> = OnceLock::new();
    RES.get_or_init(|| {
        [
            r"^\d+$",
            r"^(?i)[0-9a-f]{6,}$",
            r"^(?i)[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$",
            r"^[A-Za-z0-9_-]{16,}$",
            r"\d{4,}",
        ]
        .iter()
        .map(|p| Regex::new(p).expect("static regex"))
        .collect()
    })
}

pub fn scrub_url(raw: &str) -> Option<UrlRef> {
    let parsed = url::Url::parse(raw).ok()?;
    if parsed.scheme() != "http" && parsed.scheme() != "https" {
        return None;
    }
    let host = parsed.host_str()?.to_string();

    let template: Vec<String> = parsed
        .path_segments()
        .map(|segs| {
            segs.filter(|s| !s.is_empty())
                .map(|seg| {
                    let decoded = percent_decode(seg);
                    if id_patterns().iter().any(|re| re.is_match(&decoded)) {
                        "{id}".to_string()
                    } else {
                        decoded
                    }
                })
                .collect()
        })
        .unwrap_or_default();

    Some(UrlRef {
        host,
        path_template: format!("/{}", template.join("/")),
    })
}

pub fn host_of(raw: &str) -> Option<String> {
    url::Url::parse(raw).ok()?.host_str().map(String::from)
}

fn percent_decode(seg: &str) -> String {
    let mut out = String::with_capacity(seg.len());
    let bytes = seg.as_bytes();
    let mut i = 0;
    while i < bytes.len() {
        if bytes[i] == b'%' && i + 2 < bytes.len() {
            if let Ok(byte) = u8::from_str_radix(&seg[i + 1..i + 3], 16) {
                out.push(byte as char);
                i += 3;
                continue;
            }
        }
        out.push(bytes[i] as char);
        i += 1;
    }
    out
}
