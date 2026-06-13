/**
 * Preferences — one place for the device-level controls that were scattered
 * across Study / Review / Account. Account-level settings (plan, password,
 * profile) deliberately live in the web app; this surface points there.
 *
 * This is shared shell UI: it renders identically on macOS and Windows.
 */
import { bridge } from '../bridge.js';
import { button, el } from '../dom.js';
import { deleteEverythingCard } from './study.js';

export function preferencesView(onChanged: () => void): HTMLElement {
  const root = el('div', {}, [
    el('p', { class: 'eyebrow' }, ['Preferences']),
    el('h1', {}, ['Preferences']),
    el('p', { class: 'muted' }, [
      'Everything here stays on this machine. It changes what the Observer keeps — never what has already left your device, because nothing leaves until you build your map.',
    ]),
  ]);

  // ---- Exclusions: "never record this again" ----
  const input = el('input', {
    type: 'text',
    placeholder: 'App name or website — e.g. Banking, mybank.com',
  }) as HTMLInputElement;
  const note = el('p', { class: 'muted' }, ['']);
  const addBtn = button('Never record this', () => {
    const value = input.value.trim();
    if (!value) return;
    // A dotted, space-free token reads as a hostname; anything else is an app name.
    const isHost = value.includes('.') && !value.includes(' ');
    void bridge.addExclusion(isHost ? { host: value } : { appName: value }).then(() => {
      note.textContent = `Got it — “${value}” won’t be recorded again.`;
      input.value = '';
    });
  });
  root.append(
    el('div', { class: 'card' }, [
      el('h2', {}, ['Never record this']),
      el('p', { class: 'muted' }, [
        'Add an app or website the Observer should always skip. You can also exclude things as you spot them on the Review screen.',
      ]),
      el('div', { class: 'row' }, [input, addBtn]),
      note,
    ]),
  );

  // ---- Pointer to captured data (Review owns the detail) ----
  root.append(
    el('div', { class: 'card' }, [
      el('h2', {}, ['Your captured data']),
      el('p', { class: 'muted' }, [
        'Review everything the Observer has kept — and delete any of it — on the Review screen. Pauses show up there as visible gaps, never hidden.',
      ]),
    ]),
  );

  // ---- Always-reachable delete (shared with the study view) ----
  root.append(deleteEverythingCard(onChanged));

  // ---- Account-level settings live on the web ----
  root.append(
    el('div', { class: 'card' }, [
      el('h2', {}, ['Account settings']),
      el('p', { class: 'muted' }, [
        'Your plan, password, and profile live at nibbin.com/app/settings — same account, same rules. Changing them there never reaches into this computer.',
      ]),
    ]),
  );

  return root;
}
