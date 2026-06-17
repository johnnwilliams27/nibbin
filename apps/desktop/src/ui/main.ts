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

function render(): void {
  clear(app);
  const nav = el('nav', { class: 'nav tabbar' });
  const tabs: [Tab, string][] = [['grove', 'Grove'], ['field-study', 'Field Study']];
  for (const [key, label] of tabs) {
    const b = button(label, () => { tab = key; render(); });
    if (key === tab) b.setAttribute('aria-current', 'true');
    nav.append(b);
  }
  app.append(nav);
  if (tab === 'grove') {
    // groveView is the native fallback (loading / offline); the embedded web
    // product is a child webview shown over the content area.
    app.append(groveView());
    void bridge.groveShow();
  } else {
    void bridge.groveHide();
    app.append(fieldStudyView(render));
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
