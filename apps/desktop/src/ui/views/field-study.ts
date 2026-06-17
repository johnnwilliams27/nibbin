/**
 * Field Study tab — wraps the existing field-study sub-navigation and
 * daemon-state dispatch that previously lived in main.ts. Stage C adds the
 * Grove tab beside this one; account management moves to the global auth gate
 * (Stage B).
 */
import { bridge, type StudyStatus } from '../bridge.js';
import type { StudyKind } from '../../core/study-machine.js';
import { button, el } from '../dom.js';
import { syncStudy, type SyncState } from '../sync-study.js';
import { consentView } from './consent.js';
import { notesView } from './notes.js';
import { preferencesView } from './preferences.js';
import { reviewView } from './review.js';
import { deleteEverythingCard, studyView } from './study.js';
import { viewForState } from './field-study-state.js';

type Sub = 'home' | 'review' | 'notes' | 'preferences';

/**
 * Per-study sync state that survives re-mounts of the SYNTHESIZING view (sub-nav
 * clicks, status polls). The upload's build→upload→advance flow runs ONCE per
 * study (kicked off the first time we see it); thereafter a re-mount seeds its
 * displayed state from this map instead of re-firing the upload. The presence of
 * a key means "already started" — so a re-mount whose original onState closure is
 * gone must still offer a Retry rather than strand on a non-interactive spinner.
 */
const syncStates = new Map<string, SyncState>();

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
function synthesizingView(
  studyId: string,
  meta: { kind?: 'full_study' | 'quick_scan'; label?: string | null },
  rerender: () => void,
): HTMLElement {
  const root = el('div', {});
  // First mount: start at 'building'. Re-mount of an already-started study:
  // seed from the persisted state so we never reset a live upload back to a
  // dead spinner. `resumed` flags a re-mount whose original onState closure is
  // gone — those must always offer Retry even outside the 'error' state.
  const persisted = syncStates.get(studyId);
  const resumed = persisted !== undefined;
  let syncState: SyncState = persisted ?? 'building';

  function setState(s: SyncState): void {
    syncState = s;
    syncStates.set(studyId, s);
    render();
  }

  function render(): void {
    // Retry is reachable on any non-'done' state of a re-mounted (resumed)
    // study, and on 'error' for the live first mount. Never strand on a
    // non-interactive spinner.
    const showRetry = syncState === 'error' || (resumed && syncState !== 'done');
    root.replaceChildren(
      el('p', { class: 'eyebrow' }, ['Field study']),
      el('h1', {}, ['Building your map…']),
      el('div', { class: `card sync-card sync-${syncState}` }, [
        el('p', { class: 'sync-status' }, [SYNC_COPY[syncState]]),
        ...(showRetry
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
      kind: meta.kind,
      label: meta.label,
      onState: (s) => { setState(s); },
    }).then((res) => {
      // On success the daemon advances past SYNTHESIZING; reflect that promptly.
      if (res.ok) rerender();
    });
  }

  render();
  if (!resumed) {
    // First time we've seen this study this session — arm the one-shot upload.
    syncStates.set(studyId, syncState);
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
    const study = status.study as
      | { studyId?: string; kind?: 'full_study' | 'quick_scan'; label?: string | null }
      | null;
    const studyId = study?.studyId?.trim();
    if (!studyId) {
      // A placeholder id would become the DB upsert key and could silently
      // overwrite another study's diagnosis. Refuse to sync without a real id.
      root.append(
        el('p', { class: 'eyebrow' }, ['Field study']),
        el('h1', {}, ['Building your map…']),
        el('div', { class: 'card sync-card sync-error' }, [
          el('p', { class: 'sync-status' }, [
            `Couldn't read this study's id — nothing was sent. Your raw data is still here, untouched. Restart the app and try again.`,
          ]),
        ]),
      );
      return root;
    }
    root.append(synthesizingView(studyId, { kind: study?.kind, label: study?.label }, rerender));
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
  }
  return root;
}

/**
 * Small daemon-health note shown beneath entry cards when the daemon is
 * (still) offline. Keeps guidance accessible without blocking the start flow.
 * The Retry button re-polls studyStatus(); onRetry resolves to the latest
 * status string so the caller can decide whether to hide this note.
 */
function daemonHealthNote(onRetry: () => void): HTMLElement {
  return el('div', { class: 'card daemon-health-note' }, [
    el('p', { class: 'eyebrow' }, ['Background watcher']),
    el('p', { class: 'muted' }, [
      `The background process isn't reporting yet — it may still be starting up. You can start a study now; it will run when the watcher comes online.`,
    ]),
    el('p', { class: 'muted' }, [
      `If this keeps showing, start it from the menu bar or reinstall.`,
    ]),
    el('div', { class: 'row' }, [button('Retry', onRetry)]),
  ]);
}

/**
 * Entry choices, shown when no study is capturing (NOT_STARTED) or the last one
 * reached a terminal state (COMPLETE/DELETED), AND now also when the daemon is
 * offline or in an unrecognized state (NIB-2 fix): begin a fresh 14-day field
 * study, or quick-scan a single task right now. Both mint a fresh study id+kind+label
 * via `createStudy` (valid from NOT_STARTED and terminal states), THEN run the
 * consent→start flow — so the chosen kind/label rides through to the diagnosis.
 *
 * When `showDaemonNote` is true a secondary health note appears beneath the
 * entry cards to give honest daemon status without hiding the start actions.
 */
function entryView(onChanged: () => void, showDaemonNote = false): HTMLElement {
  const root = el('div', {});
  const mount = el('div', {});

  // Mint the study, then hand off to the consent screen for this kind. Consent
  // fires `consent`+`start` itself; the daemon's `create_study` reset clears any
  // prior study's store so the new capture starts empty.
  function begin(kind: StudyKind, label: string | null): void {
    void bridge.createStudy(crypto.randomUUID(), kind, label).then(() => {
      mount.replaceChildren(consentView(onChanged, kind));
    });
  }

  function renderChoices(): void {
    const fullCard = el('div', { class: 'card' }, [
      el('h2', {}, ['Start a 14-day field study']),
      el('p', { class: 'muted' }, [
        'The full picture: two weeks of watching how you work, then a diagnosis of where the busywork hides.',
      ]),
    ]);
    fullCard.append(
      el('div', { class: 'row' }, [
        button('Start 14-day field study', () => begin('full_study', null), 'primary'),
      ]),
    );

    const scanInput = el('input', {
      type: 'text',
      maxlength: '80',
      placeholder: 'e.g. Sending this month’s invoices',
    }) as HTMLInputElement;
    const scanCard = el('div', { class: 'card' }, [
      el('h2', {}, ['Quick scan a task']),
      el('p', { class: 'muted' }, [
        'Just want one workflow mapped? Tell it what you’re about to do, work through it, then stop the scan — same redaction, same on-device deletion.',
      ]),
      el('label', { class: 'eyebrow scan-label' }, ['What are you about to do?']),
      el('div', { class: 'row scan-row' }, [
        scanInput,
        button(
          'Start quick scan',
          () => {
            const label = scanInput.value.trim().slice(0, 80);
            if (!label) { scanInput.focus(); return; }
            begin('quick_scan', label);
          },
          'primary',
        ),
      ]),
    ]);

    const children: HTMLElement[] = [fullCard, scanCard];
    if (showDaemonNote) {
      children.push(daemonHealthNote(onChanged));
    }
    mount.replaceChildren(...children);
  }

  renderChoices();
  root.append(
    el('p', { class: 'eyebrow' }, ['Field study']),
    el('h1', {}, ['How do you want to start?']),
    mount,
  );
  return root;
}

/**
 * Capturing card for a quick scan in ACTIVE: no 14-day countdown — a quick scan
 * is user-stopped, with a 6-hour backstop. Shows the task label, a "capturing"
 * chip, the auto-stop note, and a "Stop scan" button (`stop_early`). The full
 * study keeps its countdown UI in `studyView`.
 */
function quickScanView(status: StudyStatus, onChanged: () => void): HTMLElement {
  const study = status.study as { label?: string | null } | null;
  const label = study?.label?.trim();
  const paused = status.state === 'PAUSED' || status.paused === true;

  const root = el('div', {}, [
    el('p', { class: 'eyebrow' }, ['Quick scan']),
    el('h1', {}, [label ? label : 'Quick scan underway']),
    el('div', { class: 'card' }, [
      el('div', { class: 'row' }, [
        el('div', {}, [
          el('p', { class: 'eyebrow' }, ['Status']),
          el('p', { class: 'sync-status' }, [paused ? 'Paused' : 'Capturing…']),
        ]),
        el('span', { class: `chip ${paused ? 'warn' : 'active'}` }, [paused ? 'Paused' : 'Capturing']),
      ]),
      el('p', { class: 'muted' }, [
        'Work through the task, then stop the scan when you’re done. It also stops automatically after 6 hours, so an abandoned scan can’t keep capturing.',
      ]),
    ]),
  ]);

  const controls = el('div', { class: 'card' }, [el('h2', {}, ['Controls'])]);
  controls.append(
    el('div', { class: 'row' }, [
      button('Stop scan', () => void bridge.sendControl('stop_early').then(onChanged), 'primary'),
    ]),
  );
  root.append(controls, deleteEverythingCard(onChanged));
  return root;
}

/**
 * Poll `studyStatus()` up to `maxAttempts` times with `delayMs` between each
 * attempt. Stops early and returns the first non-DAEMON_OFFLINE status, or
 * returns the last (still DAEMON_OFFLINE) status after all attempts. This
 * distinguishes a cold-starting daemon (first-paint race) from one that is
 * genuinely offline — without changing any Rust code.
 */
async function pollUntilOnline(
  maxAttempts: number,
  delayMs: number,
): Promise<StudyStatus> {
  let status = await bridge.studyStatus();
  for (let i = 1; i < maxAttempts && status.state === 'DAEMON_OFFLINE'; i++) {
    await new Promise<void>((r) => setTimeout(r, delayMs));
    status = await bridge.studyStatus();
  }
  return status;
}

export function fieldStudyView(_rerender: () => void): HTMLElement {
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

  /**
   * Dispatches to the correct sub-view based on daemon state.
   *
   * NIB-2 fix: DAEMON_OFFLINE and unknown states now route to the entry
   * surface (via viewForState) rather than a dead-end stateView. On first
   * mount we poll briefly to distinguish "daemon starting" from "daemon
   * genuinely offline" before deciding whether to show the health note.
   *
   * @param usePolling - true on mount; false on subsequent paint() calls
   *   (sub-nav clicks, control actions) to avoid poll latency mid-session.
   */
  async function paint(usePolling = false): Promise<void> {
    // On mount: poll a few times to give a cold-starting daemon a chance
    // to write its status file (eliminates the first-paint race without
    // any Rust changes). Subsequent calls skip polling to stay responsive.
    const status: StudyStatus = usePolling
      ? await pollUntilOnline(3, 800)
      : await bridge.studyStatus();

    mount.replaceChildren();
    if (sub === 'review') { mount.append(reviewView()); return; }
    if (sub === 'notes') { mount.append(notesView()); return; }
    if (sub === 'preferences') { mount.append(preferencesView(() => void paint())); return; }

    const surface = viewForState(status.state);
    const study = status.study as { kind?: StudyKind } | null;

    switch (surface) {
      case 'entry': {
        // NIB-2: entry is now shown for NOT_STARTED, COMPLETE, DELETED,
        // DAEMON_OFFLINE, and any unknown/future state.
        //
        // - COMPLETE/DELETED: prepend the receipt card before the entry choices.
        // - NOT_STARTED: plain entry (daemon is up, just no study yet).
        // - DAEMON_OFFLINE or unknown: entry cards + daemon health note below.
        if (status.state === 'COMPLETE' || status.state === 'DELETED') {
          mount.append(
            stateView(status, () => { sub = 'review'; void paint(); }, () => void paint()),
            entryView(() => void paint()),
          );
        } else {
          const showDaemonNote = status.state !== 'NOT_STARTED';
          mount.append(entryView(() => void paint(), showDaemonNote));
        }
        break;
      }
      case 'consent':
        mount.append(consentView(() => void paint(), study?.kind ?? 'full_study'));
        break;
      case 'studyOrScan':
        mount.append(
          study?.kind === 'quick_scan'
            ? quickScanView(status, () => void paint())
            : studyView(status, () => void paint()),
        );
        break;
      case 'state':
        mount.append(stateView(status, () => { sub = 'review'; void paint(); }, () => void paint()));
        break;
    }
  }

  renderNav();
  root.append(nav, mount);
  // Use polling on first mount to distinguish a cold-starting daemon
  // (first-paint race) from one that is genuinely offline.
  void paint(true);
  return root;
}
