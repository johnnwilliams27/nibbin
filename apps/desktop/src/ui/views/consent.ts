/**
 * Consent screen (SPEC §5): states captures, exclusions, exports, and
 * deletion in plain language BEFORE anything records. The claim sentences
 * track docs/INVARIANTS.md exactly — stronger phrasing than the architecture
 * supports is a claims-auditor finding.
 */
import { bridge } from '../bridge.js';
import { button, el } from '../dom.js';

export function consentView(onChanged: () => void): HTMLElement {
  const root = el('div', {}, [
    el('p', { class: 'eyebrow' }, ['Field study']),
    el('h1', {}, ['Two weeks of watching how you work — on your terms']),
    el('p', { class: 'muted' }, [
      'The field study watches how you work so your diagnosis can show where the busywork hides. ',
      'Here is the whole deal, before anything records:',
    ]),
    el('ul', { class: 'claims' }, [
      el('li', {}, [
        el('strong', {}, ['What gets captured']),
        'Which apps and windows you use, the shape of what you click and type (counts and timing — never the keys themselves), and redacted text descriptions like "Invoice {NUM} — {PERSON}".',
      ]),
      el('li', {}, [
        el('strong', {}, ['What never gets captured']),
        'Passwords can’t be captured — secure fields are blocked by the operating system flag itself. Banking, health, and personal sites are never recorded. No audio. No camera.',
      ]),
      el('li', {}, [
        el('strong', {}, ['Where it lives']),
        'Screen captures never leave your device. Everything sits in an encrypted store on this machine. Names, emails, and numbers are replaced with placeholders before anything is saved.',
      ]),
      el('li', {}, [
        el('strong', {}, ['What leaves your device']),
        'One thing, once, only if you choose to send it: a packet of redacted text descriptions of your workflows. Pixels never. You’ll see it before it goes.',
      ]),
      el('li', {}, [
        el('strong', {}, ['When it ends']),
        'The field study ends. Really. Capture stops itself on day 14 — the off switch lives in the background process, not in this window. Raw data auto-deletes after your map is built, and you can watch it verify.',
      ]),
      el('li', {}, [
        el('strong', {}, ['Your controls']),
        'Pause everything with one hotkey (⌘⇧.). Review each day and delete anything. Add "never record this" exclusions. Delete everything, at any moment, from any screen.',
      ]),
    ]),
    el('p', { class: 'muted' }, [
      'Reviewing is a right, not a chore — days you skip still count, on the same rules above.',
    ]),
  ]);

  const actions = el('div', { class: 'row' });
  actions.append(
    button(
      'I understand — start my field study',
      () => {
        void (async () => {
          await bridge.sendControl('consent');
          await bridge.sendControl('start');
          onChanged();
        })();
      },
      'primary',
    ),
    button('Not now', onChanged),
  );
  root.append(actions);
  return root;
}
