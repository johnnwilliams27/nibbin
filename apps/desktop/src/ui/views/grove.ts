import { el } from '../dom.js';
// Stage C replaces the body with the embedded web child-webview — the tab stays
// "Grove". Until that webview paints, this animated placeholder is what shows,
// so it needs to read as "loading", not "broken".
export function groveView(): HTMLElement {
  return el('div', { class: 'grove-tab grove-loading' }, [
    el(
      'div',
      { class: 'sprout-loader', role: 'status', 'aria-label': 'Connecting your grove' },
      [
        el('span', { class: 'sprout-dot' }),
        el('span', { class: 'sprout-dot' }),
        el('span', { class: 'sprout-dot' }),
      ],
    ),
    el('p', { class: 'muted loading-label' }, ['Connecting your grove…']),
  ]);
}
