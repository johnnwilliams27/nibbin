/**
 * Field Study tab — wraps the existing field-study sub-navigation and
 * daemon-state dispatch that previously lived in main.ts. Stage C adds the
 * Grove tab beside this one; account management moves to the global auth gate
 * (Stage B).
 */
import { bridge, type StudyStatus } from '../bridge.js';
import { button, el } from '../dom.js';
import { syncStudy, type SyncState } from '../sync-study.js';
import { consentView } from './consent.js';
import { notesView } from './notes.js';
import { preferencesView } from './preferences.js';
import { reviewView } from './review.js';
import { deleteEverythingCard, studyView } from './study.js';

type Sub = 'home' | 'review' | 'notes' | 'preferences';

/**
 * One-shot guard: which studies have already had their cloud sync kicked off
 * this session. Re-rendering the SYNTHESIZING view (sub-nav clicks, status
 * polls) must NOT re-fire the upload — the build→upload→advance flow runs once
 * per study and then holds on its own state. A Retry button explicitly re-arms
 * a failed study (handled inside `synthesizingView`).
 */
const syncStarted = new Set<string>();

const SYNC_COPY: Record<SyncState, string> = {
  building: 'Building your diagnosis…',
  uploading: 'Sending to Nibbin…',
  done: 'Done — your diagnosis is ready.',
  error: `Couldn't send your diagnosis. Your raw data is still here, untouched — we'll only delete it once the diagnosis is safely saved.`,
};

/**
 * SYNTHESIZING sub-view (Phase 2 cloud sync). Builds the diagnosis packet
 * on-device, uploads it Bearer-authed, and advances the study ONLY on a 200
 * (`sendControl('synthesis_complete')`) so the daemon never deletes raw data
 * before the packet is off-device (C3). Holds here on any failure with a Retry.
 */
function synthesizingView(studyId: string, rerender: () => void): HTMLElement {
  const root = el('div', {});
  let syncState: SyncState = 'building';

  function render(): void {
    root.replaceChildren(
      el('p', { class: 'eyebrow' }, ['Field study']),
      el('h1', {}, ['Building your map…']),
      el('div', { class: `card sync-card sync-${syncState}` }, [
        el('p', { class: 'sync-status' }, [SYNC_COPY[syncState]]),
        ...(syncState === 'error'
          ? [el('div', { class: 'row' }, [button('Retry', () => { kickoff(); }, 'primary')])]
          : []),
      ]),
    );
  }

  function kickoff(): void {
    void syncStudy({
      studyId,
      bridge,
      now: new Date().toISOString(),
      onState: (s) => { syncState = s; render(); },
    }).then((res) => {
      // On success the daemon advances past SYNTHESIZING; reflect that promptly.
      if (res.ok) rerender();
    });
  }

  render();
  if (!syncStarted.has(studyId)) {
    syncStarted.add(studyId);
    kickoff();
  }
  return root;
}

/**
 * Renders the "other" terminal daemon states (REVIEW, SYNTHESIZING,
 * RAW_DELETING, COMPLETE, DELETED, DAEMON_OFFLINE). Moved verbatim from
 * main.ts's `reviewStateView`, renamed `stateView`. The "Open review" button
 * calls `onOpenReview` rather than the old `setTab` so this function doesn't
 * need to close over the sub-navigation state.
 */
function stateView(status: StudyStatus, onOpenReview: () => void, rerender: () => void): HTMLElement {
  const state = status.state;
  const root = el('div', {});
  if (state === 'REVIEW') {
    root.append(
      el('p', { class: 'eyebrow' }, ['Field study']),
      el('h1', {}, ['The field study ended. Really.']),
      el('p', { class: 'muted' }, [
        `Day 14 came and the field study stopped itself — that switch lives in the background process, not this window. Look through what it kept, delete anything, then build your map when you're ready. Synthesis builds your workflow map, and the raw data on this machine is deleted and verified right after.`,
      ]),
      el('div', { class: 'card row' }, [
        button('Open review', onOpenReview, 'primary'),
        button('Build my map', () => void bridge.sendControl('finish_review').then(rerender)),
      ]),
      deleteEverythingCard(rerender),
    );
  } else if (state === 'SYNTHESIZING') {
    const study = status.study as { studyId?: string } | null;
    const studyId = study?.studyId ?? 'study';
    root.append(synthesizingView(studyId, rerender));
  } else if (state === 'RAW_DELETING') {
    root.append(
      el('p', { class: 'eyebrow' }, ['Field study']),
      el('h1', {}, ['Deleting raw data…']),
      el('p', { class: 'muted' }, [
        `After your map is built, every raw event and frame on this machine is deleted — and the deletion is verified, not assumed. You'll see the receipt.`,
      ]),
    );
  } else if (state === 'COMPLETE' || state === 'DELETED') {
    const study = status.study as { deletionReceipt?: { verified: boolean; verified_at: string } } | null;
    const receipt = study?.deletionReceipt;
    root.append(
      el('p', { class: 'eyebrow' }, ['Field study']),
      el('h1', {}, [state === 'COMPLETE' ? 'Field study complete' : 'Everything deleted']),
      el('div', { class: 'card' }, [
        el('h2', {}, ['Deletion receipt']),
        receipt
          ? el('p', {}, [
              `Store verified empty on ${receipt.verified_at.slice(0, 10)} — checked independently, not assumed. `,
              state === 'COMPLETE' ? 'Your map lives in your grove at nibbin.com.' : 'Nothing of the field study remains on this machine.',
            ])
          : el('p', { class: 'muted' }, ['Receipt pending.']),
      ]),
    );
  } else if (state === 'DAEMON_OFFLINE') {
    root.append(
      el('p', { class: 'eyebrow' }, ['Field study']),
      el('h1', {}, [`Field study isn't running`]),
      el('p', { class: 'muted' }, [
        `The background process that does the watching (and the stopping, and the deleting) is offline. Nothing records while it's down. Start it from the menu bar, or reinstall if this keeps happening.`,
      ]),
    );
  }
  return root;
}

export function fieldStudyView(rerender: () => void): HTMLElement {
  const root = el('div', {});
  let sub: Sub = 'home';
  const nav = el('nav', { class: 'nav subnav' });
  const mount = el('div', {});

  const subs: [Sub, string][] = [
    ['home', 'Field study'],
    ['review', 'Review'],
    ['notes', 'Field notes'],
    ['preferences', 'Preferences'],
  ];

  // Re-render the sub-nav each time the selection changes so the active item
  // carries aria-current (styled by `.nav button[aria-current='true']`) — a
  // clicked section stays highlighted, not just hovered.
  function renderNav(): void {
    nav.replaceChildren();
    for (const [key, label] of subs) {
      const b = button(label, () => { sub = key; renderNav(); void paint(); });
      if (key === sub) b.setAttribute('aria-current', 'true');
      nav.append(b);
    }
  }

  async function paint(): Promise<void> {
    const status: StudyStatus = await bridge.studyStatus();
    mount.replaceChildren();
    if (sub === 'review') { mount.append(reviewView()); return; }
    if (sub === 'notes') { mount.append(notesView()); return; }
    if (sub === 'preferences') { mount.append(preferencesView(() => void paint())); return; }
    switch (status.state) {
      case 'NOT_STARTED':
      case 'CONSENTED':
        mount.append(consentView(() => void paint()));
        break;
      case 'ACTIVE':
      case 'PAUSED':
        mount.append(studyView(status, () => void paint()));
        break;
      default:
        mount.append(stateView(status, () => { sub = 'review'; void paint(); }, () => void paint()));
    }
  }

  renderNav();
  root.append(nav, mount);
  void paint();
  return root;
}
