//! Layer 3b — NER. Production NER is the supervised Presidio sidecar; the
//! pipeline FAIL-CLOSES on it: any sidecar failure halts persistence rather
//! than degrading to regex-only output (GOTCHAS "Redaction fail-closed").

use regex::Regex;
use std::sync::OnceLock;
use thiserror::Error;

#[derive(Debug, Error)]
pub enum NerError {
    #[error("NER sidecar unavailable: {0}")]
    Unavailable(String),
}

pub struct NerResult {
    pub redacted: String,
    pub rules_hit: Vec<String>,
}

pub trait NerClient: Send + Sync {
    /// Redact entities. MUST return Err(Unavailable) when the engine is down.
    fn redact(&self, text: &str) -> Result<NerResult, NerError>;
}

/// HTTP client for the supervised Presidio sidecar (loopback only — the
/// capture pipeline has no non-loopback network dependency, C1).
pub struct PresidioSidecarClient {
    endpoint: String,
    timeout: std::time::Duration,
}

impl PresidioSidecarClient {
    pub fn new(port: u16) -> Self {
        Self {
            endpoint: format!("http://127.0.0.1:{port}/redact"),
            timeout: std::time::Duration::from_millis(1500),
        }
    }
}

impl NerClient for PresidioSidecarClient {
    fn redact(&self, text: &str) -> Result<NerResult, NerError> {
        let response = ureq::post(&self.endpoint)
            .timeout(self.timeout)
            .send_json(serde_json::json!({ "text": text }))
            .map_err(|e| NerError::Unavailable(e.to_string()))?;
        let body: serde_json::Value = response
            .into_json()
            .map_err(|e| NerError::Unavailable(format!("bad sidecar response: {e}")))?;
        let redacted = body
            .get("redacted")
            .and_then(|v| v.as_str())
            .ok_or_else(|| NerError::Unavailable("sidecar response missing 'redacted'".into()))?
            .to_string();
        let rules_hit = body
            .get("rules_hit")
            .and_then(|v| v.as_array())
            .map(|a| {
                a.iter()
                    .filter_map(|v| v.as_str().map(String::from))
                    .collect()
            })
            .unwrap_or_default();
        Ok(NerResult {
            redacted,
            rules_hit,
        })
    }
}

const STOPWORDS: &[&str] = &[
    "invoice", "account", "send", "sign", "save", "open", "close", "new", "edit", "view", "file",
    "home", "inbox", "sent", "draft", "drafts", "settings", "help", "search", "untitled",
    "document", "page", "window", "tab", "the", "a", "an", "ship", "bill", "pay", "from", "to",
    "for", "with", "and", "or", "of", "in", "notes", "phone", "card", "api", "key", "username",
    "password", "email",
];

fn name_token_re() -> &'static Regex {
    static RE: OnceLock<Regex> = OnceLock::new();
    // identical to @nibbin/redaction's NAME_TOKEN
    RE.get_or_init(|| Regex::new(r"^[A-Z][a-z]+(?:[-'][A-Za-z0-9]+)*$").expect("static regex"))
}

fn is_candidate(token: &str) -> bool {
    name_token_re().is_match(token) && !STOPWORDS.contains(&token.to_lowercase().as_str())
}

/// Split into alternating non-space/space segments, preserving whitespace —
/// the Rust twin of the TS `text.split(/(\s+)/)`.
fn segments(text: &str) -> Vec<String> {
    let mut out: Vec<String> = Vec::new();
    let mut buf = String::new();
    let mut in_ws: Option<bool> = None;
    for c in text.chars() {
        let ws = c.is_whitespace();
        if in_ws != Some(ws) && !buf.is_empty() {
            out.push(std::mem::take(&mut buf));
        }
        in_ws = Some(ws);
        buf.push(c);
    }
    if !buf.is_empty() {
        out.push(buf);
    }
    out
}

/// Deterministic person-name detector — the corpus/test NER engine, identical
/// in behavior to the TS HeuristicNer. NOT a sidecar substitute: availability
/// is governed by fail-closed, never by falling back to heuristics.
pub struct HeuristicNer;

impl NerClient for HeuristicNer {
    fn redact(&self, text: &str) -> Result<NerResult, NerError> {
        let segs = segments(text);
        let mut out = String::new();
        let mut hit = false;
        let mut i = 0;
        while i < segs.len() {
            if is_candidate(&segs[i]) {
                let mut j = i;
                let mut run = 1;
                while j + 2 < segs.len()
                    && segs[j + 1].chars().all(char::is_whitespace)
                    && is_candidate(&segs[j + 2])
                {
                    j += 2;
                    run += 1;
                }
                if run >= 2 {
                    out.push_str("{PERSON}");
                    hit = true;
                    i = j + 1;
                    continue;
                }
            }
            out.push_str(&segs[i]);
            i += 1;
        }
        Ok(NerResult {
            redacted: out,
            rules_hit: if hit {
                vec!["PERSON".to_string()]
            } else {
                vec![]
            },
        })
    }
}

/// Test double for a dead sidecar.
pub struct DownNer;

impl NerClient for DownNer {
    fn redact(&self, _text: &str) -> Result<NerResult, NerError> {
        Err(NerError::Unavailable("down (test double)".into()))
    }
}

impl NerClient for Box<dyn NerClient> {
    fn redact(&self, text: &str) -> Result<NerResult, NerError> {
        (**self).redact(text)
    }
}
