import { button, el } from '../dom.js';

// The native loading/offline placeholder shown beneath the Grove child webview
// while it paints or if nibbin.com is unreachable. The child webview covers
// this element once it loads — so under normal conditions the user sees this
// only briefly. If the web app fails to load (offline/network error) this
// placeholder stays visible and must communicate that clearly.
//
// `onRetry` is called when the user taps Retry — callers should re-invoke the
// boot/groveShow path so the webview attempts to reload.
export function groveView(onRetry: () => void): HTMLElement {
  const children: (HTMLElement | string)[] = [
    el(
      'div',
      { class: 'sprout-loader', role: 'status', 'aria-label': 'Connecting to Nibbin' },
      [
        el('span', { class: 'sprout-dot' }),
        el('span', { class: 'sprout-dot' }),
        el('span', { class: 'sprout-dot' }),
      ],
    ),
    el('p', { class: 'muted loading-label' }, ['Connecting to Nibbin…']),
    el('p', { class: 'muted offline-note' }, [
      "Can't reach Nibbin — capture is still running in the background.",
    ]),
    el('div', { class: 'grove-retry' }, [
      button('Retry', onRetry, 'secondary'),
    ]),
  ];

  return el('div', { class: 'grove-tab grove-loading' }, children as (Node | string)[]);
}
