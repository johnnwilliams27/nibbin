/**
 * Study home: the countdown (daemon-derived, always visible), pause/resume,
 * stop early, and the always-reachable "delete everything".
 */
import { bridge, type StudyStatus } from '../bridge.js';
import type { StudyDepth } from '../../core/study-machine.js';
import type { StudySnapshot } from '../../core/study-machine.js';
import { button, el } from '../dom.js';
import { postStudyStatus } from '../post-study-status.js';

function fmtRemaining(ms: number | null): string {
  if (ms === null) return '—';
  const days = Math.floor(ms / 86_400_000);
  const hours = Math.floor((ms % 86_400_000) / 3_600_000);
  const mins = Math.floor((ms % 3_600_000) / 60_000);
  return `${days}d ${hours}h ${mins}m`;
}

export function studyView(status: StudyStatus, onChanged: () => void): HTMLElement {
  const paused = status.state === 'PAUSED' || status.paused === true;
  const study = status.study as { depth?: StudyDepth } | null;
  const depth = study?.depth ?? 'lite';
  const depthLabel = depth === 'detailed' ? 'Detailed — with screenshots' : 'Lite — no screenshots';

  const stateChip = el('span', { class: `chip ${paused ? 'warn' : 'active'}` }, [
    paused ? 'Paused' : 'Watching',
  ]);

  const root = el('div', {}, [
    el('p', { class: 'eyebrow' }, ['Field study']),
    el('h1', {}, ['Your field study is underway']),
    el('div', { class: 'card' }, [
      el('div', { class: 'row' }, [
        el('div', {}, [
          el('p', { class: 'eyebrow' }, ['Time left — stops itself on day 14']),
          el('div', { class: 'countdown' }, [fmtRemaining(status.remaining_ms)]),
        ]),
        stateChip,
      ]),
      el('p', { class: 'muted' }, [depthLabel]),
      el('p', { class: 'muted' }, [
        'The stop lives in the background process, not this window — closing the app changes nothing about day 14.',
      ]),
    ]),
  ]);

  if (status.pipeline_halted === true) {
    root.append(
      el('div', { class: 'card' }, [
        el('h2', {}, ['Capture is taking a breather']),
        el('p', {}, [
          'The redaction engine isn’t available right now, so nothing is being recorded — when it can’t scrub, it doesn’t save. It will pick back up on its own once the engine is healthy.',
        ]),
      ]),
    );
  }

  const controls = el('div', { class: 'card' }, [el('h2', {}, ['Controls'])]);
  const row = el('div', { class: 'row' });
  row.append(
    paused
      ? button('Resume capture', () => void bridge.sendControl('resume').then(onChanged), 'primary')
      : button('Pause capture (⌘⇧.)', () => void bridge.sendControl('pause').then(onChanged)),
    button('End the study early', () => {
      void bridge.sendControl('stop_early').then(() => {
        const snap = status.study as Partial<StudySnapshot> | null;
        if (snap?.studyId && snap.startedAt) {
          void postStudyStatus({
            studyId: snap.studyId,
            kind: snap.kind ?? 'full_study',
            label: snap.label ?? null,
            status: "stopped",
            startedAt: snap.startedAt,
            endsAt: snap.endsAt ?? null,
          });
        }
        onChanged();
      });
    }),
  );
  controls.append(
    row,
    el('p', { class: 'muted' }, ['Pauses show up as visible gaps in your Field Notes — never hidden.']),
  );
  root.append(controls, deleteEverythingCard(onChanged));
  return root;
}

/** Reachable from any state, by design (SPEC §5). */
export function deleteEverythingCard(onChanged: () => void): HTMLElement {
  let armed = false;
  const card = el('div', { class: 'card' }, [
    el('h2', {}, ['Delete everything']),
    el('p', { class: 'muted' }, [
      'Wipes every captured event and frame from this machine and verifies the store is empty. This can’t be undone — and it never uploads anything first.',
    ]),
  ]);
  const action = button(
    'Delete everything…',
    () => {
      if (!armed) {
        armed = true;
        action.textContent = 'Yes, really delete it all';
        return;
      }
      void bridge.sendControl('delete_everything').then(onChanged);
    },
    'danger',
  );
  card.append(action);
  return card;
}
