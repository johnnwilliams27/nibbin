//! observerd — the Observer capture daemon.
//!
//! Process model: observerd runs as a LaunchAgent (macOS) / service
//! (Windows), fully independent of the Tauri app. The UI is a CLIENT: it
//! reads `study.json` + `daemon.status` and writes single-line JSON commands
//! to `control.jsonl` in the store directory. The day-14 stop (C2), the
//! fail-closed pipeline, and verified deletion (C3) all execute here — kill
//! the UI and every privacy invariant still holds. There is deliberately no
//! network listener in this process (C1: capture has no network dependency;
//! the only network egress anywhere in the desktop product is the
//! user-initiated packet upload in the app, C7).

use anyhow::Context;
use chrono::{DateTime, Utc};
use nibbin_capture::{CaptureGate, CaptureSource};
use nibbin_ner::PresidioSidecarClient;
use nibbin_redaction::event::{
    AppRef, EventKind, InputRef, ObserverEvent, RedactionMeta, ReviewState, WindowRef,
};
use nibbin_redaction::ner::{DownNer, HeuristicNer};
use nibbin_redaction::{
    snapshot_to_raw_events, NerClient, PersistSink, ProcessOutcome, RedactionPipeline,
};
use nibbin_store::{KeyProvider, ObserverStore, StaticTestKey};
use nibbin_study::{
    capture_allowed, deadline_passed, new_study, transition, StudyCommand, StudyKind, StudySnapshot,
};
use serde::Deserialize;
use std::path::{Path, PathBuf};

mod exclusions;

/// Daemon clock. Tests pin it via NIBBIN_FAKE_NOW (ISO-8601); production is
/// wall clock. The fake is read once per call so long-running tests can move
/// time by rewriting the env of a child they relaunch.
pub fn daemon_now() -> DateTime<Utc> {
    // The fake-clock hook is compiled in only for debug/test builds. A
    // release daemon ALWAYS uses the real wall clock, so the day-14 stop
    // can never be defeated by setting NIBBIN_FAKE_NOW on the process
    // (anti-rollback also covers genuine OS clock manipulation — see
    // nibbin_study::observe_clock).
    #[cfg(debug_assertions)]
    if let Ok(iso) = std::env::var("NIBBIN_FAKE_NOW") {
        return iso
            .parse()
            .unwrap_or_else(|e| panic!("NIBBIN_FAKE_NOW must be ISO-8601: {e}"));
    }
    Utc::now()
}

/// NER engine selection. Production default is the supervised Presidio
/// sidecar; `heuristic`/`down` exist for tests and the corpus only.
pub fn ner_from_env() -> Box<dyn NerClient> {
    match std::env::var("NIBBIN_NER").as_deref() {
        Ok("heuristic") => Box::new(HeuristicNer),
        Ok("down") => Box::new(DownNer),
        Ok(spec) if spec.starts_with("presidio:") => {
            let port = spec["presidio:".len()..].parse().expect("presidio port");
            Box::new(PresidioSidecarClient::new(port))
        }
        _ => Box::new(PresidioSidecarClient::new(7811)),
    }
}

fn key_provider() -> Box<dyn KeyProvider> {
    // Explicit test key — debug builds only, and length-validated so a short
    // value is a clean error, not an index-out-of-bounds panic (P3-1).
    #[cfg(debug_assertions)]
    if let Ok(hex) = std::env::var("NIBBIN_TEST_KEY_HEX") {
        assert_eq!(hex.len(), 64, "NIBBIN_TEST_KEY_HEX must be 32 bytes hex");
        let mut key = [0u8; 32];
        for (i, byte) in key.iter_mut().enumerate() {
            *byte = u8::from_str_radix(&hex[i * 2..i * 2 + 2], 16).expect("test key hex");
        }
        return Box::new(StaticTestKey(key));
    }
    #[cfg(feature = "os-keystore")]
    {
        return Box::new(nibbin_store::OsKeystoreKey::observer_default());
    }
    #[allow(unreachable_code)]
    {
        panic!("no key source: build with --features os-keystore or set NIBBIN_TEST_KEY_HEX")
    }
}

#[derive(Debug, Deserialize)]
#[serde(tag = "cmd", rename_all = "snake_case")]
pub enum ControlCommand {
    Consent,
    Start,
    Pause,
    Resume,
    StopEarly,
    FinishReview,
    SynthesisComplete,
    DeleteEverything,
    /// Ad-hoc quick scan / fresh study: mint a new study (unique id + kind +
    /// optional label) from a terminal/not-started state, then clear the store
    /// so the fresh study starts empty.
    CreateStudy {
        study_id: String,
        #[serde(default)]
        kind: Option<String>,
        #[serde(default)]
        label: Option<String>,
    },
    /// Review's "never record this again" (layer 4 → layer 2).
    AddExclusion {
        #[serde(default)]
        host: Option<String>,
        #[serde(default)]
        bundle_id: Option<String>,
        #[serde(default)]
        app_name: Option<String>,
    },
}

pub struct Daemon {
    store_root: PathBuf,
    study: StudySnapshot,
    pipeline: RedactionPipeline<Box<dyn NerClient>>,
    store: Option<ObserverStore>,
    gate: CaptureGate,
    source: Box<dyn CaptureSource>,
    control_offset: u64,
    paused_at: Option<DateTime<Utc>>,
    /// Set when capture must be suspended for a surfaced reason (e.g. a failed
    /// exclusion save or an unreadable exclusions file). Fail-closed: while
    /// set, capture_pass returns early and the reason is published to
    /// daemon.status. Cleared once the durable state is consistent again.
    capture_blocked: Option<String>,
}

impl Daemon {
    pub fn open(store_root: &Path, source: Box<dyn CaptureSource>) -> anyhow::Result<Self> {
        std::fs::create_dir_all(store_root)?;
        let study = nibbin_study::load(store_root)?.unwrap_or_else(|| {
            // First-boot fallback id only: the timestamp-ms id is used solely
            // when no study.json exists yet. Every subsequent study is minted by
            // the UI via create_study with a crypto.randomUUID(); the per-account
            // unique index makes a same-ms collision harmless (an idempotent
            // retry resolves to the same row).
            new_study(
                &format!("full_{}", chrono::Utc::now().timestamp_millis()),
                StudyKind::FullStudy,
                None,
            )
        });
        nibbin_study::save(store_root, &study)?;
        // Resume the control cursor where we left off (persisted), so a daemon
        // restart does not re-apply already-consumed commands (P2-2).
        let control_offset = std::fs::read_to_string(store_root.join("control.offset"))
            .ok()
            .and_then(|s| s.trim().parse().ok())
            .unwrap_or(0);
        let mut pipeline = RedactionPipeline::new(ner_from_env());
        // FIX 2 (spec §5.1): a corrupt/unreadable exclusions file must NOT
        // refuse to start — the daemon still needs to come up so it writes
        // daemon.status for the tray. Instead, start with capture suspended and
        // surface the reason; capture_pass stays gated until recovery (a
        // delete-everything clears the block).
        let mut capture_blocked = None;
        match exclusions::load_exclusions(store_root) {
            Ok(ex) => pipeline.add_exclusions(ex),
            Err(e) => capture_blocked = Some(format!("exclusions unreadable: {e}")),
        }
        Ok(Self {
            store_root: store_root.to_path_buf(),
            study,
            pipeline,
            store: None,
            gate: CaptureGate::new(),
            source,
            control_offset,
            paused_at: None,
            capture_blocked,
        })
    }

    pub fn study(&self) -> &StudySnapshot {
        &self.study
    }

    pub fn gate(&self) -> CaptureGate {
        self.gate.clone()
    }

    fn apply(&mut self, cmd: StudyCommand) -> anyhow::Result<()> {
        self.study = transition(&self.study, cmd)?;
        nibbin_study::save(&self.store_root, &self.study)?;
        Ok(())
    }

    /// The daemon heartbeat: C2 enforcement. Returns true when the day-14
    /// stop fired on this tick.
    pub fn tick(&mut self) -> anyhow::Result<bool> {
        let now = daemon_now();
        // Record the observed time first: the high-water mark this advances is
        // what makes the deadline check rollback-proof (C2).
        let observed = nibbin_study::observe_clock(&self.study, now);
        if observed.clock_high_water != self.study.clock_high_water {
            self.study = observed;
            nibbin_study::save(&self.store_root, &self.study)?;
        }
        if deadline_passed(&self.study, now) {
            self.apply(StudyCommand::StopDay14)?;
            self.source.stop();
            return Ok(true);
        }
        Ok(false)
    }

    /// One capture pass: deadline first, then gates, then the 4-layer
    /// pipeline. Nothing persists unless every gate passes.
    pub fn capture_pass(&mut self) -> anyhow::Result<()> {
        self.tick()?;
        if !capture_allowed(&self.study)
            || self.gate.is_paused()
            || self.pipeline.halted()
            || self.capture_blocked.is_some()
        {
            return Ok(());
        }
        let snapshots = self.source.poll()?;
        if snapshots.is_empty() {
            return Ok(());
        }
        let now_iso = daemon_now().to_rfc3339();
        // split borrows: take the store handle before iterating
        if self.store.is_none() {
            self.store = Some(ObserverStore::open(
                &self.store_root,
                key_provider().as_ref(),
            )?);
        }
        let store = self.store.as_mut().expect("opened above");
        for snapshot in snapshots {
            if self.gate.is_paused() {
                break; // C6: the flip kills forwarding mid-batch too
            }
            for raw in snapshot_to_raw_events(&snapshot, "ses_local", &now_iso) {
                match self.pipeline.process(&raw, store)? {
                    ProcessOutcome::HaltedNerUnavailable => {
                        // fail-closed: suspend capture; the supervisor decides
                        // when the sidecar is healthy enough to resume.
                        self.source.stop();
                        return Ok(());
                    }
                    ProcessOutcome::Persisted | ProcessOutcome::BlockedCategory(_) => {}
                }
            }
        }
        Ok(())
    }

    /// Drain new lines from control.jsonl (the UI's command channel).
    pub fn drain_control(&mut self) -> anyhow::Result<()> {
        let path = self.store_root.join("control.jsonl");
        if !path.exists() {
            return Ok(());
        }
        let text = std::fs::read_to_string(&path)?;
        let fresh = &text[usize::try_from(self.control_offset)
            .unwrap_or(0)
            .min(text.len())..];
        self.control_offset = text.len() as u64;
        std::fs::write(
            self.store_root.join("control.offset"),
            self.control_offset.to_string(),
        )?;
        for line in fresh.lines().filter(|l| !l.trim().is_empty()) {
            let cmd: ControlCommand = match serde_json::from_str(line) {
                Ok(c) => c,
                Err(_) => continue, // a malformed command never crashes the daemon
            };
            // A single bad/stale command (e.g. an invalid transition after a
            // restart) must never brick the daemon — log and keep going.
            if let Err(e) = self.handle(cmd) {
                eprintln!("control command failed (continuing): {e}");
            }
        }
        Ok(())
    }

    pub fn handle(&mut self, cmd: ControlCommand) -> anyhow::Result<()> {
        let now = daemon_now();
        match cmd {
            ControlCommand::Consent => self.apply(StudyCommand::Consent { at: now })?,
            ControlCommand::Start => {
                self.apply(StudyCommand::Start { at: now })?;
                self.source.start()?;
            }
            ControlCommand::Pause => {
                self.gate.pause(); // C6 first: kill forwarding before any IO
                self.apply(StudyCommand::Pause)?;
                self.paused_at = Some(now);
            }
            ControlCommand::Resume => {
                self.apply(StudyCommand::Resume)?;
                // C6: pauses are recorded as VISIBLE gaps (never hidden). The
                // gap carries no content — only its duration.
                self.record_gap(now)?;
                self.gate.resume();
            }
            ControlCommand::StopEarly => {
                self.apply(StudyCommand::StopEarly)?;
                self.source.stop();
            }
            ControlCommand::CreateStudy {
                study_id,
                kind,
                label,
            } => {
                let kind = match kind.as_deref() {
                    Some("quick_scan") => StudyKind::QuickScan,
                    _ => StudyKind::FullStudy,
                };
                self.apply(StudyCommand::CreateStudy {
                    id: study_id,
                    kind,
                    label,
                })?;
                // A fresh study starts empty: clear the observer-store. Reuse
                // the post-deletion destroy path — drop the in-memory handle
                // and remove the SQLCipher db files. The next capture pass
                // lazily reopens an empty store. Scoped to create_study only.
                // Safe to destroy the store here: create_study is only reachable
                // from NOT_STARTED/COMPLETE/DELETED (transition guards it), where
                // capture_allowed is false, so capture_pass cannot be holding an
                // open store handle concurrently.
                self.clear_store()?;
            }
            ControlCommand::FinishReview => self.apply(StudyCommand::FinishReview)?,
            ControlCommand::SynthesisComplete => {
                self.apply(StudyCommand::SynthesisComplete)?;
                self.delete_raw_and_verify()?;
            }
            ControlCommand::DeleteEverything => {
                self.gate.pause();
                self.source.stop();
                self.apply(StudyCommand::DeleteEverything)?;
                self.delete_raw_and_verify()?;
            }
            ControlCommand::AddExclusion {
                host,
                bundle_id,
                app_name,
            } => {
                let add = nibbin_redaction::UserExclusions {
                    hosts: host.into_iter().collect(),
                    bundle_ids: bundle_id.into_iter().collect(),
                    app_names: app_name.into_iter().collect(),
                };
                // Save-first (T2/TC-P3): persist the merged set BEFORE enforcing it in
                // memory, so we never enforce an exclusion that won't survive a restart.
                let mut merged = self.pipeline.exclusions().clone();
                merged.merge(add.clone());
                if let Err(e) = exclusions::save_exclusions(&self.store_root, &merged) {
                    // Fail closed: do not silently enforce-then-lose. Block capture and
                    // surface the reason so the user is told it didn't take.
                    self.capture_blocked = Some(format!("exclusion not saved: {e}"));
                    return Err(e);
                }
                // Durable write succeeded → safe to enforce in memory, and clear any prior block.
                self.pipeline.add_exclusions(add);
                self.capture_blocked = None;
            }
        }
        Ok(())
    }

    fn store_mut(&mut self) -> anyhow::Result<&mut ObserverStore> {
        if self.store.is_none() {
            self.store = Some(ObserverStore::open(
                &self.store_root,
                key_provider().as_ref(),
            )?);
        }
        Ok(self.store.as_mut().expect("opened above"))
    }

    /// Append a visible capture gap covering the pause (C6: pauses are logged,
    /// never hidden). The event carries only the gap's duration — no app, no
    /// window content, no frame.
    fn record_gap(&mut self, now: DateTime<Utc>) -> anyhow::Result<()> {
        let duration_ms = self
            .paused_at
            .take()
            .map(|start| (now - start).num_milliseconds().max(0) as u64)
            .unwrap_or(0);
        let gap = ObserverEvent {
            v: 1,
            id: format!("evt_gap_{}", now.to_rfc3339()),
            ts: now.to_rfc3339(),
            session: "ses_gap".to_string(),
            kind: EventKind::CaptureGap,
            app: AppRef {
                bundle_id: "app.nibbin.observer".to_string(),
                name: "Observer".to_string(),
            },
            window: WindowRef {
                title_redacted: String::new(),
                id: "w_gap".to_string(),
            },
            url: None,
            ax: None,
            input: Some(InputRef {
                keys: 0,
                clicks: 0,
                duration_ms,
            }),
            frame_ref: None,
            redaction: RedactionMeta {
                rules_hit: vec![],
                review_state: ReviewState::Auto,
            },
        };
        self.store_mut()?.append(&gap)?;
        Ok(())
    }

    /// Clear the observer-store so a freshly-created study starts empty. Reuses
    /// the post-deletion destroy path: drop the in-memory handle (if any) and
    /// remove the SQLCipher db files. No verification/receipt — this is not a
    /// C3 deletion, just a reset for the next study; the next capture pass
    /// reopens an empty store lazily.
    fn clear_store(&mut self) -> anyhow::Result<()> {
        // Consume the in-memory handle first so the db connection is closed
        // before the files are removed.
        if let Some(store) = self.store.take() {
            store.destroy_raw_data()?;
        } else if self.store_root.join("observer.db").exists() {
            let store = ObserverStore::open(&self.store_root, key_provider().as_ref())?;
            store.destroy_raw_data()?;
        }
        let ex = self.store_root.join("exclusions.json");
        if ex.exists() {
            std::fs::remove_file(ex)?;
        }
        // Recovery: wiping the store removes the (possibly corrupt) exclusions
        // file, so any prior block no longer applies.
        self.capture_blocked = None;
        Ok(())
    }

    /// RAW_DELETING → destroy → independent verification → receipt (C3).
    fn delete_raw_and_verify(&mut self) -> anyhow::Result<()> {
        // make sure the db exists as a store handle, then consume it
        if self.store.is_none() && self.store_root.join("observer.db").exists() {
            self.store = Some(ObserverStore::open(
                &self.store_root,
                key_provider().as_ref(),
            )?);
        }
        if let Some(store) = self.store.take() {
            store.destroy_raw_data()?;
        }
        // residual control/status bookkeeping files hold no raw data but are
        // removed anyway so the verifier's bar stays "nothing but study.json"
        // FIX 3 (C3 residual): include exclusions.json.tmp — a stale temp from a
        // kill between write and rename must not fail the deletion verifier.
        for extra in [
            "control.jsonl",
            "control.offset",
            "daemon.status",
            "exclusions.json",
            "exclusions.json.tmp",
        ] {
            let p = self.store_root.join(extra);
            if p.exists() {
                std::fs::remove_file(p)?;
            }
        }
        self.control_offset = 0;
        // Recovery: a delete-everything wipes the exclusions file, so any prior
        // block no longer applies — restore a usable daemon.
        self.capture_blocked = None;
        let receipt =
            nibbin_store::verify_raw_data_deleted(&self.store_root, &daemon_now().to_rfc3339());
        anyhow::ensure!(
            receipt.verified,
            "deletion verification failed: {:?}",
            receipt.residual_files
        );
        self.apply(StudyCommand::DeletionVerified { receipt })?;
        Ok(())
    }

    /// Heartbeat file for the tray UI (countdown is daemon-derived).
    pub fn write_status(&self) -> anyhow::Result<()> {
        let now = daemon_now();
        let status = serde_json::json!({
            "state": self.study.state,
            "remaining_ms": nibbin_study::remaining_ms(&self.study, now),
            "paused": self.gate.is_paused(),
            "pipeline_halted": self.pipeline.halted(),
            "capture_blocked": self.capture_blocked,
            "at": now.to_rfc3339(),
        });
        std::fs::write(self.store_root.join("daemon.status"), status.to_string())
            .context("writing daemon.status")?;
        Ok(())
    }
}
