//! Windows UIA capture source — same trait as macOS (SPEC §8 M6: "Windows
//! behind the same capture trait"). macOS lands first; this adapter carries
//! the same fail-loud contract until its bring-up pass.

use crate::CaptureSource;
use nibbin_redaction::AxSnapshot;

pub struct WindowsUiaCapture {
    started: bool,
}

impl WindowsUiaCapture {
    pub fn new() -> Self {
        Self { started: false }
    }
}

impl Default for WindowsUiaCapture {
    fn default() -> Self {
        Self::new()
    }
}

impl CaptureSource for WindowsUiaCapture {
    fn name(&self) -> &'static str {
        "windows-uia"
    }

    fn start(&mut self) -> anyhow::Result<()> {
        // TODO(M8 Windows parity): wire the vendored a11y fork's UIA walker:
        //   1. UIAutomation event handlers (focus, structure, property).
        //   2. IsPassword / UIA_IsPasswordPropertyId → secure: true (C4).
        //   3. Graceful no-capture on secure desktop (UAC) screens (§5.9).
        //   4. Per-monitor DPI awareness for any frame work.
        anyhow::bail!("Windows UIA capture lands at the Windows-parity pass (M8)");
    }

    fn poll(&mut self) -> anyhow::Result<Vec<AxSnapshot>> {
        Ok(vec![])
    }

    fn stop(&mut self) {
        self.started = false;
    }
}
