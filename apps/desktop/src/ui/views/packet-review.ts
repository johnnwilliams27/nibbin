/**
 * Review-before-upload screen (Trust & Controls spec §5.2). Shows the actual
 * diagnosis packet — the only artifact that leaves the device (C7) — and lets
 * the user drop any workflow, or any individual recurring sequence / url-template
 * within a kept workflow (per-segment granularity, §5.2), before upload — or
 * delete everything instead. Resolves the caller's ReviewDecision on the choice.
 */
import { button, el } from '../dom.js';
import { filterPacket, type DiagnosisPacket, type ReviewRemovals, type ReviewDecision } from '../sync-study.js';

export function packetReviewView(
  packet: DiagnosisPacket,
  onDecision: (decision: ReviewDecision) => void,
): HTMLElement {
  const removed: ReviewRemovals = { workflows: new Set(), sequences: new Set(), urls: new Set() };
  const root = el('div', {});

  // A small Remove/keep toggle for one sub-item (sequence or url-template),
  // keyed in the given set. Struck/greyed when removed, with a "keep" affordance.
  function subItem(label: string, set: Set<string>, key: string): HTMLElement {
    const dropped = set.has(key);
    const toggle = button(
      dropped ? 'Removed — keep' : 'Remove',
      () => {
        if (dropped) set.delete(key);
        else set.add(key);
        render();
      },
      dropped ? 'danger' : '',
    );
    return el('div', { class: `review-subrow ${dropped ? 'review-removed' : ''}` }, [
      el('span', { class: 'review-subrow-label' }, [label]),
      toggle,
    ]);
  }

  function render(): void {
    const rows = packet.workflows.map((w) => {
      const dropped = removed.workflows.has(w.key);
      const meta = `${w.apps.join(', ') || '—'} · ${Math.round(w.minutesObserved)} min`;
      const toggle = button(
        dropped ? 'Removed — keep' : 'Remove',
        () => {
          if (dropped) removed.workflows.delete(w.key);
          else removed.workflows.add(w.key);
          render();
        },
        dropped ? 'danger' : '',
      );

      const head = el('div', { class: 'review-row-head' }, [
        el('div', {}, [
          el('p', { class: 'sync-status' }, [w.label]),
          el('p', { class: 'muted' }, [meta]),
        ]),
        toggle,
      ]);

      const children: (Node | string)[] = [head];

      // A removed workflow hides its sub-items (they're moot). For a kept
      // workflow, list its recurring sequences and url-templates with their
      // own per-item Remove toggle.
      if (!dropped) {
        const sequences = w.sequences ?? [];
        const urlTemplates = w.urlTemplates ?? [];
        if (sequences.length) {
          children.push(
            el('div', { class: 'review-subsection' }, [
              el('p', { class: 'eyebrow' }, ['Recurring sequences']),
              ...sequences.map((seq, i) =>
                subItem(`${seq.steps.join(' → ')} ×${seq.count}`, removed.sequences, `${w.key}#${i}`),
              ),
            ]),
          );
        }
        if (urlTemplates.length) {
          children.push(
            el('div', { class: 'review-subsection' }, [
              el('p', { class: 'eyebrow' }, ['Pages']),
              ...urlTemplates.map((u) => subItem(u, removed.urls, `${w.key}#${u}`)),
            ]),
          );
        }
      }

      return el('div', { class: `card review-row ${dropped ? 'review-removed' : ''}` }, children);
    });

    // Sub-item removals don't change the workflow count — only whole-workflow
    // removals do. Keep "Send to Nibbin (N)" = remaining workflows.
    const remaining = packet.workflows.length - removed.workflows.size;
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
