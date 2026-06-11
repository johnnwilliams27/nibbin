//! The Observer's 4-layer pre-persistence redaction pipeline — Rust twin of
//! `@nibbin/redaction`. Layer semantics, rule data, and fixtures are shared:
//! the rule JSON is embedded from `packages/redaction/rules/` at compile time,
//! and `tests/corpus.rs` runs the same sentinel fixtures the CI-blocking
//! vitest corpus runs. If the two implementations drift, the corpus catches it
//! on both sides.

pub mod battery;
pub mod blocklist;
pub mod capture_norm;
pub mod event;
pub mod ner;
pub mod pipeline;
pub mod url_scrub;

pub use battery::{apply_battery, battery_still_matches, classify_value};
pub use blocklist::{blocked_category_for, UserExclusions};
pub use capture_norm::{snapshot_to_raw_events, AxSnapshot, AxSnapshotNode};
pub use event::{AxObservation, ObserverEvent, RawCaptureEvent, ValueClass};
pub use ner::{HeuristicNer, NerClient, NerError, PresidioSidecarClient};
pub use pipeline::{PersistSink, ProcessOutcome, RedactionPipeline};
