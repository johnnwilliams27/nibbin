/**
 * Local Field Notes — computed on this machine from already-redacted events,
 * rendered here, uploaded nowhere (C1/C7).
 */
import { computeFieldNotes, studyDaysWithActivity } from '../../core/field-notes.js';
import { bridge } from '../bridge.js';
import { clear, el } from '../dom.js';

function minutes(ms: number): string {
  return `${Math.round(ms / 60_000)}m`;
}

export function notesView(): HTMLElement {
  const root = el('div', {}, [
    el('p', { class: 'eyebrow' }, ['Field notes']),
    el('h1', {}, ['Today’s field notes']),
    el('p', { class: 'muted' }, ['Counted on this machine, shown on this machine. Nothing here is uploaded.']),
  ]);
  const body = el('div', {}, [el('p', { class: 'muted' }, ['Counting…'])]);
  root.append(body);

  void (async () => {
    const events = await bridge.reviewEvents();
    clear(body);
    const days = studyDaysWithActivity(events);
    if (days.length === 0) {
      body.append(el('div', { class: 'card' }, [el('p', { class: 'muted' }, ['No activity captured yet — notes appear after the Observer’s first day of watching.'])]));
      return;
    }
    const today = days[days.length - 1]!;
    const notes = computeFieldNotes(events, today);

    body.append(
      el('div', { class: 'card' }, [
        el('div', { class: 'stat-grid' }, [
          el('div', { class: 'stat' }, [el('div', { class: 'value' }, [String(notes.eventCount)]), el('div', { class: 'label' }, ['Moments noticed'])]),
          el('div', { class: 'stat' }, [el('div', { class: 'value' }, [minutes(notes.activeMs)]), el('div', { class: 'label' }, ['Hands-on time'])]),
          el('div', { class: 'stat' }, [el('div', { class: 'value' }, [String(notes.gapCount)]), el('div', { class: 'label' }, ['Pauses (your call)'])]),
          el('div', { class: 'stat' }, [el('div', { class: 'value' }, [String(days.length)]), el('div', { class: 'label' }, ['Study days so far'])]),
        ]),
      ]),
    );

    if (notes.topApps.length > 0) {
      const apps = el('div', { class: 'card' }, [el('h2', {}, ['Where the day went'])]);
      for (const app of notes.topApps) {
        apps.append(
          el('div', { class: 'event-row' }, [
            el('span', { class: 'time' }, [minutes(app.durationMs)]),
            el('span', {}, [app.name]),
            el('span', { class: 'chip' }, [`${app.events} moments`]),
          ]),
        );
      }
      body.append(apps);
    }
  })();

  return root;
}
