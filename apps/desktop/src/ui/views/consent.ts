/**
 * Consent screen (SPEC §5): states captures, exclusions, exports, and
 * deletion in plain language BEFORE anything records. The claim sentences
 * track docs/INVARIANTS.md exactly — stronger phrasing than the architecture
 * supports is a claims-auditor finding.
 */
import { bridge } from '../bridge.js';
import type { StudyKind, StudyDepth } from '../../core/study-machine.js';
import { button, el } from '../dom.js';

export function consentView(onChanged: () => void, kind: StudyKind = 'full_study', depth: StudyDepth = 'lite'): HTMLElement {
  // The "When it ends" claim is the only line that differs by kind: a quick
  // scan is user-stopped with a short backstop, not the 14-day C2 hard stop.
  const whenItEnds =
    kind === 'quick_scan'
      ? 'This scan stops the moment you tell it to — or after a few hours if you forget. Raw data auto-deletes after your map is built.'
      : 'The field study ends. Really. Capture stops itself on day 14 — the off switch lives in the background process, not in this window. Raw data auto-deletes after your map is built, and you can watch it verify.';

  // "What gets captured" differs by depth: Lite reads structure only (no
  // screenshots); Detailed also takes periodic screenshots, processed on-device
  // then deleted — only redacted text informs the diagnosis.
  // NOTE: the Detailed branch is depth-aware and retained for when Detailed ships.
  // The picker currently locks selection to 'lite', so this branch won't trigger
  // in practice — but the plumbing stays correct. Copy uses future tense (“will
  // add…”) so it makes no false present-tense capture promise (gate CA-01).
  const whatGetsCaptured =
    depth === 'detailed'
      ? 'Which apps and windows you use, the shape of what you click and type (counts and timing — never the keys themselves), redacted text descriptions like “Invoice {NUM} — {PERSON}”, and (when Detailed is fully available) periodic screenshots that will be processed by on-device OCR then deleted — only the redacted text will inform your diagnosis. Will require Screen Recording permission.'
      : 'Which apps and windows you use, the shape of what you click and type (counts and timing — never the keys themselves), and redacted text descriptions like “Invoice {NUM} — {PERSON}”. No screenshots.';

  // D5: h1 and intro differ by kind — a quick scan is not a two-week study.
  const isQuickScan = kind === 'quick_scan';
  const heading = isQuickScan
    ? 'A quick scan of one task — on your terms'
    : 'Two weeks of watching how you work — on your terms';
  const intro = isQuickScan
    ? [
        'Nibbin will watch just this one task so it can map the workflow — nothing else. ',
        'Here is the whole deal, before anything records:',
      ]
    : [
        'The field study watches how you work so your diagnosis can show where the busywork hides. ',
        'Here is the whole deal, before anything records:',
      ];

  const root = el('div', {}, [
    el('p', { class: 'eyebrow' }, [isQuickScan ? 'Quick scan' : 'Field study']),
    el('h1', {}, [heading]),
    el('p', { class: 'muted' }, intro),
    el('ul', { class: 'claims' }, [
      el('li', {}, [
        el('strong', {}, ['What gets captured']),
        whatGetsCaptured,
      ]),
      el('li', {}, [
        el('strong', {}, ['What never gets captured']),
        'Passwords can’t be captured — secure fields are blocked by the operating system flag itself. Banking, health, and personal sites are never recorded. No audio. No camera.',
      ]),
      el('li', {}, [
        el('strong', {}, ['Where it lives']),
        'Everything sits in an encrypted store on this machine. Names, emails, and numbers are replaced with placeholders before anything is saved. Pixels never leave your device.',
      ]),
      el('li', {}, [
        el('strong', {}, ['What leaves your device']),
        'One thing, once, only if you choose to send it: a packet of redacted text descriptions of your workflows. Pixels never. You’ll see it before it goes.',
      ]),
      el('li', {}, [
        el('strong', {}, ['When it ends']),
        whenItEnds,
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

  const depthLabel = depth === 'detailed' ? 'Detailed' : 'Lite';
  const confirmLabel = kind === 'quick_scan'
    ? ('I understand — start my scan (' + depthLabel + ')')
    : ('I understand — start my field study (' + depthLabel + ')');
  const actions = el('div', { class: 'row' });
  actions.append(
    button(
      confirmLabel,
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
