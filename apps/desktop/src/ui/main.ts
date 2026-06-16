/**
 * Observer shell UI — two-tab shell: Grove (web product, Stage C) and
 * Field Study (native Observer views). Auth gate (Stage B) boots first.
 */
import '@nibbin/shared/tokens.css';
import './observer.css';
import { bridge } from './bridge.js';
import { button, clear, el } from './dom.js';
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
  const session = await bridge.authSession();
  if (!session) { void bridge.groveHide(); clear(app); app.append(loginView(() => void boot())); return; }
  render();
}

void boot();
void bridge.onEvent('study:paused-by-hotkey', () => render());
