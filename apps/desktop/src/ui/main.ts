/**
 * Observer shell UI. State-driven: the daemon's study state picks the home
 * view; Review / Field Notes / Account are always reachable. The webview
 * displays — the daemon decides (C2 and friends live over there).
 */
import '@nibbin/shared/tokens.css';
import './observer.css';
import { bridge, type StudyStatus } from './bridge.js';
import { button, clear, el } from './dom.js';
import { accountView } from './views/account.js';
import { consentView } from './views/consent.js';
import { notesView } from './views/notes.js';
import { preferencesView } from './views/preferences.js';
import { reviewView } from './views/review.js';
import { deleteEverythingCard, studyView } from './views/study.js';

type Tab = 'study' | 'review' | 'notes' | 'preferences' | 'account';

const app = document.getElementById('app')!;
let tab: Tab = 'study';

function reviewStateView(status: StudyStatus): HTMLElement {
  const state = status.state;
  const root = el('div', {});
  if (state === 'REVIEW') {
    root.append(
      el('p', { class: 'eyebrow' }, ['Field study']),
      el('h1', {}, ['The study ended. Really.']),
      el('p', { class: 'muted' }, [
        'Day 14 came and the Observer stopped itself — that switch lives in the background process, not this window. Look through what it kept, delete anything, then build your map when you’re ready. Synthesis builds your workflow map, and the raw data on this machine is deleted and verified right after.',
      ]),
      el('div', { class: 'card row' }, [
        button('Open review', () => setTab('review'), 'primary'),
        button('Build my map', () => void bridge.sendControl('finish_review').then(render)),
      ]),
      deleteEverythingCard(render),
    );
  } else if (state === 'SYNTHESIZING' || state === 'RAW_DELETING') {
    root.append(
      el('p', { class: 'eyebrow' }, ['Field study']),
      el('h1', {}, [state === 'SYNTHESIZING' ? 'Building your map…' : 'Deleting raw data…']),
      el('p', { class: 'muted' }, [
        'After your map is built, every raw event and frame on this machine is deleted — and the deletion is verified, not assumed. You’ll see the receipt.',
      ]),
    );
  } else if (state === 'COMPLETE' || state === 'DELETED') {
    const study = status.study as { deletionReceipt?: { verified: boolean; verified_at: string } } | null;
    const receipt = study?.deletionReceipt;
    root.append(
      el('p', { class: 'eyebrow' }, ['Field study']),
      el('h1', {}, [state === 'COMPLETE' ? 'Study complete' : 'Everything deleted']),
      el('div', { class: 'card' }, [
        el('h2', {}, ['Deletion receipt']),
        receipt
          ? el('p', {}, [
              `Store verified empty on ${receipt.verified_at.slice(0, 10)} — checked independently, not assumed. `,
              state === 'COMPLETE' ? 'Your map lives in your grove at nibbin.com.' : 'Nothing of the study remains on this machine.',
            ])
          : el('p', { class: 'muted' }, ['Receipt pending.']),
      ]),
    );
  } else if (state === 'DAEMON_OFFLINE') {
    root.append(
      el('p', { class: 'eyebrow' }, ['Observer']),
      el('h1', {}, ['The Observer isn’t running']),
      el('p', { class: 'muted' }, [
        'The background process that does the watching (and the stopping, and the deleting) is offline. Nothing records while it’s down. Start it from the menu bar, or reinstall if this keeps happening.',
      ]),
    );
  }
  return root;
}

function setTab(next: Tab): void {
  tab = next;
  void render();
}

async function render(): Promise<void> {
  const status = await bridge.studyStatus();
  clear(app);

  const nav = el('nav', { class: 'nav' });
  const tabs: [Tab, string][] = [
    ['study', 'Study'],
    ['review', 'Review'],
    ['notes', 'Field notes'],
    ['preferences', 'Preferences'],
    ['account', 'Account'],
  ];
  for (const [key, label] of tabs) {
    const b = button(label, () => setTab(key));
    if (key === tab) b.setAttribute('aria-current', 'true');
    nav.append(b);
  }
  app.append(nav);

  if (tab === 'review') {
    app.append(reviewView());
    return;
  }
  if (tab === 'notes') {
    app.append(notesView());
    return;
  }
  if (tab === 'preferences') {
    app.append(preferencesView(() => void render()));
    return;
  }
  if (tab === 'account') {
    app.append(accountView());
    return;
  }

  switch (status.state) {
    case 'NOT_STARTED':
    case 'CONSENTED':
      app.append(consentView(() => void render()));
      break;
    case 'ACTIVE':
    case 'PAUSED':
      app.append(studyView(status, () => void render()));
      break;
    default:
      app.append(reviewStateView(status));
  }
}

void render();
void bridge.onEvent('study:status', () => {
  // keep the countdown live while the study tab is showing
  if (tab === 'study') void render();
});
void bridge.onEvent('study:paused-by-hotkey', () => void render());
