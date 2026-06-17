/**
 * Observer shell UI — two-tab shell: Grove (web product, Stage C) and
 * Field Study (native Observer views). Auth gate (Stage B) boots first.
 */
import '@nibbin/shared/tokens.css';
import './observer.css';
import { bridge } from './bridge.js';
import { button, clear, el } from './dom.js';
import { mountUpdateBanner } from './update-banner.js';
import { fieldStudyView } from './views/field-study.js';
import { groveView } from './views/grove.js';
import { loginView } from './views/login.js';

type Tab = 'grove' | 'field-study';
const app = document.getElementById('app')!;
let tab: Tab = 'grove';

/**
 * States where a study is actively in-progress — no nudge dot in this case.
 * The dot shows only when no study is running (NOT_STARTED, COMPLETE, DELETED,
 * DAEMON_OFFLINE, or any unrecognized state).
 *
 * Signal gap: no local "has ever completed ≥1 study" flag exists without a
 * persistent store or IPC call that doesn't yet exist. We use "no study
 * currently running" as the safest available signal — it correctly nudges
 * first-timers and is honest for returning users between studies. A future
 * improvement could suppress the dot after the first COMPLETE/DELETED is seen
 * in this session.
 */
const RUNNING_STATES = new Set([
  'CONSENTED', 'ACTIVE', 'PAUSED', 'REVIEW', 'SYNTHESIZING', 'RAW_DELETING',
]);

let fieldStudyDotVisible = false;

/**
 * Check the daemon status once and update `fieldStudyDotVisible`. Called on
 * boot and after a study completes (via the render cycle). Fire-and-forget;
 * a failure leaves the dot hidden (fail-safe over fail-open nudge).
 */
async function refreshTabDot(): Promise<void> {
  try {
    const status = await bridge.studyStatus();
    fieldStudyDotVisible = !RUNNING_STATES.has(status.state);
  } catch {
    fieldStudyDotVisible = false;
  }
}

function render(): void {
  clear(app);
  const nav = el('nav', { class: 'nav tabbar' });
  const tabs: [Tab, string][] = [['grove', 'Grove'], ['field-study', 'Field Study']];
  for (const [key, label] of tabs) {
    const isFieldStudy = key === 'field-study';
    // Build the tab label: for Field Study, wrap in a relative container so
    // we can overlay the dot without affecting layout.
    let tabContent: HTMLElement;
    if (isFieldStudy && fieldStudyDotVisible && tab !== 'field-study') {
      // Show a small needs-action dot when no study is running and the user
      // is not already on the Field Study tab (don't dot the active tab).
      const labelSpan = el('span', {}, [label]);
      const dot = el('span', { class: 'tab-dot', 'aria-label': 'Field study available' });
      tabContent = el('span', { class: 'tab-label-wrap' }, [labelSpan, dot]);
    } else {
      tabContent = el('span', {}, [label]);
    }
    const b = el('button', {});
    b.append(tabContent);
    b.addEventListener('click', () => { tab = key; render(); });
    if (key === tab) b.setAttribute('aria-current', 'true');
    nav.append(b);
  }
  app.append(nav);
  if (tab === 'grove') {
    // groveView is the native fallback (loading / offline); the embedded web
    // product is a child webview shown over the content area. Pass a callback
    // so the native fallback can offer a "Start a field study" CTA — the
    // Grove→Field Study deep-link discovery affordance (NIB-2).
    app.append(groveView(() => { tab = 'field-study'; render(); }));
    void bridge.groveShow();
  } else {
    void bridge.groveHide();
    app.append(fieldStudyView(render));
    // Once the user opens the Field Study tab, hide the dot immediately.
    fieldStudyDotVisible = false;
  }
}

async function boot(): Promise<void> {
  // A keychain/IPC failure must never blank the whole window: fall back to the
  // signed-out screen so the user can re-authenticate. (Regression guard — an
  // oversized session writeback once threw here and left the window blank.)
  let session: Awaited<ReturnType<typeof bridge.authSession>> = null;
  try {
    session = await bridge.authSession();
  } catch (e) {
    console.error('authSession failed; showing login', e);
  }
  if (!session) { void bridge.groveHide(); clear(app); app.append(loginView(() => void boot())); return; }
  // Warm the tab dot before painting the tabbar so first render is correct.
  await refreshTabDot();
  render();
}

// The native shell calls this (via webview.eval) when the embedded Grove web app
// signs out — the native session has already been cleared, so re-booting drops
// to the login gate (clearing the tab bar + hiding the Grove webview).
(window as unknown as { __nibbinSignedOut__?: () => void }).__nibbinSignedOut__ = () => {
  void boot();
};

void boot();
// Account-agnostic, non-blocking: check once on boot whether a newer build
// exists and, if so, show a dismissable banner. The network call is native
// (Rust); a failure is silent (no banner).
void mountUpdateBanner();
void bridge.onEvent('study:paused-by-hotkey', () => render());
