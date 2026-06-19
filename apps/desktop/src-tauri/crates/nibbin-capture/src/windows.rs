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
// Pure idle-logic helper — no hardware, no feature gate.
// Extracted so the 90 s threshold is unit-testable without waiting.
// ---------------------------------------------------------------------------

/// P-CB6: Returns true when the user has been idle longer than `threshold`.
/// "Idle" = no input events AND foreground window unchanged for `threshold`.
/// `last_activity = None` means "never active" → not idle (a fresh start
/// must not immediately skip the first tree walk).
///
/// Pure (no hardware) so the 90 s threshold is unit-testable without waiting.
#[cfg_attr(not(any(feature = "screenpipe", test)), allow(dead_code))]
pub(crate) fn is_idle(
    last_activity: Option<std::time::Instant>,
    now: std::time::Instant,
    threshold: std::time::Duration,
) -> bool {
    match last_activity {
        None => false,
        Some(t) => now.duration_since(t) >= threshold,
    }
}

// ---------------------------------------------------------------------------
// Real adapter (feature = "screenpipe")
// ---------------------------------------------------------------------------
#[cfg(feature = "screenpipe")]
mod real {
    use super::is_idle;
    use crate::map;
    use crate::{CaptureItem, CaptureReadiness, CaptureSource, InputCounts};
    use screenpipe_a11y::{get_window_info, AccessibilityNode, UiaContext};
    use std::sync::atomic::{AtomicU32, AtomicU64, Ordering};
    use std::sync::Arc;
    use std::time::{Duration, Instant};
    use windows::core::PCWSTR;
    use windows::Win32::Foundation::{HINSTANCE, LPARAM, LRESULT, WPARAM};
    use windows::Win32::System::Com::{CoInitializeEx, CoUninitialize, COINIT_APARTMENTTHREADED};
    use windows::Win32::System::RemoteDesktop::{
        WTSRegisterSessionNotification, WTSUnRegisterSessionNotification, NOTIFY_FOR_THIS_SESSION,
    };
    use windows::Win32::System::Threading::GetCurrentThreadId;
    use windows::Win32::UI::WindowsAndMessaging::{
        CallNextHookEx, CreateWindowExW, DestroyWindow, GetForegroundWindow, GetMessageW,
        PostThreadMessageW, SetWindowsHookExW, UnhookWindowsHookEx, HC_ACTION, HHOOK, HMENU,
        HWND_MESSAGE, MSG, WH_KEYBOARD_LL, WH_MOUSE_LL, WINDOW_EX_STYLE, WINDOW_STYLE, WM_KEYDOWN,
        WM_LBUTTONDOWN, WM_MBUTTONDOWN, WM_QUIT, WM_RBUTTONDOWN, WM_SYSKEYDOWN,
        WM_WTSSESSION_CHANGE, WTS_SESSION_LOCK, WTS_SESSION_UNLOCK,
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

    /// Recursively feed the dedup-relevant fields of an `AccessibilityNode`
    /// (and its subtree) into a `Hasher`. Mirrors what a Snapshot actually
    /// carries through redaction: `control_type`, `name`, `value`,
    /// `is_password`, plus the child structure. `bounds` is deliberately NOT
    /// hashed — it is `Option<ElementBounds>` containing `f64`, which is not
    /// `Hash`, and pixel coordinates jittering should not defeat dedup. Direct
    /// hashing (no JSON) avoids a per-tick `String` allocation and removes the
    /// `unwrap_or_default()` fallback-collision risk the serialize path had.
    fn hash_node<H: std::hash::Hasher>(n: &AccessibilityNode, h: &mut H) {
        use std::hash::Hash;
        n.control_type.hash(h);
        n.name.hash(h);
        n.value.hash(h);
        n.is_password.hash(h);
        for c in &n.children {
            hash_node(c, h);
        }
    }

    /// H1 store-size lever: a stable fingerprint of one focused-window capture
    /// (app + title + structurally-hashed accessibility tree). Two identical
    /// `(app, title, root)` inputs hash equal; any difference (including a
    /// same-tree-different-window switch) changes the hash. `poll()` skips
    /// re-emitting a Snapshot when this matches the last emitted one, so an
    /// unchanged window is not persisted every tick. Pure: no hardware, so it is
    /// unit-testable directly.
    fn tree_fingerprint(app: &str, title: &str, root: &AccessibilityNode) -> u64 {
        use std::hash::{Hash, Hasher};
        let mut s = std::collections::hash_map::DefaultHasher::new();
        app.hash(&mut s);
        title.hash(&mut s);
        // Direct structural hash of the tree — no serde_json serialization.
        hash_node(root, &mut s);
        s.finish()
    }

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
        /// Win32 thread id of the thread that ran `start()` (CoInitializeEx +
        /// UiaContext::new). COM apartment teardown (CoUninitialize + dropping
        /// the !Send UiaContext) is only sound on this same thread. 0 = not
        /// started. `stop()` checks this against the current thread before
        /// touching any COM state (LS-02).
        com_thread: u32,
        /// Thread id of the hook/message-pump thread (it publishes its own id
        /// here on spawn). 0 = no live hook thread. `stop()` posts WM_QUIT to it.
        hook_tid: Arc<AtomicU32>,
        /// Join handle for the hook thread; taken + joined in `stop()`.
        hook_join: Option<std::thread::JoinHandle<()>>,
        /// Last drained absolute counter values (for delta computation in poll).
        last_keys: u64,
        last_clicks: u64,
        /// When the last input burst was drained (start of the current window).
        last_input_at: Option<Instant>,
        // P-CB6: idle-suspend fields.
        /// Timestamp of the last detected user activity (input or focus change).
        /// Initialised to `Some(now)` in start() so a fresh start is never idle.
        last_activity: Option<Instant>,
        /// HWND value of the foreground window as of the last poll tick.
        /// A change counts as activity (wakes idle-suspend).
        last_foreground: isize,
        /// H1: fingerprint of the last EMITTED focused-window tree. When a tick's
        /// tree fingerprint matches this, the Snapshot is not re-pushed (the
        /// biggest store-size lever). `None` = nothing emitted yet / reset.
        last_tree_hash: Option<u64>,
    }

    impl WindowsUiaCapture {
        pub fn new() -> Self {
            Self {
                started: false,
                com_init: false,
                uia: None,
                com_thread: 0,
                hook_tid: Arc::new(AtomicU32::new(0)),
                hook_join: None,
                last_keys: 0,
                last_clicks: 0,
                last_input_at: None,
                last_activity: None,
                last_foreground: 0,
                last_tree_hash: None,
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
            // LS-02: record the thread that owns this COM apartment. Only this
            // thread may CoUninitialize / drop the !Send UiaContext later.
            self.com_thread = unsafe { GetCurrentThreadId() };

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
            // LS-03: the hook thread must publish its TID BEFORE start() returns,
            // otherwise a stop() that races in first sees hook_tid == 0, posts no
            // WM_QUIT, and join() blocks forever. A rendezvous sync_channel(0)
            // makes start() block on recv() until the thread has installed the
            // hooks and sent its TID (or report failure on a timeout).
            let tid = self.hook_tid.clone();
            let (tid_tx, tid_rx) = std::sync::mpsc::sync_channel::<u32>(0);
            self.hook_join = Some(std::thread::spawn(move || unsafe {
                // Publish this thread's id so stop() can PostThreadMessage WM_QUIT.
                let my_tid = GetCurrentThreadId();
                tid.store(my_tid, Ordering::SeqCst);
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
                // D4 secure-desktop lock-detection: create a MESSAGE-ONLY window
                // (HWND_MESSAGE parent) on this hook thread and register it for
                // WTS session notifications. The "Static" system class always
                // exists, so no RegisterClass is needed. A message-only window
                // receives WM_WTSSESSION_CHANGE; because LL-hook callbacks do NOT
                // go through a WndProc, we inspect `msg.message` in the pump below
                // (no WndProc/DispatchMessage needed). Failures here are
                // non-fatal: capture still works, lock-skip just won't engage.
                let mut class: Vec<u16> = "Static".encode_utf16().chain([0]).collect();
                let mut wname: Vec<u16> = "NibbinWtsSink".encode_utf16().chain([0]).collect();
                let wts_hwnd = CreateWindowExW(
                    WINDOW_EX_STYLE(0),
                    PCWSTR(class.as_mut_ptr()),
                    PCWSTR(wname.as_mut_ptr()),
                    WINDOW_STYLE(0),
                    0,
                    0,
                    0,
                    0,
                    HWND_MESSAGE,
                    HMENU(std::ptr::null_mut()),
                    HINSTANCE(std::ptr::null_mut()),
                    None,
                )
                .ok();
                if let Some(h) = wts_hwnd {
                    let _ = WTSRegisterSessionNotification(h, NOTIFY_FOR_THIS_SESSION);
                }
                // Rendezvous: hooks are installed and the TID is published, so
                // start() can safely return knowing stop() will see a live TID.
                // A send error means start() already gave up (timeout) — fall
                // through and keep pumping so stop()'s WM_QUIT still tears us down.
                let _ = tid_tx.send(my_tid);
                // Pump messages so the LL hook callbacks actually fire on this
                // thread. GetMessageW returns FALSE (0) on WM_QUIT → loop ends.
                // We also watch for WM_WTSSESSION_CHANGE (delivered to the
                // message-only window above) to flip the global screen-lock flag.
                let mut msg = MSG::default();
                while GetMessageW(&mut msg, None, 0, 0).as_bool() {
                    if msg.message == WM_WTSSESSION_CHANGE {
                        match msg.wParam.0 as u32 {
                            WTS_SESSION_LOCK => screenpipe_a11y::set_screen_locked(true),
                            WTS_SESSION_UNLOCK => screenpipe_a11y::set_screen_locked(false),
                            _ => {}
                        }
                    }
                    // LL hooks fire via the OS during this pump; no per-message
                    // dispatch needed for hook-only operation.
                }
                if let Some(h) = wts_hwnd {
                    let _ = WTSUnRegisterSessionNotification(h);
                    let _ = DestroyWindow(h);
                }
                if let Some(h) = kb {
                    let _ = UnhookWindowsHookEx(h);
                }
                if let Some(h) = ms {
                    let _ = UnhookWindowsHookEx(h);
                }
            }));

            // LS-03: block until the hook thread has installed its hooks and
            // published its TID. If it never reports (install hung / panicked),
            // surface the failure instead of returning a half-started source.
            match tid_rx.recv_timeout(Duration::from_secs(5)) {
                Ok(_) => {}
                Err(_) => {
                    // Tear down what we did set up so we don't leak the COM
                    // apartment or orphan the hook thread, then fail loudly.
                    self.stop();
                    anyhow::bail!(
                        "input hook thread did not publish its TID within 5s; capture start aborted"
                    );
                }
            }

            let now = Instant::now();
            self.last_input_at = Some(now);
            // P-CB6: initialise to now so a fresh start is never immediately idle.
            self.last_activity = Some(now);
            self.last_foreground = 0;
            // H1: no tree emitted yet → first poll always emits.
            self.last_tree_hash = None;

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

            let now = Instant::now();
            let mut items: Vec<CaptureItem> = Vec::new();

            // Read current foreground HWND + peek input deltas to decide activity.
            let hwnd = unsafe { GetForegroundWindow() };
            let hwnd_val = hwnd.0 as isize;

            // Drain input COUNTS accrued since the last poll. COUNTS ONLY — the
            // hooks never captured which key/button, only that one happened.
            let keys_now = KEY_COUNT.load(Ordering::Relaxed);
            let clicks_now = CLICK_COUNT.load(Ordering::Relaxed);
            let dk = keys_now.saturating_sub(self.last_keys);
            let dc = clicks_now.saturating_sub(self.last_clicks);

            // P-CB6: idle >90s suspends the UIA tree walk; wakes on input or focus change.
            let focus_changed = hwnd_val != self.last_foreground;
            if dk > 0 || dc > 0 || focus_changed {
                self.last_activity = Some(now);
            }
            if focus_changed {
                self.last_foreground = hwnd_val;
            }

            let idle = is_idle(self.last_activity, now, Duration::from_secs(90));

            // D4: explicit secure-desktop skip. When a WTS session-lock event
            // has flipped the global flag, NEVER walk the tree (we must not
            // capture the lock screen). Input counts may still accrue (counts
            // only), so we fall through to the input-delta drain like the
            // no-foreground / idle paths.
            let locked = screenpipe_a11y::screen_is_locked();

            // No foreground window (locked / secure desktop / UAC prompt owns
            // the desktop) → no snapshot this tick, but input counts may still
            // have accrued, so we fall through to the input-delta drain.
            // Idle → skip the expensive capture_window_tree call this tick.
            if !locked && !idle && !hwnd.is_invalid() {
                let (app_name, window_title, _pid) = get_window_info(hwnd);

                // Provider couldn't be read this tick → gap, not an error.
                if let Some(root) = uia.get().capture_window_tree(hwnd, MAX_ELEMENTS) {
                    // H1: skip re-emitting an unchanged focused-window tree (the
                    // biggest store-size lever). Fingerprint app+title+tree; if it
                    // matches the last EMITTED one, push nothing this tick. Input
                    // counts (below) are unaffected and still drain.
                    let title_ref = window_title.as_deref().unwrap_or("");
                    let h = tree_fingerprint(&app_name, title_ref, &root);
                    if self.last_tree_hash != Some(h) {
                        // Lite has no frames → url/frame_ref None. C4 secure-field
                        // suppression happens structurally inside parts_to_snapshot →
                        // node_to_ax (is_password → secure, content stripped downstream).
                        let snap = map::parts_to_snapshot(app_name, window_title, &root, None);
                        items.push(CaptureItem::Snapshot(snap));
                        self.last_tree_hash = Some(h);
                    }
                }
            }

            // Emit input counts if any accrued.
            if dk > 0 || dc > 0 {
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

        // RT-4: on resume, rebaseline the input counters to "now" so the input
        // accrued during the pause is discarded (the first post-resume poll's
        // delta then excludes pause-period keystrokes/clicks). The tree-dedup
        // baseline is also cleared so the next tree always re-emits after a gap.
        fn resume(&mut self) {
            self.last_keys = KEY_COUNT.load(Ordering::Relaxed);
            self.last_clicks = CLICK_COUNT.load(Ordering::Relaxed);
            self.last_tree_hash = None;
        }

        fn stop(&mut self) {
            if !self.started && !self.com_init && self.hook_join.is_none() {
                // Already fully torn down (idempotent no-op fast path).
                return;
            }
            let t0 = Instant::now(); // C6 teardown timing (#22)

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

            // LS-02: COM apartment teardown is only sound on the thread that ran
            // CoInitializeEx in start(). The normal daemon path (start/poll/stop
            // on one capture thread) hits the `on_com_thread` branch. If Drop
            // ever fires on a DIFFERENT thread (e.g. the struct is moved and
            // dropped elsewhere), CoUninitialize would corrupt the wrong (or no)
            // apartment and dropping the !Send UiaContext would touch COM off
            // its apartment — UB. In that case we LEAK rather than corrupt:
            // forget the UiaContext and skip CoUninitialize, with a warning.
            let on_com_thread =
                self.com_thread != 0 && unsafe { GetCurrentThreadId() } == self.com_thread;
            if self.com_init && !on_com_thread {
                eprintln!(
                    "WARNING: WindowsUiaCapture::stop() called off the COM-owning thread \
                     (created on {}, now on {}); leaking UIA context instead of corrupting \
                     the COM apartment.",
                    self.com_thread,
                    unsafe { GetCurrentThreadId() }
                );
                if let Some(uia) = self.uia.take() {
                    std::mem::forget(uia);
                }
                // Do NOT CoUninitialize off-thread. Mark torn down so we don't
                // retry; the apartment will be reclaimed when its owning thread
                // exits (or has already exited).
                self.com_init = false;
            } else {
                // On the COM-owning thread (or nothing to tear down): drop the
                // COM objects before CoUninitialize.
                self.uia = None;
                if self.com_init {
                    unsafe { CoUninitialize() };
                    self.com_init = false;
                }
            }
            self.com_thread = 0;
            self.started = false;
            // H1: drop the dedup baseline so a fresh start re-emits the first tree.
            self.last_tree_hash = None;

            // C6 reconcile (#22): log observer teardown latency so the C6 pause-
            // latency claim can be validated against a real number. The gate flip
            // itself is wait-free in nibbin-capture::gate; this measures the
            // hook-thread join + CoUninitialize portion.
            log::debug!("capture teardown took {} ms", t0.elapsed().as_millis());
        }
    }
    impl Drop for WindowsUiaCapture {
        fn drop(&mut self) {
            // Ensure COM + the hook thread are torn down even if stop() wasn't
            // called (avoids a CoUninitialize leak / orphaned hook thread on
            // unwind). stop() is idempotent: Drop-after-stop is a no-op.
            self.stop();
        }
    }

    // -----------------------------------------------------------------------
    // H1 tree-dedup unit tests — pure (no hardware), exercise the fingerprint
    // helper that poll() uses to decide whether to re-emit a Snapshot.
    // -----------------------------------------------------------------------
    #[cfg(test)]
    mod tree_dedup_tests {
        use super::{tree_fingerprint, AccessibilityNode};

        fn node(control_type: &str, name: Option<&str>) -> AccessibilityNode {
            AccessibilityNode {
                control_type: control_type.to_string(),
                name: name.map(|s| s.to_string()),
                children: vec![],
                ..Default::default()
            }
        }

        /// Two identical (app, title, tree) inputs hash equal → the second tick
        /// would be deduped (no Snapshot re-emitted).
        #[test]
        fn identical_trees_hash_equal() {
            let mut root = node("Window", Some("Root"));
            root.children = vec![node("Edit", Some("hi"))];
            let a = tree_fingerprint("notepad.exe", "Untitled - Notepad", &root);
            let b = tree_fingerprint("notepad.exe", "Untitled - Notepad", &root);
            assert_eq!(
                a, b,
                "identical input must produce an identical fingerprint"
            );
        }

        /// A changed tree → different fingerprint → a Snapshot would be emitted.
        #[test]
        fn changed_tree_hashes_differ() {
            let mut root = node("Window", Some("Root"));
            root.children = vec![node("Edit", Some("hi"))];
            let base = tree_fingerprint("notepad.exe", "Untitled - Notepad", &root);

            let mut changed = node("Window", Some("Root"));
            changed.children = vec![node("Edit", Some("bye"))];
            let after = tree_fingerprint("notepad.exe", "Untitled - Notepad", &changed);
            assert_ne!(base, after, "a changed tree must change the fingerprint");
        }

        /// Same tree, different window (app or title) → different fingerprint, so
        /// a same-tree-different-window switch still emits.
        #[test]
        fn same_tree_different_window_hashes_differ() {
            let root = node("Window", Some("Root"));
            let app_diff = tree_fingerprint("chrome.exe", "Untitled - Notepad", &root)
                != tree_fingerprint("notepad.exe", "Untitled - Notepad", &root);
            let title_diff = tree_fingerprint("notepad.exe", "A", &root)
                != tree_fingerprint("notepad.exe", "B", &root);
            assert!(app_diff, "different app must change the fingerprint");
            assert!(title_diff, "different title must change the fingerprint");
        }

        /// A secure (password) field appearing in the tree → different
        /// fingerprint, so a tick where a password box shows up is re-emitted
        /// (and gets C4 secure-field suppression downstream).
        #[test]
        fn secure_field_appearing_hashes_differ() {
            let mut base = node("Window", Some("Root"));
            base.children = vec![node("Edit", Some("user"))];

            let mut with_pw = node("Window", Some("Root"));
            let mut pw = node("Edit", Some("user"));
            pw.is_password = Some(true);
            with_pw.children = vec![pw];

            assert_ne!(
                tree_fingerprint("app.exe", "t", &base),
                tree_fingerprint("app.exe", "t", &with_pw),
                "a secure-field appearing must change the fingerprint"
            );
        }

        /// A changed `value` (e.g. text typed into a field) → different
        /// fingerprint. Guards that `value` is part of the structural hash.
        #[test]
        fn changed_value_hashes_differ() {
            let mut a = node("Edit", Some("field"));
            a.value = Some("hello".to_string());
            let mut b = node("Edit", Some("field"));
            b.value = Some("world".to_string());
            assert_ne!(
                tree_fingerprint("app.exe", "t", &a),
                tree_fingerprint("app.exe", "t", &b),
                "a changed value must change the fingerprint"
            );
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
        cap.start()
            .expect("start() should init COM + UIA + hook thread");

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

// ---------------------------------------------------------------------------
// Pure unit tests for is_idle() — no hardware, no screenpipe feature required.
// Tests the 90 s idle threshold logic without waiting for real time to pass.
// ---------------------------------------------------------------------------
#[cfg(test)]
mod idle_logic_tests {
    use super::is_idle;
    use std::time::{Duration, Instant};

    /// A fresh start (None) → never idle: the first tick should always snapshot.
    #[test]
    fn none_last_activity_is_not_idle() {
        let now = Instant::now();
        assert!(!is_idle(None, now, Duration::from_secs(90)));
    }

    /// Activity within the threshold → not idle.
    #[test]
    fn active_within_threshold_is_not_idle() {
        let now = Instant::now();
        // Simulate 45 s ago — well within 90 s window.
        let last = now - Duration::from_secs(45);
        assert!(!is_idle(Some(last), now, Duration::from_secs(90)));
    }

    /// Activity exactly at the threshold boundary → idle (>= comparison).
    #[test]
    fn exactly_at_threshold_is_idle() {
        let now = Instant::now();
        let last = now - Duration::from_secs(90);
        assert!(is_idle(Some(last), now, Duration::from_secs(90)));
    }

    /// Activity well beyond the threshold → idle.
    #[test]
    fn beyond_threshold_is_idle() {
        let now = Instant::now();
        let last = now - Duration::from_secs(200);
        assert!(is_idle(Some(last), now, Duration::from_secs(90)));
    }

    /// Custom threshold: 1 s — useful for verifying the helper with a tiny window.
    #[test]
    fn custom_threshold_one_second() {
        let now = Instant::now();
        let just_under = now - Duration::from_millis(999);
        let just_over = now - Duration::from_millis(1001);
        assert!(!is_idle(Some(just_under), now, Duration::from_secs(1)));
        assert!(is_idle(Some(just_over), now, Duration::from_secs(1)));
    }
}
