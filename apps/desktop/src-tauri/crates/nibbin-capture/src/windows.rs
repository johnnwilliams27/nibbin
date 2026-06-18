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
    use crate::{CaptureItem, CaptureReadiness, CaptureSource, InputCounts};
    use screenpipe_a11y::{get_window_info, UiaContext};
    use std::sync::atomic::{AtomicU32, AtomicU64, Ordering};
    use std::sync::Arc;
    use windows::Win32::Foundation::{HINSTANCE, LPARAM, LRESULT, WPARAM};
    use windows::Win32::System::Com::{
        CoInitializeEx, CoUninitialize, COINIT_APARTMENTTHREADED,
    };
    use windows::Win32::System::Threading::GetCurrentThreadId;
    use windows::Win32::UI::WindowsAndMessaging::{
        CallNextHookEx, GetForegroundWindow, GetMessageW, PostThreadMessageW, SetWindowsHookExW,
        UnhookWindowsHookEx, HC_ACTION, HHOOK, MSG, WH_KEYBOARD_LL, WH_MOUSE_LL, WM_KEYDOWN,
        WM_LBUTTONDOWN, WM_MBUTTONDOWN, WM_QUIT, WM_RBUTTONDOWN, WM_SYSKEYDOWN,
    };

    // -----------------------------------------------------------------------
    // Input COUNT capture (SPEC §5 / C-invariant: COUNTS ONLY, never content).
    //
    // WH_KEYBOARD_LL / WH_MOUSE_LL callbacks are global `extern "system"` fns
    // that the system delivers ON THE THREAD THAT INSTALLED THE HOOK — which
    // must run a `GetMessage` pump. So a dedicated hook thread installs both
    // hooks + pumps messages; the callbacks only `fetch_add` two atomic
    // counters (they NEVER read or store WHICH key was pressed); `poll()` reads
    // deltas; `stop()` posts WM_QUIT so the thread unhooks + exits.
    // -----------------------------------------------------------------------

    /// Total key-DOWN events observed since the last `start()`. COUNT ONLY.
    static KEY_COUNT: AtomicU64 = AtomicU64::new(0);
    /// Total mouse button-DOWN events observed since the last `start()`. COUNT ONLY.
    static CLICK_COUNT: AtomicU64 = AtomicU64::new(0);

    /// Low-level keyboard hook. Increments a COUNT on key-down; never inspects,
    /// reads, logs, or stores which key it was. `lparam` (the KBDLLHOOKSTRUCT
    /// with the virtual-key code) is passed straight through to the next hook
    /// untouched — we deliberately do not dereference it.
    unsafe extern "system" fn kbd_hook(code: i32, wparam: WPARAM, lparam: LPARAM) -> LRESULT {
        if code == HC_ACTION as i32 {
            let msg = wparam.0 as u32;
            if msg == WM_KEYDOWN || msg == WM_SYSKEYDOWN {
                KEY_COUNT.fetch_add(1, Ordering::Relaxed); // COUNT ONLY — never the key
            }
        }
        CallNextHookEx(HHOOK(std::ptr::null_mut()), code, wparam, lparam)
    }

    /// Low-level mouse hook. Increments a COUNT on a button-down; nothing about
    /// position or button identity beyond "a click happened" is recorded.
    unsafe extern "system" fn mouse_hook(code: i32, wparam: WPARAM, lparam: LPARAM) -> LRESULT {
        if code == HC_ACTION as i32 {
            let msg = wparam.0 as u32;
            if msg == WM_LBUTTONDOWN || msg == WM_RBUTTONDOWN || msg == WM_MBUTTONDOWN {
                CLICK_COUNT.fetch_add(1, Ordering::Relaxed); // COUNT ONLY
            }
        }
        CallNextHookEx(HHOOK(std::ptr::null_mut()), code, wparam, lparam)
    }

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
        /// Thread id of the hook/message-pump thread (it publishes its own id
        /// here on spawn). 0 = no live hook thread. `stop()` posts WM_QUIT to it.
        hook_tid: Arc<AtomicU32>,
        /// Join handle for the hook thread; taken + joined in `stop()`.
        hook_join: Option<std::thread::JoinHandle<()>>,
        /// Last drained absolute counter values (for delta computation in poll).
        last_keys: u64,
        last_clicks: u64,
        /// When the last input burst was drained (start of the current window).
        last_input_at: Option<std::time::Instant>,
    }

    impl WindowsUiaCapture {
        pub fn new() -> Self {
            Self {
                started: false,
                com_init: false,
                uia: None,
                hook_tid: Arc::new(AtomicU32::new(0)),
                hook_join: None,
                last_keys: 0,
                last_clicks: 0,
                last_input_at: None,
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

            // Input COUNT capture: reset counters, then spawn the hook thread.
            // The LL hooks are delivered on (and must be installed from) a
            // thread running a GetMessage pump; this thread owns both hooks for
            // its whole life and unhooks itself when it gets WM_QUIT in stop().
            KEY_COUNT.store(0, Ordering::SeqCst);
            CLICK_COUNT.store(0, Ordering::SeqCst);
            self.last_keys = 0;
            self.last_clicks = 0;
            let tid = self.hook_tid.clone();
            self.hook_join = Some(std::thread::spawn(move || unsafe {
                // Publish this thread's id so stop() can PostThreadMessage WM_QUIT.
                tid.store(GetCurrentThreadId(), Ordering::SeqCst);
                // HINSTANCE is unused for WH_*_LL hooks; pass a null handle.
                // thread id 0 => global (all threads in the desktop).
                let kb = SetWindowsHookExW(
                    WH_KEYBOARD_LL,
                    Some(kbd_hook),
                    HINSTANCE(std::ptr::null_mut()),
                    0,
                )
                .ok();
                let ms = SetWindowsHookExW(
                    WH_MOUSE_LL,
                    Some(mouse_hook),
                    HINSTANCE(std::ptr::null_mut()),
                    0,
                )
                .ok();
                // Pump messages so the LL hook callbacks actually fire on this
                // thread. GetMessageW returns FALSE (0) on WM_QUIT → loop ends.
                let mut msg = MSG::default();
                while GetMessageW(&mut msg, None, 0, 0).as_bool() {
                    // LL hooks fire via the OS during this pump; no per-message
                    // dispatch needed for hook-only operation.
                }
                if let Some(h) = kb {
                    let _ = UnhookWindowsHookEx(h);
                }
                if let Some(h) = ms {
                    let _ = UnhookWindowsHookEx(h);
                }
            }));
            self.last_input_at = Some(std::time::Instant::now());

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

            let mut items: Vec<CaptureItem> = Vec::new();

            // No foreground window (locked / secure desktop / UAC prompt owns
            // the desktop) → no snapshot this tick, but input counts may still
            // have accrued, so we fall through to the input-delta drain.
            let hwnd = unsafe { GetForegroundWindow() };
            if !hwnd.is_invalid() {
                let (app_name, window_title, _pid) = get_window_info(hwnd);

                // Provider couldn't be read this tick → gap, not an error.
                if let Some(root) = uia.get().capture_window_tree(hwnd, MAX_ELEMENTS) {
                    // Lite has no frames → url/frame_ref None. C4 secure-field
                    // suppression happens structurally inside parts_to_snapshot →
                    // node_to_ax (is_password → secure, content stripped downstream).
                    let snap = map::parts_to_snapshot(app_name, window_title, &root, None);
                    items.push(CaptureItem::Snapshot(snap));
                }
            }

            // Drain input COUNTS accrued since the last poll. COUNTS ONLY — the
            // hooks never captured which key/button, only that one happened.
            let keys_now = KEY_COUNT.load(Ordering::Relaxed);
            let clicks_now = CLICK_COUNT.load(Ordering::Relaxed);
            let dk = keys_now.saturating_sub(self.last_keys);
            let dc = clicks_now.saturating_sub(self.last_clicks);
            if dk > 0 || dc > 0 {
                let now = std::time::Instant::now();
                let dur = self
                    .last_input_at
                    .map(|t| now.duration_since(t).as_millis() as u64)
                    .unwrap_or(0);
                self.last_keys = keys_now;
                self.last_clicks = clicks_now;
                self.last_input_at = Some(now);
                items.push(CaptureItem::Input(InputCounts {
                    keys: dk as u32,
                    clicks: dc as u32,
                    duration_ms: dur,
                }));
            }

            Ok(items)
        }

        fn stop(&mut self) {
            // Tear down the input hook thread first. WM_QUIT makes its
            // GetMessage pump return FALSE, so it unhooks both LL hooks and
            // exits; then we join it. Safe to call twice: tid 0 → no post,
            // hook_join None → no join.
            let tid = self.hook_tid.load(Ordering::SeqCst);
            if tid != 0 {
                unsafe {
                    let _ = PostThreadMessageW(tid, WM_QUIT, WPARAM(0), LPARAM(0));
                }
            }
            if let Some(j) = self.hook_join.take() {
                let _ = j.join();
            }
            self.hook_tid.store(0, Ordering::SeqCst);

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

// ---------------------------------------------------------------------------
// Input-COUNT self-test (gated: windows + screenpipe). Proves the LL hooks +
// poll delta logic count INJECTED keystrokes/clicks. SYNTHETIC INPUT: this
// test injects input via SendInput. Keys are harmless modifier presses
// (VK_SHIFT down/up — no character, no side effect); clicks are left
// button down/up at the current cursor position. Counts ONLY are observed:
// the hooks never record which key/button, so this test can only assert the
// COUNT increased, never any content.
// ---------------------------------------------------------------------------
#[cfg(all(test, windows, feature = "screenpipe"))]
mod input_count_tests {
    use super::WindowsUiaCapture;
    use crate::{CaptureItem, CaptureSource};
    use std::time::Duration;
    use windows::Win32::UI::Input::KeyboardAndMouse::{
        SendInput, INPUT, INPUT_0, INPUT_KEYBOARD, INPUT_MOUSE, KEYBDINPUT, KEYEVENTF_KEYUP,
        MOUSEEVENTF_LEFTDOWN, MOUSEEVENTF_LEFTUP, MOUSEINPUT, VK_SHIFT,
    };

    fn key_input(up: bool) -> INPUT {
        INPUT {
            r#type: INPUT_KEYBOARD,
            Anonymous: INPUT_0 {
                ki: KEYBDINPUT {
                    wVk: VK_SHIFT,
                    wScan: 0,
                    dwFlags: if up {
                        KEYEVENTF_KEYUP
                    } else {
                        Default::default()
                    },
                    time: 0,
                    dwExtraInfo: 0,
                },
            },
        }
    }

    fn mouse_input(up: bool) -> INPUT {
        INPUT {
            r#type: INPUT_MOUSE,
            Anonymous: INPUT_0 {
                mi: MOUSEINPUT {
                    dx: 0,
                    dy: 0,
                    mouseData: 0,
                    dwFlags: if up {
                        MOUSEEVENTF_LEFTUP
                    } else {
                        MOUSEEVENTF_LEFTDOWN
                    },
                    time: 0,
                    dwExtraInfo: 0,
                },
            },
        }
    }

    /// End-to-end: start() installs the LL hooks, SendInput injects 3 shift
    /// presses + 2 left-clicks, poll() drains a CaptureItem::Input with
    /// keys >= 3 and clicks >= 2 (>=, never ==: ambient input on the machine
    /// may add more). Proves COUNTS-ONLY capture and the poll delta logic.
    /// Run with:
    ///   cargo test -p nibbin-capture --features screenpipe -- --nocapture sendinput_counts
    #[test]
    fn sendinput_keystrokes_and_clicks_are_counted() {
        let mut cap = WindowsUiaCapture::new();
        cap.start().expect("start() should init COM + UIA + hook thread");

        // Give the hook thread time to install the hooks + start pumping.
        std::thread::sleep(Duration::from_millis(200));

        // Inject 3 keystrokes (VK_SHIFT down+up each; only DOWN counts) and
        // 2 left-clicks (down+up each; only DOWN counts). SYNTHETIC INPUT.
        let cb = std::mem::size_of::<INPUT>() as i32;
        unsafe {
            for _ in 0..3 {
                let evts = [key_input(false), key_input(true)];
                SendInput(&evts, cb);
            }
            for _ in 0..2 {
                let evts = [mouse_input(false), mouse_input(true)];
                SendInput(&evts, cb);
            }
        }

        // Let the LL hooks process the injected events.
        std::thread::sleep(Duration::from_millis(250));

        let items = cap.poll().expect("poll() must not error");
        let mut found = None;
        for item in items {
            if let CaptureItem::Input(c) = item {
                found = Some((c.keys, c.clicks, c.duration_ms));
            }
        }

        cap.stop();
        cap.stop(); // stop() must be safe to call twice.

        let (keys, clicks, dur) =
            found.expect("expected a CaptureItem::Input drained from poll() after SendInput");
        eprintln!("INPUT COUNTS OK: keys={keys} clicks={clicks} duration_ms={dur} (counts only, no key content)");
        assert!(
            keys >= 3,
            "expected >= 3 injected keystrokes counted, got {keys}"
        );
        assert!(
            clicks >= 2,
            "expected >= 2 injected clicks counted, got {clicks}"
        );
    }
}
