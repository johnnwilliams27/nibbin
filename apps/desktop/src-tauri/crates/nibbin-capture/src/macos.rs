//! macOS AX capture source (AX-first, pixels-second — SPEC §5).
//!
//! Bring-up status: ARCHITECTURE LANDED, OS WIRING PENDING HARDWARE. This
//! adapter wraps the vendored Screenpipe a11y fork (vendor/screenpipe,
//! frozen at MIT commit 892199f742): AXObserver registrations for focus /
//! AX-delta / window-title notifications, NSWorkspace activation events,
//! and the AXSecureTextField role check that feeds `secure: true` into the
//! snapshot (C4 — structural, never image detection).
//!
//! Until the macOS bring-up pass runs on hardware, `start()` returns an
//! error rather than pretending to capture: a daemon must fail loudly, not
//! record nothing silently while a study burns days.

use crate::{CaptureItem, CaptureSource};

pub struct MacAxCapture {
    started: bool,
}

impl MacAxCapture {
    pub fn new() -> Self {
        Self { started: false }
    }
}

impl Default for MacAxCapture {
    fn default() -> Self {
        Self::new()
    }
}

impl CaptureSource for MacAxCapture {
    fn name(&self) -> &'static str {
        "macos-ax"
    }

    fn start(&mut self) -> anyhow::Result<()> {
        // TODO(M6 macOS bring-up): wire the vendored a11y tree walker:
        //   1. Check AXIsProcessTrusted / Screen Recording permission; if
        //      missing, surface the §5.9 permission rehearsal instead of
        //      starting. Mid-study revocation must auto-pause with a calm
        //      explainer.
        //   2. Register AXObservers (focus, value-changed, title-changed)
        //      and NSWorkspace app-activation notifications.
        //   3. Map AXSecureTextField → AxSnapshotNode.secure = true (C4).
        //   4. Input-burst boundaries from CGEventTap COUNTS only — never
        //      keystroke contents (SPEC §5).
        //   5. Idle >90s suspends observers; budgets <5% CPU / <300MB RSS.
        anyhow::bail!(
            "macOS AX capture requires the hardware bring-up pass (vendored Screenpipe a11y fork is staged in vendor/screenpipe)"
        );
    }

    fn poll(&mut self) -> anyhow::Result<Vec<CaptureItem>> {
        Ok(vec![])
    }

    fn stop(&mut self) {
        self.started = false;
    }
}
