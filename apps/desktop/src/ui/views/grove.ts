import { button, el } from '../dom.js';

// Stage C replaces the body with the embedded web child-webview — the tab stays
// "Grove". Until that webview paints, this animated placeholder is what shows,
// so it needs to read as "loading", not "broken".
//
// `onStartStudy` is an optional callback that switches the shell to the Field
// Study tab (passed from main.ts). When provided, a subtle CTA is shown so a
// user parked on Grove can discover the field study flow without clicking the
// second tab — the Grove deep-link discovery affordance (NIB-2).
export function groveView(onStartStudy?: () => void): HTMLElement {
  const children: (HTMLElement | string)[] = [
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
  ];

  if (onStartStudy) {
    // Subtle secondary CTA: a user who never clicks the Field Study tab can
    // still discover the flow from this native fallback view. Rendered as a
    // ghost/secondary button so it doesn't compete with the Grove content.
    children.push(
      el('div', { class: 'grove-study-cta' }, [
        button('Start a field study', onStartStudy, 'secondary'),
      ]),
    );
  }

  return el('div', { class: 'grove-tab grove-loading' }, children as (Node | string)[]);
}
