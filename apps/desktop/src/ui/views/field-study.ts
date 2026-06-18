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
import { EVER_COMPLETED_KEY } from '../tab-dot.js';
import { consentView } from './consent.js';
import { notesView } from './notes.js';
import { preferencesView } from './preferences.js';
import { reviewView } from './review.js';
import { deleteEverythingCard, studyView } from './study.js';
import { packetReviewView } from './packet-review.js';
import type { ReviewDecision } from '../sync-study.js';
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
  reviewing: 'Review what’s about to be sent.',
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
  let pendingReview: HTMLElement | null = null;

  function setState(s: SyncState): void {
    syncState = s;
    syncStates.set(studyId, s);
    render();
  }

  function render(): void {
    // While reviewing, show the packet itself (the review screen owns the UI
    // and resolves the pending decision); otherwise show the status card.
    if (syncState === 'reviewing' && pendingReview) {
      root.replaceChildren(pendingReview);
      return;
    }
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
      // Review-before-upload (§5.2): render the packet and resolve on the
      // user's choice. The pending element is shown by render() in 'reviewing'.
      review: (packet) =>
        new Promise<ReviewDecision>((resolve) => {
          pendingReview = packetReviewView(packet, (decision) => {
            pendingReview = null;
            resolve(decision);
          });
          render();
        }),
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
    // Persist the "ever completed a study" flag so the tab dot is permanently
    // suppressed for returning users (C — persisted first-timer nudge, Task C).
    try { localStorage.setItem(EVER_COMPLETED_KEY, '1'); } catch { /* storage unavailable */ }
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
 * The Retry button calls `onRetry`, which should run the same 3× cold-start
 * poll as mount (`paint(true)`) so a real cold-start resolves on retry.
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
 * entry cards. `onRetry` is the callback for the health note's Retry button —
 * defaults to `onChanged` but callers can pass `() => void paint(true)` to run
 * the 3× cold-start poll (NIB-7 fold-in fix B).
 */
function entryView(onChanged: () => void, showDaemonNote = false, onRetry?: () => void): HTMLElement {
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
      // Use onRetry (paint(true)) if provided, else fall back to onChanged.
      children.push(daemonHealthNote(onRetry ?? onChanged));
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

/**
 * Inline SVG icon — stroke=currentColor, 18px, viewBox 0 0 24 24.
 * Follows the same convention as the web shell's NavIcon: inherits tint from
 * the button's color so it reacts to the active-state token automatically.
 * No icon-library dependency; all elements are created via createElementNS so
 * there is no innerHTML and no XSS surface.
 */
function navIcon(sub: Sub): SVGSVGElement {
  const ns = 'http://www.w3.org/2000/svg';

  function svgEl(tag: string, attrs: Record<string, string>): SVGElement {
    const el = document.createElementNS(ns, tag);
    for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, v);
    return el;
  }

  // Shape definitions: each sub has an array of [tag, attrs] tuples.
  // All paths/shapes are compile-time literals — no user data.
  const shapes: Record<Sub, Array<[string, Record<string, string>]>> = {
    // Binoculars / field-glass — "Field study"
    home: [
      ['circle', { cx: '7', cy: '14', r: '4' }],
      ['circle', { cx: '17', cy: '14', r: '4' }],
      ['path', { d: 'M3 14V9l4-5h2m6 0h2l4 5v5' }],
      ['line', { x1: '11', y1: '14', x2: '13', y2: '14' }],
    ],
    // Checklist — "Review"
    review: [
      ['rect', { x: '5', y: '3', width: '14', height: '18', rx: '2' }],
      ['line', { x1: '9', y1: '8', x2: '15', y2: '8' }],
      ['line', { x1: '9', y1: '12', x2: '15', y2: '12' }],
      ['polyline', { points: '9 16 11 18 15 14' }],
    ],
    // Notebook with pencil — "Field notes"
    notes: [
      ['rect', { x: '4', y: '3', width: '13', height: '18', rx: '2' }],
      ['line', { x1: '8', y1: '8', x2: '13', y2: '8' }],
      ['line', { x1: '8', y1: '12', x2: '13', y2: '12' }],
      ['path', { d: 'M17 17l4-4-2-2-4 4v2h2z' }],
    ],
    // Sliders — "Preferences"
    preferences: [
      ['line', { x1: '4', y1: '6', x2: '20', y2: '6' }],
      ['line', { x1: '4', y1: '12', x2: '20', y2: '12' }],
      ['line', { x1: '4', y1: '18', x2: '20', y2: '18' }],
      ['circle', { cx: '9', cy: '6', r: '2', fill: 'none' }],
      ['circle', { cx: '16', cy: '12', r: '2', fill: 'none' }],
      ['circle', { cx: '9', cy: '18', r: '2', fill: 'none' }],
    ],
  };

  const svg = document.createElementNS(ns, 'svg') as SVGSVGElement;
  svg.setAttribute('width', '18');
  svg.setAttribute('height', '18');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('fill', 'none');
  svg.setAttribute('stroke', 'currentColor');
  svg.setAttribute('stroke-width', '2');
  svg.setAttribute('stroke-linecap', 'round');
  svg.setAttribute('stroke-linejoin', 'round');
  svg.setAttribute('aria-hidden', 'true');
  for (const [tag, attrs] of shapes[sub]) svg.append(svgEl(tag, attrs));
  return svg;
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
  // carries aria-current styled by `.subnav button[aria-current='true']` — a
  // moss-tinted pill matching the `chip.active` treatment. Each button also
  // shows an inline SVG icon to match Grove's icon+label nav idiom.
  function renderNav(): void {
    nav.replaceChildren();
    for (const [key, label] of subs) {
      const icon = navIcon(key);
      const labelSpan = el('span', {}, [label]);
      const b = el('button', { class: 'subnav-btn' });
      b.append(icon, labelSpan);
      b.addEventListener('click', () => { sub = key; renderNav(); void paint(); });
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
          mount.append(entryView(() => void paint(), showDaemonNote, () => void paint(true)));
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
