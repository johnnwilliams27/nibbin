//! The Observer's local store. SQLCipher-encrypted SQLite; the DB key never
//! touches disk in plaintext (wrapped by the OS keystore in production
//! builds, supplied explicitly in tests). Raw study data lives ONLY here —
//! there is no sync path (C1/C7); deletion is real file removal verified by
//! an independent walker (C3).

mod key;
#[cfg(feature = "os-keystore")]
pub use key::OsKeystoreKey;
pub use key::{KeyProvider, StaticTestKey};

use anyhow::{anyhow, Context};
use nibbin_redaction::event::ReviewState;
use nibbin_redaction::{ObserverEvent, PersistSink};
use nibbin_study::DeletionReceipt;
use rusqlite::Connection;
use std::path::{Path, PathBuf};

pub struct ObserverStore {
    conn: Connection,
    root: PathBuf,
    /// Soft cap on `events` rows (see `EVENT_SOFT_CAP`). A field (not the const
    /// directly) so tests can drive the fail-safe path with a tiny cap instead
    /// of inserting millions of rows. Production always uses `EVENT_SOFT_CAP`.
    event_soft_cap: u64,
    /// Cached row count for the `events` table (LS-01/cost-01 fix).
    ///
    /// Initialised once from `COUNT(*)` in `open()`, then incremented on every
    /// successful INSERT so that `append()` never runs a full table scan on the
    /// hot path. When the cached value is within `COUNT_RECHECK_MARGIN` of the
    /// cap we re-query the real count to defend against any drift (e.g. an
    /// external connection deleting rows while we run). This keeps the
    /// soft-cap invariant sound while eliminating the per-append scan in the
    /// common case (well below the cap).
    cached_event_count: u64,
}

const DB_FILE: &str = "observer.db";

/// When the cached event count is within this many rows of the soft cap we
/// re-query the real `COUNT(*)` to correct any drift before deciding whether
/// to block the insert. Outside this margin the cache is authoritative.
const COUNT_RECHECK_MARGIN: u64 = 100;

/// Generous soft cap on the number of `events` rows. With #151's tree-dedup a
/// real 14-day study stays far below this; the cap exists only to catch a
/// runaway (e.g. a stuck capture loop). When reached, `append()` FAILS SAFE —
/// it stops writing and returns a distinct error so the daemon can surface
/// `capture_blocked` — it NEVER prunes or silently drops study data (cost-02 /
/// H2).
pub const EVENT_SOFT_CAP: u64 = 5_000_000;

/// Marker substring embedded in the soft-cap error message. The daemon matches
/// on this (rather than a typed error, to stay inside the existing
/// `anyhow`-based `PersistSink::append` contract) to distinguish a fail-safe
/// "store full" stop from a genuine write failure.
pub const SOFT_CAP_MARKER: &str = "store soft cap reached";

/// True if `err` is the fail-safe soft-cap signal from `append()` (vs. a real
/// I/O / DB error). Lets the daemon turn it into a graceful `capture_blocked`
/// stop instead of crashing.
pub fn is_soft_cap_error(err: &anyhow::Error) -> bool {
    err.to_string().contains(SOFT_CAP_MARKER)
}

impl ObserverStore {
    pub fn open(root: &Path, key: &dyn KeyProvider) -> Result<Self, anyhow::Error> {
        std::fs::create_dir_all(root)?;
        let conn = Connection::open(root.join(DB_FILE))?;
        let key_hex = key.key_hex()?;
        if key_hex.len() != 64 || !key_hex.chars().all(|c| c.is_ascii_hexdigit()) {
            return Err(anyhow!("store key must be 32 bytes hex"));
        }
        // SQLCipher raw-key form; quotes are safe because the key is hex-validated.
        conn.pragma_update(None, "key", format!("x'{key_hex}'"))?;
        conn.execute_batch(
            r#"
            CREATE TABLE IF NOT EXISTS events (
                id   TEXT PRIMARY KEY,
                ts   TEXT NOT NULL,
                json TEXT NOT NULL
            );
            CREATE TABLE IF NOT EXISTS frames (
                ref   TEXT PRIMARY KEY,
                bytes BLOB NOT NULL
            );
            "#,
        )
        .context("opening store (wrong key?)")?;
        // Load the initial count once here; `append()` keeps it current via
        // increment, so this is the only full table scan in steady-state operation.
        let cached_event_count = conn
            .query_row("SELECT COUNT(*) FROM events", [], |r| r.get::<_, u64>(0))?;
        Ok(Self {
            conn,
            root: root.to_path_buf(),
            event_soft_cap: EVENT_SOFT_CAP,
            cached_event_count,
        })
    }

    pub fn root(&self) -> &Path {
        &self.root
    }

    /// Test hook: override the soft cap so the fail-safe path can be exercised
    /// without inserting `EVENT_SOFT_CAP` rows. Not for production use.
    #[cfg(test)]
    fn set_soft_cap_for_test(&mut self, cap: u64) {
        self.event_soft_cap = cap;
        // Also refresh the cache so the new (tiny) cap takes effect immediately
        // even if rows were already inserted at the previous cap.
        self.cached_event_count = self.event_count().unwrap_or(0);
    }

    fn event_count(&self) -> Result<u64, anyhow::Error> {
        Ok(self
            .conn
            .query_row("SELECT COUNT(*) FROM events", [], |r| r.get::<_, u64>(0))?)
    }

    pub fn list_events(&self) -> Result<Vec<ObserverEvent>, anyhow::Error> {
        let mut stmt = self
            .conn
            .prepare("SELECT json FROM events ORDER BY ts, id")?;
        let rows = stmt.query_map([], |row| row.get::<_, String>(0))?;
        let mut out = Vec::new();
        for row in rows {
            out.push(serde_json::from_str(&row?)?);
        }
        Ok(out)
    }

    pub fn set_review_state(
        &mut self,
        ids: &[String],
        state: ReviewState,
    ) -> Result<(), anyhow::Error> {
        let tx = self.conn.transaction()?;
        for id in ids {
            let json: Option<String> = tx
                .query_row("SELECT json FROM events WHERE id = ?1", [id], |r| r.get(0))
                .map(Some)
                .or_else(|e| {
                    if e == rusqlite::Error::QueryReturnedNoRows {
                        Ok(None)
                    } else {
                        Err(e)
                    }
                })?;
            if let Some(json) = json {
                let mut event: ObserverEvent = serde_json::from_str(&json)?;
                event.redaction.review_state = state;
                tx.execute(
                    "UPDATE events SET json = ?1 WHERE id = ?2",
                    rusqlite::params![serde_json::to_string(&event)?, id],
                )?;
            }
        }
        tx.commit()?;
        Ok(())
    }

    pub fn purge_events(&mut self, ids: &[String]) -> Result<(), anyhow::Error> {
        let tx = self.conn.transaction()?;
        for id in ids {
            tx.execute("DELETE FROM events WHERE id = ?1", [id])?;
        }
        tx.commit()?;
        Ok(())
    }

    pub fn put_frame(&mut self, frame_ref: &str, bytes: &[u8]) -> Result<(), anyhow::Error> {
        self.conn.execute(
            "INSERT OR REPLACE INTO frames (ref, bytes) VALUES (?1, ?2)",
            rusqlite::params![frame_ref, bytes],
        )?;
        Ok(())
    }

    pub fn frame_count(&self) -> Result<u64, anyhow::Error> {
        Ok(self
            .conn
            .query_row("SELECT COUNT(*) FROM frames", [], |r| r.get::<_, u64>(0))?)
    }

    /// RAW_DELETING: close the connection and remove the database files
    /// (main + WAL + SHM). Consumes the store — there is no way to keep
    /// using a store whose raw data was destroyed.
    pub fn destroy_raw_data(self) -> Result<(), anyhow::Error> {
        let root = self.root.clone();
        drop(self.conn);
        for name in [
            DB_FILE,
            "observer.db-wal",
            "observer.db-shm",
            "observer.db-journal",
        ] {
            let p = root.join(name);
            if p.exists() {
                std::fs::remove_file(&p).with_context(|| format!("removing {}", p.display()))?;
            }
        }
        Ok(())
    }
}

impl PersistSink for ObserverStore {
    fn append(&mut self, event: &ObserverEvent) -> Result<(), anyhow::Error> {
        // cost-02 / H2 fail-safe: if the store has reached the soft cap, STOP
        // (do NOT insert) and return a distinct error so the daemon surfaces
        // `capture_blocked`. We never prune or drop study data silently.
        //
        // LS-01/cost-01 fix: use the in-memory cached count (initialised once
        // at open() and incremented on every successful insert) so the common
        // path never runs a full `SELECT COUNT(*)` per append.  When the
        // cached value is within COUNT_RECHECK_MARGIN of the cap we re-query
        // the real count to catch any drift (e.g. external deletion).
        let cap = self.event_soft_cap;
        let count = if self.cached_event_count + COUNT_RECHECK_MARGIN >= cap {
            // Near or at cap: re-query to be exact.
            let real = self.event_count()?;
            self.cached_event_count = real;
            real
        } else {
            self.cached_event_count
        };
        if count >= cap {
            anyhow::bail!("{SOFT_CAP_MARKER} ({cap} events)");
        }
        self.conn.execute(
            "INSERT INTO events (id, ts, json) VALUES (?1, ?2, ?3)",
            rusqlite::params![event.id, event.ts, serde_json::to_string(event)?],
        )?;
        self.cached_event_count += 1;
        Ok(())
    }
}

/// Deletion verifier (C3) — deliberately independent of ObserverStore: it
/// re-walks the store root with raw fs calls. Anything that is not the
/// (raw-data-free) study snapshot is residue.
pub fn verify_raw_data_deleted(root: &Path, now_iso: &str) -> DeletionReceipt {
    // Only the study snapshot file at the store root may survive; anything
    // else is residue. Match the EXACT basename (not a path suffix — a suffix
    // match would clear "raw-data-study.json"), and treat symlinks as residue
    // so a dangling/redirecting link can't masquerade as the snapshot (C3).
    fn walk(dir: &Path, root: &Path, out: &mut Vec<String>) {
        let Ok(entries) = std::fs::read_dir(dir) else {
            return;
        };
        for entry in entries.flatten() {
            let p = entry.path();
            let is_symlink = entry.file_type().map(|t| t.is_symlink()).unwrap_or(true);
            let is_snapshot = !is_symlink
                && p.parent() == Some(root)
                && p.file_name().and_then(|n| n.to_str()) == Some("study.json");
            if p.is_dir() && !is_symlink {
                walk(&p, root, out);
            } else if !is_snapshot {
                out.push(p.to_string_lossy().into_owned());
            }
        }
    }
    let mut residual = Vec::new();
    walk(root, root, &mut residual);
    DeletionReceipt {
        verified_at: now_iso.to_string(),
        checked_paths: vec![root.to_string_lossy().into_owned()],
        residual_files: residual.clone(),
        verified: residual.is_empty(),
    }
}

#[cfg(test)]
mod verifier_tests {
    use super::*;

    #[test]
    fn lookalike_filenames_are_residue_not_cleared() {
        let dir = tempfile::tempdir().unwrap();
        std::fs::write(dir.path().join("study.json"), "{}").unwrap();
        // a suffix match would wrongly clear this
        std::fs::write(dir.path().join("raw-data-study.json"), "leak").unwrap();
        let receipt = verify_raw_data_deleted(dir.path(), "2026-06-24T00:00:00Z");
        assert!(!receipt.verified);
        assert_eq!(receipt.residual_files.len(), 1);
        assert!(receipt.residual_files[0].ends_with("raw-data-study.json"));
    }

    #[test]
    fn a_nested_study_json_is_residue() {
        let dir = tempfile::tempdir().unwrap();
        std::fs::write(dir.path().join("study.json"), "{}").unwrap();
        std::fs::create_dir(dir.path().join("frames")).unwrap();
        std::fs::write(dir.path().join("frames").join("study.json"), "leak").unwrap();
        let receipt = verify_raw_data_deleted(dir.path(), "2026-06-24T00:00:00Z");
        assert!(!receipt.verified, "only the ROOT study.json may survive");
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use nibbin_redaction::event::{AppRef, EventKind, RedactionMeta, ReviewState, WindowRef};

    fn key() -> StaticTestKey {
        StaticTestKey([7u8; 32])
    }

    fn event(id: &str) -> ObserverEvent {
        ObserverEvent {
            v: 1,
            id: id.into(),
            ts: "2026-06-12T14:03:22.114Z".into(),
            session: "ses_1".into(),
            kind: EventKind::AxDelta,
            app: AppRef {
                bundle_id: "com.example".into(),
                name: "Example".into(),
            },
            window: WindowRef {
                title_redacted: "Invoice {NUM}".into(),
                id: "w_1".into(),
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

    #[test]
    fn round_trip_and_review_state() {
        let dir = tempfile::tempdir().unwrap();
        let mut store = ObserverStore::open(dir.path(), &key()).unwrap();
        store.append(&event("e1")).unwrap();
        store.append(&event("e2")).unwrap();
        store
            .set_review_state(&["e1".into()], ReviewState::UserDeleted)
            .unwrap();
        store.purge_events(&["e1".into()]).unwrap();
        let events = store.list_events().unwrap();
        assert_eq!(events.len(), 1);
        assert_eq!(events[0].id, "e2");
    }

    #[test]
    fn append_past_soft_cap_fails_safe_without_dropping() {
        let dir = tempfile::tempdir().unwrap();
        let mut store = ObserverStore::open(dir.path(), &key()).unwrap();
        // Tiny cap so we hit the fail-safe path in two appends, not millions.
        store.set_soft_cap_for_test(2);

        store.append(&event("e1")).unwrap();
        store.append(&event("e2")).unwrap();

        // Third append is at the cap → fail-safe: returns the soft-cap error,
        // recognized by is_soft_cap_error, and does NOT insert.
        let err = store.append(&event("e3")).unwrap_err();
        assert!(
            super::is_soft_cap_error(&err),
            "expected the soft-cap error, got: {err}"
        );
        assert!(err.to_string().contains(super::SOFT_CAP_MARKER));

        // The two already-stored events are untouched (nothing pruned/dropped).
        let events = store.list_events().unwrap();
        assert_eq!(events.len(), 2, "soft cap must never drop existing events");
    }

    #[test]
    fn db_file_is_encrypted_at_rest_and_wrong_key_fails() {
        let dir = tempfile::tempdir().unwrap();
        {
            let mut store = ObserverStore::open(dir.path(), &key()).unwrap();
            store.append(&event("e1")).unwrap();
        }
        let bytes = std::fs::read(dir.path().join("observer.db")).unwrap();
        // a plaintext SQLite file starts with this magic; SQLCipher's must not
        assert!(!bytes.starts_with(b"SQLite format 3"));
        assert!(!String::from_utf8_lossy(&bytes).contains("Invoice"));

        let wrong = StaticTestKey([8u8; 32]);
        assert!(ObserverStore::open(dir.path(), &wrong).is_err());
    }

    #[test]
    fn destroy_then_verify_proves_emptiness() {
        let dir = tempfile::tempdir().unwrap();
        let mut store = ObserverStore::open(dir.path(), &key()).unwrap();
        store.append(&event("e1")).unwrap();
        store.put_frame("frame_1", &[1, 2, 3]).unwrap();
        std::fs::write(dir.path().join("study.json"), "{}").unwrap();

        // residue is detected while data exists
        assert!(!verify_raw_data_deleted(dir.path(), "2026-06-24T00:00:00Z").verified);

        store.destroy_raw_data().unwrap();
        let receipt = verify_raw_data_deleted(dir.path(), "2026-06-24T00:00:00Z");
        assert!(receipt.verified, "residual: {:?}", receipt.residual_files);
    }
}
