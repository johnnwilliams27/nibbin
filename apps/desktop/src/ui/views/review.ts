/**
 * End-of-day review (layer 4) — a right, not a chore. Delete blocks (an
 * event, an hour, a whole app), add "never record this again" exclusions.
 * Everything shown here is already redacted; this screen exists so the user
 * can disagree with what the machine kept.
 */
import type { ObserverEvent } from '@nibbin/redaction';
import { bridge } from '../bridge.js';
import { button, clear, el } from '../dom.js';
import { sectionLoader } from '../section-loader.js';

function describe(event: ObserverEvent): string {
  const ax = event.ax ? ` · ${event.ax.label_redacted || event.ax.role_path}` : '';
  const url = event.url ? ` · ${event.url.host}${event.url.path_template}` : '';
  return `${event.window.title_redacted || '(no title)'}${ax}${url}`;
}

export function reviewView(): HTMLElement {
  const root = el('div', {}, [
    el('div', { class: 'section-header' }, [
      el('p', { class: 'eyebrow' }, ['Review']),
      el('h1', {}, ['What the field study kept today']),
    ]),
    el('p', { class: 'muted' }, [
      'Everything below is already redacted — names, emails, and numbers became placeholders before anything was saved. Delete whatever you like; deleted blocks never reach your diagnosis.',
    ]),
  ]);
  const list = el('div', { class: 'card' }, [sectionLoader('Loading events…')]);
  root.append(list);

  const exclusionCard = el('div', { class: 'card' }, [
    el('h2', {}, ['Never record this again']),
    el('p', { class: 'muted' }, ['Add a site or app and the field study drops it before anything is saved — same as banking and health sites.']),
  ]);
  const input = el('input', { type: 'text', placeholder: 'app name or site, e.g. journal.example.com' });
  exclusionCard.append(
    el('div', { class: 'row' }, [
      input,
      button('Add exclusion', () => {
        const value = input.value.trim();
        if (!value) return;
        const exclusion = value.includes('.') ? { host: value } : { appName: value };
        void bridge.addExclusion(exclusion).then(() => {
          input.value = '';
        });
      }),
    ]),
  );
  root.append(exclusionCard);

  async function refresh(): Promise<void> {
    const events = await bridge.reviewEvents();
    clear(list);
    if (events.length === 0) {
      list.append(
        el('div', { class: 'empty-state' }, [
          el('p', { class: 'muted' }, ['No events kept yet — your review fills up as the study runs.']),
          el('p', { class: 'muted' }, ['Come back after a few minutes of activity and this list will populate.']),
        ]),
      );
      return;
    }

    const byApp = new Map<string, ObserverEvent[]>();
    for (const event of events) {
      const bucket = byApp.get(event.app.name) ?? [];
      bucket.push(event);
      byApp.set(event.app.name, bucket);
    }

    for (const [app, appEvents] of byApp) {
      const header = el('div', { class: 'row' }, [
        el('h2', {}, [app]),
        el('span', { class: 'chip' }, [`${appEvents.length} moments`]),
      ]);
      header.append(
        button('Delete all from this app', () => {
          void bridge.reviewDelete(appEvents.map((e) => e.id)).then(refresh);
        }, 'danger'),
      );
      list.append(header);
      for (const event of appEvents.slice(0, 50)) {
        const row = el('div', { class: 'event-row' }, [
          el('span', { class: 'time' }, [event.ts.slice(11, 16)]),
          el('span', {}, [describe(event)]),
        ]);
        row.append(
          button('Delete', () => {
            void bridge.reviewDelete([event.id]).then(refresh);
          }),
        );
        list.append(row);
      }
      if (appEvents.length > 50) {
        list.append(el('p', { class: 'muted' }, [`…and ${appEvents.length - 50} more from ${app}.`]));
      }
    }
  }

  void refresh();
  return root;
}
