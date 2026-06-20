/**
 * Observer shell UI — full-window web app. Auth gate (native) boots first,
 * then the Grove child webview covers the entire window. The native Field Study
 * UI has been removed; the web app (including /app/study/*) is the complete UI.
 */
import '@nibbin/shared/tokens.css';
import './observer.css';
import { bridge } from './bridge.js';
import { clear } from './dom.js';
import { mountUpdateBanner } from './update-banner.js';
import { groveView } from './views/grove.js';
import { loginView } from './views/login.js';
import { reportStudyStatus } from './study-status-reporter.js';

const app = document.getElementById('app')!;

/**
 * Fetch study status once and report to the web if the study has left the
 * active phase. This also fires the stopped-reporter so a study that ended
 * while the app was closed tells the web immediately on next open.
 * Fail-closed: any IPC error is swallowed silently.
 */
async function fetchAndReportStudyStatus(): Promise<void> {
  try {
    const status = await bridge.studyStatus();
    void reportStudyStatus(status);
  } catch {
    // IPC can transiently fail (daemon restart) — skip silently.
  }
}

async function boot(): Promise<void> {
  // A keychain/IPC failure must never blank the whole window: fall back to the
  // signed-out screen so the user can re-authenticate.
  let session: Awaited<ReturnType<typeof bridge.authSession>> = null;
  try {
    session = await bridge.authSession();
  } catch (e) {
    console.error('authSession failed; showing login', e);
  }
  if (!session) {
    clear(app);
    app.append(loginView(() => void boot()));
    return;
  }

  // Boot-time fetch: catches a study that ended while the app was closed and
  // posts the stopped signal so the web card reflects reality immediately.
  void fetchAndReportStudyStatus();

  // Show the native loading/offline placeholder under the grove webview, then
  // bring the grove child webview to the front (full-window, no tab bar).
  clear(app);
  app.append(groveView(() => void boot()));
  void bridge.groveShow();
  startStudyStatusPoll();
}

let studyStatusPollStarted = false;

/**
 * Modest recurring poll (every ~50s) so a stop that happens while the app is
 * open is reported promptly. Boot's own fetch catches a stop that happened
 * while the app was closed. Local IPC, so this is cheap. Started once.
 */
function startStudyStatusPoll(): void {
  if (studyStatusPollStarted) return;
  studyStatusPollStarted = true;
  setInterval(() => {
    void fetchAndReportStudyStatus();
  }, 50_000);
}

// The native shell calls this (via webview.eval) when the embedded Grove web app
// signs out — the native session has already been cleared, so re-booting drops
// to the login gate (hiding the Grove webview by clearing the DOM and re-running
// the auth gate).
(window as unknown as { __nibbinSignedOut__?: () => void }).__nibbinSignedOut__ = () => {
  void boot();
};

void boot();
// Account-agnostic, non-blocking: check once on boot whether a newer build
// exists and, if so, show a dismissable banner. The network call is native
// (Rust); a failure is silent (no banner).
void mountUpdateBanner();
