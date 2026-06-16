/**
 * Best-effort "an update is available" banner. Pinned to the top of the window,
 * outside the #app render root (so the tab re-renders never disturb or
 * duplicate it). Non-blocking, dismissable, and shown at most once per session.
 *
 * The version check itself runs natively in Rust (bridge.checkForUpdate →
 * the GitHub call); this module only renders the result. The "Update" button
 * opens the public download page in the system browser (bridge.openExternal),
 * never inside the pinned webview.
 */
import { bridge } from './bridge.js';
import { button, el } from './dom.js';

// Show the banner at most once per app session, even if boot re-runs.
let shown = false;

export async function mountUpdateBanner(): Promise<void> {
  if (shown) return;
  const info = await bridge.checkForUpdate();
  if (!info.update_available || shown) return;
  shown = true;

  const label = info.latest_version
    ? `Nibbin ${info.latest_version} is available`
    : 'A new version of Nibbin is available';

  const banner = el('div', { class: 'update-banner', role: 'status' });

  const text = el('span', { class: 'update-banner-text' }, [label]);

  const updateBtn = button('Update', () => {
    void bridge.openExternal(info.download_url);
  }, 'primary');

  const dismiss = button('×', () => banner.remove(), 'update-banner-dismiss');
  dismiss.setAttribute('aria-label', 'Dismiss');
  dismiss.setAttribute('title', 'Dismiss');

  banner.append(text, updateBtn, dismiss);
  // Prepend so it sits above the shell content for the rest of the session.
  document.body.insertBefore(banner, document.body.firstChild);
}
