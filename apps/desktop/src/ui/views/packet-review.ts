/**
 * Review-before-upload screen (Trust & Controls spec §5.2). Shows the actual
 * diagnosis packet — the only artifact that leaves the device (C7) — and lets
 * the user drop any workflow before upload, or delete everything instead.
 * Resolves the caller's ReviewDecision on the user's choice.
 */
import { button, el } from '../dom.js';
import { filterPacket, type DiagnosisPacket, type ReviewDecision } from '../sync-study.js';

export function packetReviewView(
  packet: DiagnosisPacket,
  onDecision: (decision: ReviewDecision) => void,
): HTMLElement {
  const removed = new Set<string>();
  const root = el('div', {});

  function render(): void {
    const rows = packet.workflows.map((w) => {
      const dropped = removed.has(w.key);
      const meta = `${w.apps.join(', ') || '—'} · ${Math.round(w.minutesObserved)} min`;
      const toggle = button(
        dropped ? 'Removed — keep' : 'Remove',
        () => {
          if (dropped) removed.delete(w.key);
          else removed.add(w.key);
          render();
        },
        dropped ? 'danger' : '',
      );
      return el('div', { class: `card review-row ${dropped ? 'review-removed' : ''}` }, [
        el('div', {}, [
          el('p', { class: 'sync-status' }, [w.label]),
          el('p', { class: 'muted' }, [meta]),
        ]),
        toggle,
      ]);
    });

    const remaining = packet.workflows.length - removed.size;
    root.replaceChildren(
      el('p', { class: 'eyebrow' }, ['Field study']),
      el('h1', {}, ['Review before it leaves your device']),
      el('p', { class: 'muted' }, [
        'Only this redacted summary leaves your device — your screen recordings never do. Remove anything you don’t want to send.',
      ]),
      ...(rows.length ? rows : [el('p', { class: 'muted' }, ['No workflows were found to send.'])]),
      el('div', { class: 'card row' }, [
        button(
          `Send to Nibbin (${remaining})`,
          () => onDecision({ action: 'send', packet: filterPacket(packet, removed) }),
          'primary',
        ),
        button('Delete instead', () => onDecision({ action: 'delete' }), 'danger'),
      ]),
    );
  }

  render();
  return root;
}
