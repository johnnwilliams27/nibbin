import { describe, it, expect } from 'vitest';
import { segmentStudy } from '../packages/redaction/src/segment';
import { validateSynthesisPacket } from '../apps/web/lib/diagnosis/synthesize';
import type { ObserverEvent } from '../packages/redaction/src/types';

function ev(ts: string, session: string, host: string, app: string): ObserverEvent {
  return {
    v: 1, id: `${ts}-${session}`, ts, session, kind: 'ax_delta',
    app: { bundle_id: 'b', name: app }, window: { title_redacted: 'x', id: 'w' },
    url: { host, path_template: '/' },
    ax: { role_path: 'button', action: 'press', label_redacted: 'OK', value_class: 'none' },
    input: { keys: 0, clicks: 1, duration_ms: 60000 }, frame_ref: null,
    redaction: { rules_hit: [], review_state: 'auto' },
  };
}

describe('diagnosis packet contract (segmenter ↔ validator drift guard)', () => {
  it('segmentStudy output passes validateSynthesisPacket with workflows intact', async () => {
    const events = [
      ev('2026-06-10T09:00:00.000Z', 's1', 'mail.google.com', 'Gmail'),
      ev('2026-06-11T10:00:00.000Z', 's2', 'stripe.com', 'Stripe'),
    ];
    const packet = await segmentStudy('study_1', events, '2026-06-20T00:00:00.000Z');
    const validated = validateSynthesisPacket(packet);
    expect(validated).not.toBeNull();
    expect(validated!.studyId).toBe('study_1');
    expect(validated!.workflows.length).toBe(packet.workflows.length);
    expect(validated!.workflows.length).toBeGreaterThan(0);
  });
});
