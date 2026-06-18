//! Windows UIA capture source — same trait as macOS (SPEC §8 M6: "Windows
//! behind the same capture trait"). Behind the `screenpipe` feature this drives
//! the vendored a11y fork's UIA walker directly, per tick (Approach A): COM is
//! initialized once on the capture thread in `start()`, the `UiaContext` is
//! reused across ticks, and each `poll()` snapshots the foreground window's
//! accessibility tree → AxSnapshot → the existing redaction pipeline.
//!
//! Without the feature the bailing stub stays (default/CI/mock builds unaffected).
//!
//! Contract (P-CB1): a genuine inability to capture (COM init / UIA init
//! failure) makes `start()` return Err so the daemon logs it. A tick with no
//! readable foreground tree (locked / secure desktop / no focus / provider
//! refuses) returns an EMPTY vec — a graceful capture gap, never an error.

// ---------------------------------------------------------------------------
// Real adapter (feature = "screenpipe")
// ---------------------------------------------------------------------------
#[cfg(feature = "screenpipe")]
mod real {
    use crate::map;
    use crate::{CaptureItem, CaptureReadiness, CaptureSource};
    use screenpipe_a11y::{get_window_info, UiaContext};
    use windows::Win32::System::Com::{
        CoInitializeEx, CoUninitialize, COINIT_APARTMENTTHREADED,
    };
    use windows::Win32::UI::WindowsAndMessaging::GetForegroundWindow;

    /// Cap on elements walked per tree. Mirrors the fork's own test budget; the
    /// walker stops once this many nodes are produced (bounds CPU on huge trees).
    const MAX_ELEMENTS: usize = 10_000;

    /// `UiaContext` holds COM apartment-threaded interfaces (`IUIAutomation`,
    /// etc.), which are `!Send`. The `CaptureSource` trait is `Send` because the
    /// daemon *moves* the boxed source onto its single capture thread at setup.
    /// After that move, the daemon only ever calls `start`/`poll`/`stop` from
    /// that one thread — COM init in `start()`, every `capture_window_tree` in
    /// `poll()`, and teardown in `stop()` all run there. The COM objects are
    /// therefore created and used (and dropped) on a single thread, satisfying
    /// the apartment-threaded contract.
    ///
    /// This wrapper lets the struct be `Send` (so it can be moved to the capture
    /// thread once) while GUARDING against the one thing the type system can no
    /// longer prove: that no method actually touches the COM objects from a
    /// different thread. `created_on` records the thread that built the context
    /// and `get()` panics on any cross-thread access — turning an unsound use
    /// into a loud, immediate failure rather than UB.
    struct ThreadBoundUia {
        inner: UiaContext,
        created_on: std::thread::ThreadId,
    }

    // SAFETY: see ThreadBoundUia doc comment. The inner `!Send` COM objects are
    // only ever dereferenced via `get()`, which asserts the calling thread is
    // the creating thread. The `Send` impl only enables the initial move of the
    // (not-yet-touched) handle onto the capture thread; it never enables
    // concurrent or cross-thread *use* of the COM objects.
    unsafe impl Send for ThreadBoundUia {}

    impl ThreadBoundUia {
        fn new(inner: UiaContext) -> Self {
            Self {
                inner,
                created_on: std::thread::current().id(),
            }
        }

        fn get(&self) -> &UiaContext {
            assert_eq!(
                std::thread::current().id(),
                self.created_on,
                "WindowsUiaCapture: UIA COM context used on a different thread than it was \
                 created on (apartment-threaded COM violation). start()/poll()/stop() must \
                 all run on one thread."
            );
            &self.inner
        }
    }

    pub struct WindowsUiaCapture {
        started: bool,
        com_init: bool,
        uia: Option<ThreadBoundUia>,
    }

    impl WindowsUiaCapture {
        pub fn new() -> Self {
            Self {
                started: false,
                com_init: false,
                uia: None,
            }
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

        // UIA needs no user grant (unlike macOS AX); always Ready.
        fn readiness(&self) -> CaptureReadiness {
            CaptureReadiness::Ready
        }

        fn start(&mut self) -> anyhow::Result<()> {
            if self.started {
                return Ok(());
            }
            // COM must be initialized on the thread that will call poll(); the
            // daemon's capture loop runs poll repeatedly on one thread, so we
            // init here and tear down in stop() on that same thread.
            //
            // CoInitializeEx in windows 0.58 returns HRESULT. S_OK and S_FALSE
            // (already initialized on this thread, apartment-compatible) are
            // both fine; RPC_E_CHANGED_MODE (a prior init chose a different
            // apartment) reports via HRESULT::is_err() and is a hard failure.
            unsafe {
                let hr = CoInitializeEx(None, COINIT_APARTMENTTHREADED);
                if hr.is_err() {
                    anyhow::bail!("CoInitializeEx(APARTMENTTHREADED) failed: {hr:?}");
                }
            }
            self.com_init = true;

            let uia = UiaContext::new()
                .map_err(|e| anyhow::anyhow!("UiaContext::new (UIA COM init) failed: {e}"))?;
            self.uia = Some(ThreadBoundUia::new(uia));
            self.started = true;
            Ok(())
        }

        fn poll(&mut self) -> anyhow::Result<Vec<CaptureItem>> {
            if !self.started {
                return Ok(vec![]);
            }
            let Some(uia) = self.uia.as_ref() else {
                return Ok(vec![]);
            };

            // No foreground window (locked / secure desktop / UAC prompt owns
            // the desktop) → graceful gap, not an error.
            let hwnd = unsafe { GetForegroundWindow() };
            if hwnd.is_invalid() {
                return Ok(vec![]);
            }

            let (app_name, window_title, _pid) = get_window_info(hwnd);

            // Provider couldn't be read this tick → gap, not an error.
            let Some(root) = uia.get().capture_window_tree(hwnd, MAX_ELEMENTS) else {
                return Ok(vec![]);
            };

            // Lite has no frames → url/frame_ref None. C4 secure-field
            // suppression happens structurally inside parts_to_snapshot →
            // node_to_ax (is_password → secure, content stripped downstream).
            let snap = map::parts_to_snapshot(app_name, window_title, &root, None);
            Ok(vec![CaptureItem::Snapshot(snap)])
        }

        fn stop(&mut self) {
            // Drop the COM objects before CoUninitialize.
            self.uia = None;
            if self.com_init {
                unsafe { CoUninitialize() };
                self.com_init = false;
            }
            self.started = false;
        }
    }
}

#[cfg(feature = "screenpipe")]
pub use real::WindowsUiaCapture;

// ---------------------------------------------------------------------------
// Bailing stub (default / CI / mock builds — feature off)
// ---------------------------------------------------------------------------
#[cfg(not(feature = "screenpipe"))]
mod stub {
    use crate::{CaptureItem, CaptureSource};

    pub struct WindowsUiaCapture {
        #[allow(dead_code)]
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
            // Real capture lands only with the `screenpipe` feature. Without it,
            // fail loud so a non-feature build can never silently "succeed" and
            // then produce nothing (P-CB1).
            anyhow::bail!(
                "Windows UIA capture requires the `screenpipe` feature; this build has it off"
            );
        }

        fn poll(&mut self) -> anyhow::Result<Vec<CaptureItem>> {
            Ok(vec![])
        }

        fn stop(&mut self) {
            self.started = false;
        }
    }
}

#[cfg(not(feature = "screenpipe"))]
pub use stub::WindowsUiaCapture;

// ---------------------------------------------------------------------------
// Real-capture integration test (gated: windows + screenpipe + hardware).
// Proves the adapter snapshots the actual foreground window on this machine.
// ---------------------------------------------------------------------------
#[cfg(all(test, windows, feature = "screenpipe"))]
mod real_capture_tests {
    use super::WindowsUiaCapture;
    use crate::{CaptureItem, CaptureSource};

    /// REAL on-machine capture. Constructs the adapter, starts it (COM +
    /// UIA init on this thread), polls the live foreground window a few times,
    /// and asserts at least one tick yields a Snapshot with a non-empty app
    /// name. Run with:
    ///   cargo test -p nibbin-capture --features screenpipe -- --nocapture real_foreground
    #[test]
    fn real_foreground_window_yields_snapshot() {
        let mut cap = WindowsUiaCapture::new();
        cap.start().expect("start() should init COM + UIA");

        let mut got_snapshot = false;
        let mut sample = String::new();
        for _ in 0..5 {
            let items = cap.poll().expect("poll() must not error");
            for item in items {
                if let CaptureItem::Snapshot(snap) = item {
                    if !snap.window.app.is_empty() {
                        got_snapshot = true;
                        sample = format!(
                            "app={:?} title={:?} root_role={:?} children={}",
                            snap.window.app,
                            snap.window.title,
                            snap.ax_tree.role,
                            snap.ax_tree.children.len()
                        );
                    }
                }
            }
            if got_snapshot {
                break;
            }
            std::thread::sleep(std::time::Duration::from_millis(150));
        }

        cap.stop();
        cap.stop(); // stop() must be safe to call twice.

        assert!(
            got_snapshot,
            "expected at least one real foreground-window AX snapshot with a non-empty app name"
        );
        eprintln!("REAL CAPTURE OK: {sample}");
    }
}
