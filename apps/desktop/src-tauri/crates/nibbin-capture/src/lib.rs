//! Capture sources for the Observer daemon.
//!
//! Invariants owned here:
//! - C1: this crate has no network dependency — capture data can only flow to
//!   the in-process pipeline. Keep the dependency list free of HTTP/socket
//!   crates; the red-team checks this on every PR that touches capture.
//! - C4: secure-field suppression happens in the platform adapters BEFORE an
//!   AxSnapshot is built (the OS flag maps to `secure: true`, and
//!   nibbin-redaction's normalizer strips content structurally).
//! - C6: the global pause gate is a single atomic flip — the capture loop
//!   forwards nothing once it is set. No locks, no IO on that path.

pub mod gate;
#[cfg(target_os = "macos")]
pub mod macos;
#[cfg(feature = "screenpipe")]
pub mod map;
pub mod mock;
#[cfg(target_os = "windows")]
pub mod windows;

pub use gate::CaptureGate;
pub use mock::MockCapture;

use nibbin_redaction::AxSnapshot;

/// One drained capture item. Snapshots feed the existing redaction path
/// (AxDelta); input counts become InputBurst events directly (no content → no NER).
// large_enum_variant is intentional: a CaptureItem lives only transiently — poll()
// returns a tiny Vec (≈1 Snapshot + ≈1 Input per tick) that the daemon consumes
// immediately. Boxing the Snapshot would add a per-tick allocation for no real
// benefit, so the size difference is accepted here.
#[allow(clippy::large_enum_variant)]
pub enum CaptureItem {
    Snapshot(AxSnapshot),
    Input(InputCounts),
}

/// Aggregate input activity since the last poll — COUNTS ONLY, never content (SPEC §5).
pub struct InputCounts {
    pub keys: u32,
    pub clicks: u32,
    pub duration_ms: u64,
}

/// Whether a source can capture right now. `Blocked` carries a human reason
/// (e.g. "accessibility") that the daemon surfaces via `capture_blocked` (P-CB2).
pub enum CaptureReadiness {
    Ready,
    Blocked(String),
}

/// One platform capture surface. Implementations are event-driven (focus
/// change, AX delta, URL change, file dialogs, clipboard METADATA, input
/// burst boundaries) and buffer internally; `poll` drains cheaply.
/// Keystroke contents are never observed — counts/timing only (SPEC §5).
pub trait CaptureSource: Send {
    fn name(&self) -> &'static str;

    /// Permission/health pre-check. Default Ready; OS adapters override.
    fn readiness(&self) -> CaptureReadiness {
        CaptureReadiness::Ready
    }

    /// Begin observing. Idle >90s must suspend the underlying observers.
    fn start(&mut self) -> anyhow::Result<()>;

    /// Drain capture items buffered since the last poll.
    fn poll(&mut self) -> anyhow::Result<Vec<CaptureItem>>;

    /// Tear down all OS observers. Must be safe to call twice.
    fn stop(&mut self);
}

/// Pick the platform source. On unsupported targets (Linux CI) this returns
/// the mock, which produces nothing unless a test feeds it.
pub fn platform_source() -> Box<dyn CaptureSource> {
    #[cfg(target_os = "macos")]
    {
        return Box::new(macos::MacAxCapture::new());
    }
    #[cfg(target_os = "windows")]
    {
        return Box::new(windows::WindowsUiaCapture::new());
    }
    #[allow(unreachable_code)]
    Box::new(MockCapture::default())
}
