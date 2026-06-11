//! The 4-layer pre-persistence pipeline — Rust twin of @nibbin/redaction's
//! pipeline.ts. Nothing reaches the sink except a fully-redacted
//! ObserverEvent; there is no code path that persists a RawCaptureEvent
//! (RawCaptureEvent does not even implement Serialize).

use crate::battery::{apply_battery, classify_value};
use crate::blocklist::{blocked_category_for, UserExclusions};
use crate::event::{
    AppRef, AxObservation, AxRef, ObserverEvent, RawCaptureEvent, RedactionMeta, ReviewState,
    ValueClass, WindowRef,
};
use crate::ner::{NerClient, NerError};
use crate::url_scrub::{host_of, scrub_url};

#[derive(Debug, PartialEq, Eq)]
pub enum ProcessOutcome {
    Persisted,
    BlockedCategory(String),
    HaltedNerUnavailable,
}

pub trait PersistSink {
    fn append(&mut self, event: &ObserverEvent) -> Result<(), anyhow::Error>;
}

pub struct RedactionPipeline<N: NerClient> {
    ner: N,
    exclusions: UserExclusions,
    halted_reason: Option<String>,
}

impl<N: NerClient> RedactionPipeline<N> {
    pub fn new(ner: N) -> Self {
        Self {
            ner,
            exclusions: UserExclusions::default(),
            halted_reason: None,
        }
    }

    pub fn halted(&self) -> bool {
        self.halted_reason.is_some()
    }

    /// Layer-4 exclusions feed back into layer 2 for the rest of the study.
    pub fn add_exclusions(&mut self, more: UserExclusions) {
        self.exclusions.hosts.extend(more.hosts);
        self.exclusions.bundle_ids.extend(more.bundle_ids);
        self.exclusions.app_names.extend(more.app_names);
    }

    /// Re-arm after the sidecar supervisor reports healthy again.
    pub fn resume(&mut self) {
        self.halted_reason = None;
    }

    pub fn process(
        &mut self,
        raw: &RawCaptureEvent,
        sink: &mut dyn PersistSink,
    ) -> Result<ProcessOutcome, anyhow::Error> {
        // Fail-closed: once halted, nothing persists until resumed.
        if self.halted_reason.is_some() {
            return Ok(ProcessOutcome::HaltedNerUnavailable);
        }

        // Layer 2 — category blocklist (C5), before any redaction work.
        let url_host = raw.url.as_deref().and_then(host_of);
        if let Some(category) = blocked_category_for(
            &raw.window_title,
            raw.window_category.as_deref(),
            &raw.app_bundle_id,
            &raw.app_name,
            url_host.as_deref(),
            &self.exclusions,
        ) {
            return Ok(ProcessOutcome::BlockedCategory(category));
        }

        // Layer 3 — battery first (always), then NER (fail-closed).
        let title_pass = apply_battery(&raw.window_title);
        let label_pass = match &raw.ax {
            Some(AxObservation::Plain { label, .. }) => Some(apply_battery(label)),
            _ => None,
        };

        let mut rules_hit: Vec<String> = title_pass.rules_hit.clone();
        if let Some(lp) = &label_pass {
            rules_hit.extend(lp.rules_hit.clone());
        }

        let (title_redacted, label_redacted) = {
            let title_ner = match self.ner.redact(&title_pass.text) {
                Ok(r) => r,
                Err(NerError::Unavailable(reason)) => {
                    self.halted_reason = Some(reason);
                    return Ok(ProcessOutcome::HaltedNerUnavailable);
                }
            };
            rules_hit.extend(title_ner.rules_hit);

            let label_redacted = match &label_pass {
                Some(lp) => match self.ner.redact(&lp.text) {
                    Ok(r) => {
                        rules_hit.extend(r.rules_hit);
                        Some(r.redacted)
                    }
                    Err(NerError::Unavailable(reason)) => {
                        self.halted_reason = Some(reason);
                        return Ok(ProcessOutcome::HaltedNerUnavailable);
                    }
                },
                None => None,
            };
            (title_ner.redacted, label_redacted)
        };

        rules_hit.sort();
        rules_hit.dedup();

        // Values are classified, then discarded — the schema has no value field.
        let ax = raw.ax.as_ref().map(|obs| match obs {
            AxObservation::Plain {
                role_path,
                action,
                value,
                ..
            } => AxRef {
                role_path: role_path.clone(),
                action: *action,
                label_redacted: label_redacted.clone().unwrap_or_default(),
                value_class: classify_value(value.as_deref()),
            },
            AxObservation::SecureSuppressed { role_path, action } => AxRef {
                role_path: role_path.clone(),
                action: *action,
                // C4: a suppressed field contributes a constant, never its label.
                label_redacted: "{SECURE}".to_string(),
                value_class: ValueClass::None,
            },
        });

        let secure = matches!(raw.ax, Some(AxObservation::SecureSuppressed { .. }));

        let event = ObserverEvent {
            v: 1,
            id: raw.id.clone(),
            ts: raw.ts.clone(),
            session: raw.session.clone(),
            kind: raw.kind,
            app: AppRef {
                bundle_id: raw.app_bundle_id.clone(),
                name: raw.app_name.clone(),
            },
            window: WindowRef {
                title_redacted,
                id: raw.window_id.clone(),
            },
            url: raw.url.as_deref().and_then(scrub_url),
            ax,
            input: raw.input.clone(),
            frame_ref: if secure { None } else { raw.frame_ref.clone() },
            redaction: RedactionMeta {
                rules_hit,
                review_state: ReviewState::Auto,
            },
        };

        sink.append(&event)?;
        Ok(ProcessOutcome::Persisted)
    }
}
