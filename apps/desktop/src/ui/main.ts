/**
 * Observer shell UI — two-tab shell: Grove (web product, Stage C) and
 * Field Study (native Observer views). Auth gate arrives in Stage B.
 */
import '@nibbin/shared/tokens.css';
import './observer.css';
import { bridge } from './bridge.js';
import { button, clear, el } from './dom.js';
import { fieldStudyView } from './views/field-study.js';
import { groveView } from './views/grove.js';

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
  app.append(tab === 'grove' ? groveView() : fieldStudyView(render));
}

render();
void bridge.onEvent('study:paused-by-hotkey', () => render());
