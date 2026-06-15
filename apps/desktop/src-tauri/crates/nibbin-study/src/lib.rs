//! Study lifecycle state machine (SPEC §5) — the PRODUCTION enforcer of C2:
//! the day-14 hard stop fires in the daemon, never the UI. Semantics and the
//! persisted JSON shape are identical to the TS twin
//! (apps/desktop/src/core/study-machine.ts); the corpus pins both.

use chrono::{DateTime, Duration, Utc};
use serde::{Deserialize, Serialize};
use std::path::Path;
use thiserror::Error;

pub const STUDY_DAYS: i64 = 14;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Default)]
#[serde(rename_all = "snake_case")]
pub enum StudyKind {
    #[default]
    FullStudy,
    QuickScan,
}

/// Auto-stop backstop per kind: the full study is the 14-day C2 hard stop; a
/// quick scan is normally user-stopped, with a short safety net so an abandoned
/// scan cannot capture indefinitely.
fn window(kind: StudyKind) -> Duration {
    match kind {
        StudyKind::FullStudy => Duration::days(STUDY_DAYS),
        StudyKind::QuickScan => Duration::hours(6),
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum StudyState {
    NotStarted,
    Consented,
    Active,
    Paused,
    Review,
    Synthesizing,
    RawDeleting,
    Complete,
    Deleted,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum StoppedBy {
    Day14Daemon,
    User,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DeletionReceipt {
    pub verified_at: String,
    pub checked_paths: Vec<String>,
    pub residual_files: Vec<String>,
    pub verified: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StudySnapshot {
    pub v: u8,
    pub study_id: String,
    #[serde(default)]
    pub kind: StudyKind,
    #[serde(default)]
    pub label: Option<String>,
    pub state: StudyState,
    pub consented_at: Option<DateTime<Utc>>,
    pub started_at: Option<DateTime<Utc>>,
    /// Hard stop: started_at + 14 days, wall clock. Daemon-enforced (C2).
    pub ends_at: Option<DateTime<Utc>>,
    pub stopped_by: Option<StoppedBy>,
    pub aborted: bool,
    pub deletion_receipt: Option<DeletionReceipt>,
    /// Highest wall-clock the daemon has ever observed while this study was
    /// running. Persisted every tick. The day-14 stop fires against
    /// `max(now, clock_high_water)`, so winding the OS clock backward cannot
    /// un-expire a study the daemon has already seen reach its deadline (C2).
    #[serde(default)]
    pub clock_high_water: Option<DateTime<Utc>>,
}

#[derive(Debug, Clone)]
pub enum StudyCommand {
    Consent {
        at: DateTime<Utc>,
    },
    Start {
        at: DateTime<Utc>,
    },
    Pause,
    Resume,
    /// Daemon-only: the day-14 hard stop.
    StopDay14,
    StopEarly,
    FinishReview,
    SynthesisComplete,
    DeletionVerified {
        receipt: DeletionReceipt,
    },
    DeleteEverything,
    CreateStudy {
        id: String,
        kind: StudyKind,
        label: Option<String>,
    },
}

#[derive(Debug, Error)]
pub enum StudyError {
    #[error("invalid study transition: {command} from {state:?}")]
    InvalidTransition {
        state: StudyState,
        command: &'static str,
    },
    #[error("deletion_verified requires a verified receipt")]
    UnverifiedReceipt,
}

pub fn new_study(study_id: &str, kind: StudyKind, label: Option<String>) -> StudySnapshot {
    StudySnapshot {
        v: 1,
        study_id: study_id.to_string(),
        kind,
        label,
        state: StudyState::NotStarted,
        consented_at: None,
        started_at: None,
        ends_at: None,
        stopped_by: None,
        aborted: false,
        deletion_receipt: None,
        clock_high_water: None,
    }
}

/// Record the latest wall-clock the daemon has seen. Monotonic by
/// construction: the stored value never decreases, so a backward clock jump
/// is ignored for deadline purposes (C2 anti-rollback). Only meaningful while
/// the study can still be stopped (ACTIVE/PAUSED).
pub fn observe_clock(snap: &StudySnapshot, now: DateTime<Utc>) -> StudySnapshot {
    if !matches!(snap.state, StudyState::Active | StudyState::Paused) {
        return snap.clone();
    }
    let high = match snap.clock_high_water {
        Some(prev) if prev >= now => prev,
        _ => now,
    };
    let mut next = snap.clone();
    next.clock_high_water = Some(high);
    next
}

/// The deadline-relevant "now": never earlier than the high-water mark.
fn effective_now(snap: &StudySnapshot, now: DateTime<Utc>) -> DateTime<Utc> {
    match snap.clock_high_water {
        Some(high) if high > now => high,
        _ => now,
    }
}

fn invalid(state: StudyState, command: &'static str) -> StudyError {
    StudyError::InvalidTransition { state, command }
}

pub fn transition(snap: &StudySnapshot, cmd: StudyCommand) -> Result<StudySnapshot, StudyError> {
    use StudyState::*;
    let mut next = snap.clone();

    match cmd {
        StudyCommand::DeleteEverything => {
            if matches!(snap.state, Complete | Deleted) {
                return Err(invalid(snap.state, "delete_everything"));
            }
            next.state = RawDeleting;
            next.aborted = true;
        }
        StudyCommand::CreateStudy { id, kind, label } => {
            if !matches!(snap.state, NotStarted | Complete | Deleted) {
                return Err(invalid(snap.state, "create_study"));
            }
            return Ok(new_study(&id, kind, label));
        }
        StudyCommand::Consent { at } => {
            if snap.state != NotStarted {
                return Err(invalid(snap.state, "consent"));
            }
            next.state = Consented;
            next.consented_at = Some(at);
        }
        StudyCommand::Start { at } => {
            if snap.state != Consented {
                return Err(invalid(snap.state, "start"));
            }
            next.state = Active;
            next.started_at = Some(at);
            next.ends_at = Some(at + window(snap.kind));
        }
        StudyCommand::Pause => {
            if snap.state != Active {
                return Err(invalid(snap.state, "pause"));
            }
            next.state = Paused;
        }
        StudyCommand::Resume => {
            if snap.state != Paused {
                return Err(invalid(snap.state, "resume"));
            }
            next.state = Active;
        }
        StudyCommand::StopDay14 => {
            if !matches!(snap.state, Active | Paused) {
                return Err(invalid(snap.state, "stop_day14"));
            }
            next.state = Review;
            next.stopped_by = Some(StoppedBy::Day14Daemon);
        }
        StudyCommand::StopEarly => {
            if !matches!(snap.state, Active | Paused) {
                return Err(invalid(snap.state, "stop_early"));
            }
            next.state = Review;
            next.stopped_by = Some(StoppedBy::User);
        }
        StudyCommand::FinishReview => {
            if snap.state != Review {
                return Err(invalid(snap.state, "finish_review"));
            }
            next.state = Synthesizing;
        }
        StudyCommand::SynthesisComplete => {
            if snap.state != Synthesizing {
                return Err(invalid(snap.state, "synthesis_complete"));
            }
            next.state = RawDeleting;
        }
        StudyCommand::DeletionVerified { receipt } => {
            if snap.state != RawDeleting {
                return Err(invalid(snap.state, "deletion_verified"));
            }
            if !receipt.verified {
                return Err(StudyError::UnverifiedReceipt);
            }
            next.state = if snap.aborted { Deleted } else { Complete };
            next.deletion_receipt = Some(receipt);
        }
    }
    Ok(next)
}

/// Capture may run ONLY here. Everything else records nothing.
pub fn capture_allowed(snap: &StudySnapshot) -> bool {
    snap.state == StudyState::Active
}

/// True when the daemon must fire the day-14 stop on its next tick. Uses the
/// monotonic high-water mark, so a rolled-back clock cannot revive the study.
pub fn deadline_passed(snap: &StudySnapshot, now: DateTime<Utc>) -> bool {
    matches!(snap.state, StudyState::Active | StudyState::Paused)
        && snap
            .ends_at
            .is_some_and(|ends| effective_now(snap, now) >= ends)
}

/// Countdown for the always-visible tray display. Never negative; never
/// counts back up if the clock is wound backward.
pub fn remaining_ms(snap: &StudySnapshot, now: DateTime<Utc>) -> i64 {
    match snap.ends_at {
        Some(ends) => (ends - effective_now(snap, now)).num_milliseconds().max(0),
        None => Duration::days(STUDY_DAYS).num_milliseconds(),
    }
}

/// Persisted study state (study.json — same file the TS simulator writes).
pub fn load(dir: &Path) -> Result<Option<StudySnapshot>, anyhow::Error> {
    let path = dir.join("study.json");
    if !path.exists() {
        return Ok(None);
    }
    let text = std::fs::read_to_string(path)?;
    Ok(Some(serde_json::from_str(&text)?))
}

pub fn save(dir: &Path, snap: &StudySnapshot) -> Result<(), anyhow::Error> {
    std::fs::create_dir_all(dir)?;
    std::fs::write(dir.join("study.json"), serde_json::to_string_pretty(snap)?)?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn t(iso: &str) -> DateTime<Utc> {
        iso.parse().unwrap()
    }

    fn started() -> StudySnapshot {
        let s = transition(
            &new_study("s1", StudyKind::FullStudy, None),
            StudyCommand::Consent {
                at: t("2026-06-10T08:00:00Z"),
            },
        )
        .unwrap();
        transition(
            &s,
            StudyCommand::Start {
                at: t("2026-06-10T08:00:00Z"),
            },
        )
        .unwrap()
    }

    fn receipt() -> DeletionReceipt {
        DeletionReceipt {
            verified_at: "2026-06-25T08:00:00Z".into(),
            checked_paths: vec!["/tmp/store".into()],
            residual_files: vec![],
            verified: true,
        }
    }

    #[test]
    fn happy_path_to_complete() {
        let mut s = started();
        assert_eq!(s.state, StudyState::Active);
        assert_eq!(s.ends_at.unwrap(), t("2026-06-24T08:00:00Z"));
        s = transition(&s, StudyCommand::StopDay14).unwrap();
        assert_eq!(s.stopped_by, Some(StoppedBy::Day14Daemon));
        s = transition(&s, StudyCommand::FinishReview).unwrap();
        s = transition(&s, StudyCommand::SynthesisComplete).unwrap();
        s = transition(&s, StudyCommand::DeletionVerified { receipt: receipt() }).unwrap();
        assert_eq!(s.state, StudyState::Complete);
    }

    #[test]
    fn day14_fires_from_paused_and_not_before() {
        let s = started();
        assert!(!deadline_passed(&s, t("2026-06-24T07:59:59Z")));
        assert!(deadline_passed(&s, t("2026-06-24T08:00:00Z")));
        let paused = transition(&s, StudyCommand::Pause).unwrap();
        assert!(deadline_passed(&paused, t("2026-06-25T08:00:00Z")));
        assert!(!capture_allowed(&paused));
    }

    #[test]
    fn clock_rollback_cannot_revive_an_expired_study() {
        // the daemon observes a time past the deadline...
        let s = observe_clock(&started(), t("2026-06-25T08:00:00Z"));
        assert_eq!(s.clock_high_water, Some(t("2026-06-25T08:00:00Z")));
        // ...then the OS clock is wound back before the deadline.
        assert!(
            deadline_passed(&s, t("2026-06-11T08:00:00Z")),
            "high-water mark must keep the study expired after a rollback"
        );
        assert_eq!(remaining_ms(&s, t("2026-06-11T08:00:00Z")), 0);
        // observing an earlier time never lowers the high-water mark
        let rolled = observe_clock(&s, t("2026-06-11T08:00:00Z"));
        assert_eq!(rolled.clock_high_water, Some(t("2026-06-25T08:00:00Z")));
    }

    #[test]
    fn delete_everything_from_any_nonterminal_state_ends_deleted() {
        for snap in [
            new_study("s1", StudyKind::FullStudy, None),
            started(),
            transition(&started(), StudyCommand::StopDay14).unwrap(),
        ] {
            let deleting = transition(&snap, StudyCommand::DeleteEverything).unwrap();
            assert_eq!(deleting.state, StudyState::RawDeleting);
            let done = transition(
                &deleting,
                StudyCommand::DeletionVerified { receipt: receipt() },
            )
            .unwrap();
            assert_eq!(done.state, StudyState::Deleted);
        }
        let complete = {
            let mut s = transition(&started(), StudyCommand::StopDay14).unwrap();
            s = transition(&s, StudyCommand::FinishReview).unwrap();
            s = transition(&s, StudyCommand::SynthesisComplete).unwrap();
            transition(&s, StudyCommand::DeletionVerified { receipt: receipt() }).unwrap()
        };
        assert!(transition(&complete, StudyCommand::DeleteEverything).is_err());
    }

    #[test]
    fn unverified_receipt_is_rejected() {
        let deleting = transition(&started(), StudyCommand::DeleteEverything).unwrap();
        let bad = DeletionReceipt {
            verified: false,
            ..receipt()
        };
        assert!(matches!(
            transition(&deleting, StudyCommand::DeletionVerified { receipt: bad }),
            Err(StudyError::UnverifiedReceipt)
        ));
    }

    #[test]
    fn quick_scan_window_is_six_hours_full_is_fourteen_days() {
        let q = transition(
            &new_study("q", StudyKind::QuickScan, Some("Invoices".into())),
            StudyCommand::Consent {
                at: t("2026-06-10T08:00:00Z"),
            },
        )
        .unwrap();
        let q = transition(
            &q,
            StudyCommand::Start {
                at: t("2026-06-10T08:00:00Z"),
            },
        )
        .unwrap();
        assert_eq!(q.ends_at.unwrap(), t("2026-06-10T14:00:00Z")); // +6h
        assert_eq!(q.label.as_deref(), Some("Invoices"));
        // full study still +14 days
        assert_eq!(started().ends_at.unwrap(), t("2026-06-24T08:00:00Z"));
    }

    #[test]
    fn create_study_only_from_terminal_or_not_started() {
        let complete = {
            let mut s = transition(&started(), StudyCommand::StopDay14).unwrap();
            s = transition(&s, StudyCommand::FinishReview).unwrap();
            s = transition(&s, StudyCommand::SynthesisComplete).unwrap();
            transition(&s, StudyCommand::DeletionVerified { receipt: receipt() }).unwrap()
        };
        let fresh = transition(
            &complete,
            StudyCommand::CreateStudy {
                id: "q2".into(),
                kind: StudyKind::QuickScan,
                label: None,
            },
        )
        .unwrap();
        assert_eq!(fresh.state, StudyState::NotStarted);
        assert_eq!(fresh.study_id, "q2");
        assert_eq!(fresh.kind, StudyKind::QuickScan);
        // not allowed mid-capture
        assert!(transition(
            &started(),
            StudyCommand::CreateStudy {
                id: "x".into(),
                kind: StudyKind::FullStudy,
                label: None,
            },
        )
        .is_err());
    }

    #[test]
    fn json_shape_matches_the_ts_twin() {
        let s = started();
        let json = serde_json::to_value(&s).unwrap();
        assert_eq!(json["state"], "ACTIVE");
        assert_eq!(json["studyId"], "s1");
        assert_eq!(json["kind"], "full_study");
        assert!(json["endsAt"].is_string());
        assert_eq!(json["aborted"], false);
        // round-trips a TS-simulator-written snapshot
        let ts_written = r#"{
            "v": 1, "studyId": "study_sim", "state": "PAUSED",
            "consentedAt": "2026-06-10T08:00:00.000Z",
            "startedAt": "2026-06-10T08:00:00.000Z",
            "endsAt": "2026-06-24T08:00:00.000Z",
            "stoppedBy": null, "aborted": false, "deletionReceipt": null,
            "clockHighWater": "2026-06-12T09:00:00.000Z"
        }"#;
        let parsed: StudySnapshot = serde_json::from_str(ts_written).unwrap();
        assert_eq!(parsed.state, StudyState::Paused);
        assert!(parsed.clock_high_water.is_some());
        // a snapshot written by an older daemon (no high-water field) still loads
        let legacy = r#"{
            "v": 1, "studyId": "s", "state": "ACTIVE",
            "consentedAt": null, "startedAt": null, "endsAt": null,
            "stoppedBy": null, "aborted": false, "deletionReceipt": null
        }"#;
        let legacy_parsed: StudySnapshot = serde_json::from_str(legacy).unwrap();
        assert_eq!(legacy_parsed.kind, StudyKind::FullStudy);
        assert_eq!(legacy_parsed.label, None);
    }
}
