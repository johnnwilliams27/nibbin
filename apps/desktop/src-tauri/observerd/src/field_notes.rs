//! Field notes v1 — derived, local, privacy-safe summary of the day's activity.
//!
//! PRIVACY CONTRACT (strictly enforced):
//!   - Input: already-redacted `ObserverEvent`s from the SQLCipher store ONLY.
//!     Raw events do not exist post-pipeline; this module never touches raw data.
//!   - Derived: we aggregate COUNTS and DURATIONS, never raw text. The `content`
//!     string in each note is built from app names (already in `AppRef`), event
//!     counts, and approximate durations — nothing from window titles or AX labels.
//!   - Local only: `field_notes.json` is written to the store root on-device.
//!     No network path exists in this crate (C1); `generate_and_save` does
//!     no network I/O and has no dep on any NER or LLM client.
//!   - No raw content: `ObserverEvent.window.title_redacted` is intentionally NOT
//!     used to build note content. Only `app.name`, `kind`, `ts`, and counts from
//!     `input` are consulted.
//!
//! Output: up to `MAX_NOTES` notes sorted by total event count descending,
//! serialised as `field_notes.json` (atomically, write-then-rename).
//! Each note matches the web `FieldNote` type: `{ id, ts, content }`.

use anyhow::Context;
use nibbin_redaction::event::{EventKind, ObserverEvent};
use std::collections::HashMap;
use std::path::Path;

const FILE: &str = "field_notes.json";
/// Cap on number of notes emitted. Keeps the file small and the UI tidy.
const MAX_NOTES: usize = 8;
/// Minimum events an app group needs to appear as a note (noise filter).
const MIN_EVENTS: u32 = 2;

#[derive(Debug, serde::Serialize, serde::Deserialize, PartialEq)]
pub struct FieldNote {
    pub id: String,
    pub ts: String,
    pub content: String,
}

/// Per-app aggregation bucket (derived from redacted events only).
#[derive(Debug, Default)]
struct AppBucket {
    /// Total events observed in this app.
    event_count: u32,
    /// Distinct window ids seen (proxy for window / context switches).
    window_ids: std::collections::HashSet<String>,
    /// Nav events (URL navigations or focus changes between sessions).
    nav_count: u32,
    /// FileDialog events (file open/save interactions).
    file_dialog_count: u32,
    /// Summed key counts from InputBurst events (not keystrokes — counts only,
    /// as persisted by the pipeline per spec §3/InputRef).
    key_count: u32,
    /// Summed click counts from InputBurst events.
    click_count: u32,
    /// Approximate active duration in seconds, derived from InputBurst
    /// `duration_ms` fields. These cover only the measured active intervals;
    /// gaps are not included (they are CaptureGap events, skipped here).
    active_duration_secs: u64,
    /// Earliest timestamp seen, used as the note `ts`.
    earliest_ts: Option<String>,
}

impl AppBucket {
    fn ingest(&mut self, event: &ObserverEvent) {
        // Skip internal Observer events (gaps, input-burst from the daemon itself).
        if event.app.bundle_id == "app.nibbin.observer" {
            return;
        }
        // Skip CaptureGap — these are bookkeeping events, not user activity.
        if event.kind == EventKind::CaptureGap {
            return;
        }
        self.event_count += 1;
        self.window_ids.insert(event.window.id.clone());
        match event.kind {
            EventKind::Nav => self.nav_count += 1,
            EventKind::FileDialog => self.file_dialog_count += 1,
            EventKind::InputBurst => {
                if let Some(input) = &event.input {
                    self.key_count += input.keys;
                    self.click_count += input.clicks;
                    self.active_duration_secs += input.duration_ms / 1000;
                }
            }
            _ => {}
        }
        if self.earliest_ts.is_none()
            || event.ts < *self.earliest_ts.as_ref().unwrap_or(&String::new())
        {
            self.earliest_ts = Some(event.ts.clone());
        }
    }

    /// Format a human-readable content string. Uses only derived counts and
    /// app names — no raw window titles or AX labels (privacy invariant).
    fn format_content(&self, app_name: &str) -> String {
        let mut parts: Vec<String> = Vec::new();

        // Approximate active time from input bursts (may be 0 if no input events).
        if self.active_duration_secs >= 60 {
            let mins = self.active_duration_secs / 60;
            parts.push(format!("~{mins}m active"));
        } else if self.active_duration_secs > 0 {
            parts.push(format!("~{}s active", self.active_duration_secs));
        }

        // Window/context count.
        let w = self.window_ids.len();
        if w > 1 {
            parts.push(format!("{w} windows"));
        }

        // Navigation count (useful for browsers/web apps).
        if self.nav_count > 0 {
            parts.push(format!(
                "{} navigation{}",
                self.nav_count,
                if self.nav_count == 1 { "" } else { "s" }
            ));
        }

        // File dialog (documents touched).
        if self.file_dialog_count > 0 {
            parts.push(format!(
                "{} file {}",
                self.file_dialog_count,
                if self.file_dialog_count == 1 {
                    "dialog"
                } else {
                    "dialogs"
                }
            ));
        }

        // Input activity summary (counts only — not keystroke contents).
        if self.key_count > 0 || self.click_count > 0 {
            let mut activity = Vec::new();
            if self.key_count > 0 {
                activity.push(format!("{} key interactions", self.key_count));
            }
            if self.click_count > 0 {
                activity.push(format!("{} clicks", self.click_count));
            }
            parts.push(activity.join(", "));
        }

        if parts.is_empty() {
            // Minimal note: just the event count.
            format!("{app_name} — {} events", self.event_count)
        } else {
            format!("{app_name} — {}", parts.join("; "))
        }
    }
}

/// Derive field notes from `events` and write `field_notes.json` atomically.
///
/// `now_iso` is used as the `ts` fallback for notes whose bucket has no
/// events with timestamps (degenerate but safe).
///
/// Privacy: reads only `app.name`, `app.bundle_id`, `kind`, `ts`, `window.id`,
/// and `input` (counts/duration). Window titles, AX labels, URL paths, and
/// redaction metadata are deliberately NOT read.
pub fn generate_and_save(
    root: &Path,
    events: &[ObserverEvent],
    now_iso: &str,
) -> anyhow::Result<()> {
    // Aggregate by app name (display name, not bundle id, so the note reads naturally).
    let mut buckets: HashMap<String, AppBucket> = HashMap::new();
    for event in events {
        buckets
            .entry(event.app.name.clone())
            .or_default()
            .ingest(event);
    }

    // Sort by total event count descending, take top MAX_NOTES, filter noise.
    let mut ranked: Vec<(String, AppBucket)> = buckets
        .into_iter()
        .filter(|(_, b)| b.event_count >= MIN_EVENTS)
        .collect();
    ranked.sort_by(|a, b| b.1.event_count.cmp(&a.1.event_count));
    ranked.truncate(MAX_NOTES);

    let notes: Vec<FieldNote> = ranked
        .into_iter()
        .enumerate()
        .map(|(i, (app_name, bucket))| {
            let ts = bucket
                .earliest_ts
                .clone()
                .unwrap_or_else(|| now_iso.to_string());
            let content = bucket.format_content(&app_name);
            FieldNote {
                id: format!(
                    "fn_{i}_{}",
                    ts.replace([':', '-', '+'], "")
                        .replace('T', "_")
                        .chars()
                        .take(15)
                        .collect::<String>()
                ),
                ts,
                content,
            }
        })
        .collect();

    let json = serde_json::to_string(&notes).context("serialising field notes")?;
    let tmp = root.join("field_notes.json.tmp");
    std::fs::write(&tmp, &json).context("writing field_notes.json.tmp")?;
    std::fs::rename(&tmp, root.join(FILE)).context("renaming field_notes.json.tmp")?;
    Ok(())
}

/// Load field notes. Missing file → empty list. Corrupt file → Err.
pub fn load(root: &Path) -> anyhow::Result<Vec<FieldNote>> {
    let path = root.join(FILE);
    match std::fs::read_to_string(&path) {
        Ok(text) => {
            serde_json::from_str(&text).with_context(|| format!("{} is corrupt", path.display()))
        }
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(vec![]),
        Err(e) => Err(e).with_context(|| format!("reading {}", path.display())),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use nibbin_redaction::event::{
        AppRef, EventKind, InputRef, RedactionMeta, ReviewState, WindowRef,
    };

    fn make_event(
        id: &str,
        app_name: &str,
        bundle_id: &str,
        kind: EventKind,
        ts: &str,
    ) -> ObserverEvent {
        ObserverEvent {
            v: 1,
            id: id.to_string(),
            ts: ts.to_string(),
            session: "ses_test".to_string(),
            kind,
            app: AppRef {
                bundle_id: bundle_id.to_string(),
                name: app_name.to_string(),
            },
            window: WindowRef {
                title_redacted: "[redacted]".to_string(),
                id: format!("w_{id}"),
            },
            url: None,
            ax: None,
            input: None,
            frame_ref: None,
            redaction: RedactionMeta {
                rules_hit: vec![],
                review_state: ReviewState::Auto,
            },
        }
    }

    fn make_input_event(
        id: &str,
        app_name: &str,
        keys: u32,
        clicks: u32,
        duration_ms: u64,
        ts: &str,
    ) -> ObserverEvent {
        ObserverEvent {
            v: 1,
            id: id.to_string(),
            ts: ts.to_string(),
            session: "ses_test".to_string(),
            kind: EventKind::InputBurst,
            app: AppRef {
                bundle_id: "com.test.app".to_string(),
                name: app_name.to_string(),
            },
            window: WindowRef {
                title_redacted: "[redacted]".to_string(),
                id: "w_input".to_string(),
            },
            url: None,
            ax: None,
            input: Some(InputRef {
                keys,
                clicks,
                duration_ms,
            }),
            frame_ref: None,
            redaction: RedactionMeta {
                rules_hit: vec![],
                review_state: ReviewState::Auto,
            },
        }
    }

    #[test]
    fn groups_events_by_app_and_summarises() {
        let events = vec![
            make_event(
                "e1",
                "Gmail",
                "com.google.gmail",
                EventKind::Focus,
                "2026-06-20T09:00:00Z",
            ),
            make_event(
                "e2",
                "Gmail",
                "com.google.gmail",
                EventKind::Nav,
                "2026-06-20T09:01:00Z",
            ),
            make_event(
                "e3",
                "Gmail",
                "com.google.gmail",
                EventKind::Nav,
                "2026-06-20T09:02:00Z",
            ),
            make_event(
                "e4",
                "Slack",
                "com.tinyspeck.slackmacgap",
                EventKind::Focus,
                "2026-06-20T09:05:00Z",
            ),
            make_event(
                "e5",
                "Slack",
                "com.tinyspeck.slackmacgap",
                EventKind::Focus,
                "2026-06-20T09:06:00Z",
            ),
        ];

        let dir = tempfile::tempdir().unwrap();
        generate_and_save(dir.path(), &events, "2026-06-20T10:00:00Z").unwrap();

        let notes = load(dir.path()).unwrap();
        // Both apps should appear (each has >= MIN_EVENTS).
        assert_eq!(notes.len(), 2, "expected 2 notes, got: {notes:?}");

        // Gmail has 3 events (highest) → first note.
        assert!(
            notes[0].content.contains("Gmail"),
            "first note should be Gmail: {:?}",
            notes[0]
        );
        assert!(
            notes[1].content.contains("Slack"),
            "second note should be Slack: {:?}",
            notes[1]
        );

        // Gmail note must mention navigations.
        assert!(
            notes[0].content.contains("navigation"),
            "Gmail note should mention navigations: {}",
            notes[0].content
        );

        // Privacy: no raw title in content.
        for note in &notes {
            assert!(
                !note.content.contains("[redacted]"),
                "note content must not contain raw window title text: {}",
                note.content
            );
        }
    }

    #[test]
    fn derives_duration_and_input_counts_only() {
        // InputBurst events carry counts + duration, no keystrokes.
        let events = vec![
            make_input_event("i1", "TextEdit", 42, 5, 120_000, "2026-06-20T10:00:00Z"),
            make_input_event("i2", "TextEdit", 18, 3, 60_000, "2026-06-20T10:02:00Z"),
        ];

        let dir = tempfile::tempdir().unwrap();
        generate_and_save(dir.path(), &events, "2026-06-20T10:05:00Z").unwrap();

        let notes = load(dir.path()).unwrap();
        assert_eq!(notes.len(), 1);
        let content = &notes[0].content;
        // Duration: 120 + 60 = 180s → 3 min.
        assert!(
            content.contains("3m"),
            "should mention active duration: {content}"
        );
        // Key count: 60 total.
        assert!(
            content.contains("60"),
            "should mention key count: {content}"
        );
        // Must NOT contain any raw title or keystrokes.
        assert!(
            !content.contains("key_1"),
            "must not contain raw keystroke data: {content}"
        );
    }

    #[test]
    fn noise_filter_excludes_low_event_apps() {
        // An app with only 1 event should not appear (MIN_EVENTS = 2).
        let events = vec![
            make_event(
                "e1",
                "Lonely App",
                "com.lonely",
                EventKind::Focus,
                "2026-06-20T09:00:00Z",
            ),
            make_event(
                "e2",
                "Active App",
                "com.active",
                EventKind::Focus,
                "2026-06-20T09:01:00Z",
            ),
            make_event(
                "e3",
                "Active App",
                "com.active",
                EventKind::Nav,
                "2026-06-20T09:02:00Z",
            ),
        ];

        let dir = tempfile::tempdir().unwrap();
        generate_and_save(dir.path(), &events, "2026-06-20T10:00:00Z").unwrap();

        let notes = load(dir.path()).unwrap();
        assert_eq!(notes.len(), 1, "only Active App should appear");
        assert!(notes[0].content.contains("Active App"));
    }

    #[test]
    fn remove_exclusion_roundtrip_subtract() {
        // Unit test for the subtract logic: add two exclusions, remove one,
        // verify the remaining set is correct and the removed one is gone.
        // This tests the logic that the RemoveExclusion handler uses
        // (load → subtract → save → verify).
        use nibbin_redaction::UserExclusions;

        let dir = tempfile::tempdir().unwrap();
        let root = dir.path();

        // Start with two hosts.
        let initial = UserExclusions {
            hosts: vec!["a.com".into(), "b.com".into()],
            bundle_ids: vec![],
            app_names: vec![],
        };
        crate::exclusions::save_exclusions(root, &initial).unwrap();

        // Simulate RemoveExclusion for "a.com": load → subtract → save.
        let mut current = crate::exclusions::load_exclusions(root).unwrap();
        current.hosts.retain(|x| x != "a.com");
        crate::exclusions::save_exclusions(root, &current).unwrap();

        // Verify: only "b.com" remains.
        let after = crate::exclusions::load_exclusions(root).unwrap();
        assert_eq!(
            after.hosts,
            vec!["b.com".to_string()],
            "a.com must be removed"
        );
        assert!(
            !after.hosts.contains(&"a.com".to_string()),
            "a.com must not be present"
        );
    }

    #[test]
    fn missing_file_returns_empty_notes() {
        let dir = tempfile::tempdir().unwrap();
        let notes = load(dir.path()).unwrap();
        assert!(notes.is_empty());
    }

    #[test]
    fn observer_internal_events_are_excluded_from_notes() {
        // CaptureGap events from the Observer daemon itself must not appear as notes.
        let gap = ObserverEvent {
            v: 1,
            id: "gap1".into(),
            ts: "2026-06-20T09:00:00Z".into(),
            session: "ses_gap".into(),
            kind: EventKind::CaptureGap,
            app: AppRef {
                bundle_id: "app.nibbin.observer".into(),
                name: "Observer".into(),
            },
            window: WindowRef {
                title_redacted: String::new(),
                id: "w_gap".into(),
            },
            url: None,
            ax: None,
            input: Some(InputRef {
                keys: 0,
                clicks: 0,
                duration_ms: 5000,
            }),
            frame_ref: None,
            redaction: RedactionMeta {
                rules_hit: vec![],
                review_state: ReviewState::Auto,
            },
        };
        let dir = tempfile::tempdir().unwrap();
        // Only gap event → should produce no notes (filtered out).
        generate_and_save(dir.path(), &[gap], "2026-06-20T10:00:00Z").unwrap();
        let notes = load(dir.path()).unwrap();
        assert!(
            notes.is_empty(),
            "internal Observer events must not appear in field notes"
        );
    }
}
