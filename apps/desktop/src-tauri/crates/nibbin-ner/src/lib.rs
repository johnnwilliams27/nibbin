//! Presidio sidecar HTTP client. Isolated in its own crate so the network
//! dependency (`ureq`) is NOT in `nibbin-redaction`'s closure — which keeps
//! `nibbin-capture` provably free of any HTTP/socket crate (C1). Only
//! `observerd` depends on this crate.
//!
//! The endpoint is hardcoded to loopback (`127.0.0.1`): the capture pipeline
//! has no non-loopback network dependency anywhere. The pipeline FAIL-CLOSES
//! on this client — any error returns `NerError::Unavailable`, which halts
//! persistence rather than degrading.

use nibbin_redaction::{NerClient, NerError, NerResult};

pub struct PresidioSidecarClient {
    endpoint: String,
    timeout: std::time::Duration,
}

impl PresidioSidecarClient {
    /// Always loopback — the port is the only tunable. There is deliberately
    /// no constructor that accepts a host.
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
