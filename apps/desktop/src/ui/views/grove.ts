import { el } from '../dom.js';
// Stage C replaces the body with the embedded web child-webview — the tab stays "Grove".
export function groveView(): HTMLElement {
  return el('div', { class: 'grove-tab' }, [
    el('h1', {}, ['Grove']),
    el('p', { class: 'muted' }, ['Connecting your grove…']),
  ]);
}
