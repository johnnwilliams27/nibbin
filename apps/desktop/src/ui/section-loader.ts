/**
 * Shared section-level loading indicator for Field Study sub-views.
 *
 * Reuses the `.sprout-loader` / `.sprout-dot` CSS already defined for the
 * Grove tab, so "loading" reads as "growing" rather than "stalled" —
 * consistent with Grove's polish (NIB-7 §3.3 item 5).
 */
import { el } from './dom.js';

/**
 * Returns a small animated sprout-loader row with an accessible label.
 * Drop-in replacement for bare muted-text "Loading…" / "Counting…" placeholders.
 */
export function sectionLoader(label: string): HTMLElement {
  return el('div', { class: 'section-loading', role: 'status', 'aria-label': label }, [
    el('span', { class: 'sprout-loader' }, [
      el('span', { class: 'sprout-dot' }),
      el('span', { class: 'sprout-dot' }),
      el('span', { class: 'sprout-dot' }),
    ]),
    el('span', {}, [label]),
  ]);
}
