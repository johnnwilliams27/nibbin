/**
 * Observer shell UI — two-tab shell: Grove (web product, Stage C) and
 * Field Study (native Observer views). Auth gate (Stage B) boots first.
 */
import '@nibbin/shared/tokens.css';
import './observer.css';
import { bridge } from './bridge.js';
import { clear, el } from './dom.js';
import { mountUpdateBanner } from './update-banner.js';
import { fieldStudyView } from './views/field-study.js';
import { groveView } from './views/grove.js';
import { loginView } from './views/login.js';
import { shouldShowDot, EVER_COMPLETED_KEY } from './tab-dot.js';

type Tab = 'grove' | 'field-study';
const app = document.getElementById('app')!;
let tab: Tab = 'grove';

let fieldStudyDotVisible = false;

/**
 * Check the daemon status once and update `fieldStudyDotVisible`.
 *
 * The dot is a first-timer nudge: shown only when the user has never completed
 * a field study (no `nibbin.fieldStudyEverCompleted` flag in localStorage) AND
 * no study is currently running. Veterans between studies are not nudged.
 *
 * Fail-closed: any error hides the dot.
 */
async function refreshTabDot(): Promise<void> {
  try {
    const everCompleted = localStorage.getItem(EVER_COMPLETED_KEY) !== null;
    const status = await bridge.studyStatus();
    fieldStudyDotVisible = shouldShowDot(everCompleted, status.state);
  } catch {
    fieldStudyDotVisible = false;
  }
}

function render(): void {
  // D6: clean up live-status listener on the outgoing field-study view before
  // clearing the DOM so it doesn't ghost-tick after a tab switch.
  const outgoing = app.querySelector('[data-view="field-study"]') as
    | (HTMLElement & { __nibbinCleanup__?: () => void })
    | null;
  outgoing?.__nibbinCleanup__?.();
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
