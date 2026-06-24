//! Self-suspend watchdog (0.2.5 defense-in-depth).
//!
//! PRIVACY GOAL: "the daemon must never keep capturing when it shouldn't." The
//! installer hooks (taskkill on pre-install / pre-uninstall) and the app's
//! kill-on-exit are the primary lifecycle controls; this watchdog is the
//! belt-and-suspenders layer that bounds *any* orphaned daemon — one whose
//! installer hook was skipped, whose parent app crashed, or that was superseded
//! by a newer install — by having the daemon voluntarily exit.
//!
//! The watchdog runs on the daemon's normal tick. It re-reads observable state
//! every pass (study snapshot from disk, the app heartbeat/lease file) so it
//! reacts to external changes without needing a control message. It is
//! deliberately CONSERVATIVE: it only exits when there is provably no reason to
//! keep running, and never while a study is in progress (Active/Paused) — a
//! live study must not be torn down out from under the user.
//!
//! Three independent exit triggers (any one suffices):
//!   1. ORPHANED + IDLE — no recent app heartbeat AND the study is not in
//!      progress. The supervising app is gone and there is nothing to capture.
//!   2. SUPERSEDED — a newer daemon instance has claimed the lease file (a later
//!      start time than ours). The old binary yields to the freshly-installed one.
//!   3. STALE TERMINAL — the study has been in a terminal state (Complete /
//!      Deleted) past the grace window. The work is done; nothing to service.

use chrono::{DateTime, Utc};
use std::path::{Path, PathBuf};
use std::time::{SystemTime, UNIX_EPOCH};

/// Filename the app refreshes while it is alive (parent-liveness heartbeat).
pub const APP_HEARTBEAT_FILE: &str = "app.heartbeat";
/// Filename each daemon writes to advertise itself; the newest writer wins.
pub const DAEMON_LEASE_FILE: &str = "daemon.lease";

/// How long the app heartbeat may be stale before we treat the parent as gone.
/// The app refreshes it every few seconds, so 5 minutes is comfortably past any
/// transient stall (sleep/resume, GC pause) while still bounding an orphan.
const APP_HEARTBEAT_STALE_SECS: u64 = 5 * 60;
/// How long the study may sit in a terminal state before the daemon exits.
const TERMINAL_GRACE_SECS: u64 = 5 * 60;
/// How long this daemon may run with no in-progress study and no app supervising
/// it before it considers itself orphaned. (Bounds a daemon left over from an
/// upgrade whose pre-install kill was somehow skipped.)
const ORPHAN_IDLE_SECS: u64 = 5 * 60;

fn now_unix_secs() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0)
}

/// True iff the study is actively running or paused (capture may be on, or is
/// one resume away). The daemon must NEVER self-exit in this state.
fn study_in_progress_on_disk(store_root: &Path) -> bool {
    use nibbin_study::StudyState::{Active, Paused};
    matches!(
        nibbin_study::load(store_root),
        // No study (or unreadable) is NOT "in progress": fail toward allowing
        // exit, since a daemon with no readable active study has no capture
        // mandate.
        Ok(Some(snap)) if matches!(snap.state, Active | Paused)
    )
}

/// True iff the study is in a terminal end-state (Complete or Deleted) — all
/// study work is finished, so the daemon has nothing left to service.
fn study_terminal_on_disk(store_root: &Path) -> bool {
    use nibbin_study::StudyState::{Complete, Deleted};
    matches!(
        nibbin_study::load(store_root),
        Ok(Some(snap)) if matches!(snap.state, Complete | Deleted)
    )
}

/// Age in seconds of a file's last modification, or `None` if it is missing /
/// unreadable / has a future mtime.
fn file_age_secs(path: &Path) -> Option<u64> {
    let modified = std::fs::metadata(path).ok()?.modified().ok()?;
    let mtime = modified.duration_since(UNIX_EPOCH).ok()?.as_secs();
    now_unix_secs().checked_sub(mtime)
}

/// The reason the watchdog decided to exit (for logging / tests).
#[derive(Debug, PartialEq, Eq)]
pub enum ExitReason {
    OrphanedIdle,
    Superseded,
    StaleTerminal,
}

/// The watchdog's per-daemon state: when this instance started, and how long
/// it has continuously observed "idle + orphaned" / "terminal" conditions.
pub struct Watchdog {
    store_root: PathBuf,
    /// Our own lease timestamp (process start, unix secs). A daemon with a
    /// strictly greater value supersedes us.
    started_at: u64,
    /// First time (unix secs) we observed orphaned+idle; reset when the
    /// condition clears. Exit only after the condition persists ORPHAN_IDLE_SECS.
    orphaned_since: Option<u64>,
    /// First time we observed a terminal study; reset when it clears.
    terminal_since: Option<u64>,
}

impl Watchdog {
    /// Create the watchdog and claim the lease (writes our start time, which is
    /// strictly newer than any prior daemon's, so an older instance still
    /// running will see itself superseded on its next check).
    pub fn new(store_root: &Path) -> Self {
        let started_at = now_unix_secs();
        let wd = Self {
            store_root: store_root.to_path_buf(),
            started_at,
            orphaned_since: None,
            terminal_since: None,
        };
        // Best-effort: a lease write failure must never crash capture.
        let _ = std::fs::write(store_root.join(DAEMON_LEASE_FILE), started_at.to_string());
        wd
    }

    /// Refresh our lease so a *concurrent* equal-second daemon can still be
    /// distinguished over time; called each tick (cheap). Only rewrites if we
    /// still own the lease (our value is >= the file's), so we never clobber a
    /// genuinely-newer daemon's claim.
    fn touch_lease(&self) {
        let lease = self.store_root.join(DAEMON_LEASE_FILE);
        let owner = read_lease(&lease);
        if owner.is_none_or(|v| v <= self.started_at) {
            let _ = std::fs::write(&lease, self.started_at.to_string());
        }
    }

    /// Evaluate the three exit triggers against current on-disk state. Returns
    /// `Some(reason)` when the daemon should exit. Pure decision logic given the
    /// clock (`now`); call `should_exit()` for the production wiring.
    pub fn evaluate(&mut self, now: u64) -> Option<ExitReason> {
        // 2. SUPERSEDED — a strictly-newer daemon owns the lease. Checked first
        //    and unconditionally (even mid-study): if a new install is up, the
        //    new daemon is the authority; the old one must yield immediately to
        //    avoid two daemons capturing under different rules.
        if let Some(owner) = read_lease(&self.store_root.join(DAEMON_LEASE_FILE)) {
            if owner > self.started_at {
                return Some(ExitReason::Superseded);
            }
        }

        let in_progress = study_in_progress_on_disk(&self.store_root);

        // NEVER exit (for the idle/terminal reasons) while a study is live.
        if in_progress {
            self.orphaned_since = None;
            self.terminal_since = None;
            return None;
        }

        // 3. STALE TERMINAL — study finished and has stayed finished past the
        //    grace window.
        if study_terminal_on_disk(&self.store_root) {
            let since = *self.terminal_since.get_or_insert(now);
            if now.saturating_sub(since) >= TERMINAL_GRACE_SECS {
                return Some(ExitReason::StaleTerminal);
            }
        } else {
            self.terminal_since = None;
        }

        // 1. ORPHANED + IDLE — parent app heartbeat is stale (or absent) and no
        //    study is in progress, sustained past the orphan window.
        let heartbeat = self.store_root.join(APP_HEARTBEAT_FILE);
        // Missing heartbeat entirely (None) => treat as gone.
        let app_gone = file_age_secs(&heartbeat).is_none_or(|age| age >= APP_HEARTBEAT_STALE_SECS);
        if app_gone {
            let since = *self.orphaned_since.get_or_insert(now);
            if now.saturating_sub(since) >= ORPHAN_IDLE_SECS {
                return Some(ExitReason::OrphanedIdle);
            }
        } else {
            self.orphaned_since = None;
        }

        None
    }

    /// Production tick: refresh our lease, then evaluate against wall-clock.
    /// Returns `Some(reason)` when the caller should stop capture and exit.
    pub fn should_exit(&mut self) -> Option<ExitReason> {
        self.touch_lease();
        self.evaluate(now_unix_secs())
    }
}

/// Read a lease file's unix-seconds value, if present and parseable.
fn read_lease(path: &Path) -> Option<u64> {
    std::fs::read_to_string(path).ok()?.trim().parse().ok()
}

/// Convert an ISO-8601 instant to unix secs (helper for callers that hold a
/// `DateTime<Utc>`); unused by the core path but handy for tests.
#[allow(dead_code)]
pub fn iso_to_unix(ts: &str) -> Option<u64> {
    ts.parse::<DateTime<Utc>>()
        .ok()
        .map(|dt| dt.timestamp().max(0) as u64)
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::tempdir;

    fn write_study(dir: &Path, state: &str) {
        // Minimal study.json the loader accepts. We only need `state`; other
        // fields use the snapshot's serde shape. Round-trip via new_study +
        // save to guarantee a schema match.
        let kind = nibbin_study::StudyKind::FullStudy;
        let mut snap = nibbin_study::new_study(
            "test_study",
            kind,
            None,
            nibbin_study::CaptureDepth::default(),
        );
        snap.state = match state {
            "ACTIVE" => nibbin_study::StudyState::Active,
            "PAUSED" => nibbin_study::StudyState::Paused,
            "COMPLETE" => nibbin_study::StudyState::Complete,
            "DELETED" => nibbin_study::StudyState::Deleted,
            "NOT_STARTED" => nibbin_study::StudyState::NotStarted,
            other => panic!("unhandled test state {other}"),
        };
        nibbin_study::save(dir, &snap).unwrap();
    }

    #[test]
    fn does_not_exit_while_study_active() {
        let dir = tempdir().unwrap();
        write_study(dir.path(), "ACTIVE");
        let mut wd = Watchdog::new(dir.path());
        // Even with no app heartbeat and far in the future, an active study
        // must keep the daemon alive.
        let far = now_unix_secs() + 10 * 60;
        assert_eq!(wd.evaluate(far), None);
    }

    #[test]
    fn exits_when_orphaned_and_idle_after_window() {
        let dir = tempdir().unwrap();
        write_study(dir.path(), "NOT_STARTED");
        let mut wd = Watchdog::new(dir.path());
        let t0 = now_unix_secs();
        // No heartbeat file => app gone. Not yet past the window.
        assert_eq!(wd.evaluate(t0), None);
        // Past the window => orphaned-idle exit.
        assert_eq!(
            wd.evaluate(t0 + ORPHAN_IDLE_SECS),
            Some(ExitReason::OrphanedIdle)
        );
    }

    #[test]
    fn fresh_app_heartbeat_keeps_daemon_alive() {
        let dir = tempdir().unwrap();
        write_study(dir.path(), "NOT_STARTED");
        std::fs::write(dir.path().join(APP_HEARTBEAT_FILE), "x").unwrap();
        let mut wd = Watchdog::new(dir.path());
        // App heartbeat is fresh => never orphaned, even past the window.
        assert_eq!(wd.evaluate(now_unix_secs() + ORPHAN_IDLE_SECS + 60), None);
    }

    #[test]
    fn exits_when_superseded_by_newer_daemon() {
        let dir = tempdir().unwrap();
        write_study(dir.path(), "ACTIVE");
        let mut wd = Watchdog::new(dir.path());
        // A newer daemon claims the lease with a strictly greater start time.
        let newer = wd.started_at + 1;
        std::fs::write(dir.path().join(DAEMON_LEASE_FILE), newer.to_string()).unwrap();
        // Superseded wins even over an active study.
        assert_eq!(wd.evaluate(now_unix_secs()), Some(ExitReason::Superseded));
    }

    #[test]
    fn exits_when_terminal_past_grace() {
        let dir = tempdir().unwrap();
        write_study(dir.path(), "DELETED");
        // Fresh heartbeat so the orphan trigger can't fire — isolate terminal.
        std::fs::write(dir.path().join(APP_HEARTBEAT_FILE), "x").unwrap();
        let mut wd = Watchdog::new(dir.path());
        let t0 = now_unix_secs();
        assert_eq!(wd.evaluate(t0), None);
        assert_eq!(
            wd.evaluate(t0 + TERMINAL_GRACE_SECS),
            Some(ExitReason::StaleTerminal)
        );
    }
}
