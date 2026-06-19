//! C6 — "Pause everything with one hotkey". The gate flip itself is wait-free
//! (sub-millisecond); the end-to-end hotkey→capture-stop is bounded by the
//! daemon's poll interval (~250ms), so the user-facing promise is "one hotkey",
//! not a sub-100ms latency number (gate #22 — don't publish <100ms end-to-end).
//!
//! The gate is a single AtomicBool. The hotkey handler calls `pause()` (one
//! store, nanoseconds); the capture loop checks `is_paused()` before
//! forwarding ANY snapshot to the pipeline. There is deliberately no lock,
//! no channel, and no IO between the hotkey and the gate flip.

use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;

#[derive(Clone, Default)]
pub struct CaptureGate {
    paused: Arc<AtomicBool>,
}

impl CaptureGate {
    pub fn new() -> Self {
        Self::default()
    }

    /// The hotkey path. O(1), wait-free.
    pub fn pause(&self) {
        self.paused.store(true, Ordering::SeqCst);
    }

    pub fn resume(&self) {
        self.paused.store(false, Ordering::SeqCst);
    }

    pub fn is_paused(&self) -> bool {
        self.paused.load(Ordering::SeqCst)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::time::{Duration, Instant};

    /// The gate flip is wait-free (nanoseconds): this test proves a running
    /// forward-loop observes `pause()` well inside 100ms even under contention.
    /// This covers only the in-process gate mechanism — the end-to-end
    /// hotkey→capture-stop also includes the daemon poll interval (~250ms).
    #[test]
    fn pause_observed_under_100ms() {
        let gate = CaptureGate::new();
        let loop_gate = gate.clone();
        let (tx, rx) = std::sync::mpsc::channel::<Instant>();

        let handle = std::thread::spawn(move || {
            // a tight capture-forward loop: forward unless paused
            loop {
                if loop_gate.is_paused() {
                    tx.send(Instant::now()).unwrap();
                    return;
                }
                std::hint::spin_loop();
            }
        });

        std::thread::sleep(Duration::from_millis(10));
        let flipped_at = Instant::now();
        gate.pause();
        let observed_at = rx
            .recv_timeout(Duration::from_millis(100))
            .expect("loop must observe the pause");
        handle.join().unwrap();

        assert!(observed_at.duration_since(flipped_at) < Duration::from_millis(100));
    }
}
