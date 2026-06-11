import { describe, expect, it } from 'vitest';
import { buildSynthesisPacket, PacketLeakError, sequenceCandidates } from '../src/packet.js';
import type { ObserverEvent } from '../src/types.js';

function event(overrides: Partial<ObserverEvent> & { id: string }): ObserverEvent {
  return {
    v: 1,
    ts: '2026-06-12T14:03:22.114Z',
    session: 'ses_1',
    kind: 'ax_delta',
    app: { bundle_id: 'com.example.app', name: 'ExampleApp' },
    window: { title_redacted: 'Invoice {NUM} — {PERSON}', id: 'w_1' },
    url: { host: 'app.example.com', path_template: '/invoices/{id}' },
    ax: { role_path: 'window/table/row/button', action: 'press', label_redacted: 'Send invoice', value_class: 'none' },
    input: { keys: 12, clicks: 1, duration_ms: 4100 },
    frame_ref: 'blob_local_only',
    redaction: { rules_hit: ['NUM', 'PERSON'], review_state: 'auto' },
    ...overrides,
  };
}

describe('synthesis packet', () => {
  it('never contains frame refs and excludes user_deleted events', async () => {
    const events = [
      event({ id: 'e1' }),
      event({ id: 'e2', redaction: { rules_hit: [], review_state: 'user_deleted' } }),
      event({ id: 'e3', redaction: { rules_hit: [], review_state: 'user_kept' } }),
    ];
    const packet = await buildSynthesisPacket('study_1', events, '2026-06-24T00:00:00.000Z');
    expect(packet.manifest.event_count).toBe(2);
    expect(packet.jsonl).not.toContain('blob_local_only');
    expect(packet.jsonl).not.toContain('frame');
    expect(packet.manifest.hash).toMatch(/^[0-9a-f]{64}$/);
  });

  it('throws PacketLeakError if a PII shape survives into the serialized packet', async () => {
    const dirty = [event({ id: 'e1', window: { title_redacted: 'mail leak@example.com', id: 'w_1' } })];
    await expect(buildSynthesisPacket('study_1', dirty, '2026-06-24T00:00:00.000Z')).rejects.toThrow(PacketLeakError);
  });

  it('mines exact repeated role_path+action n-grams deterministically', () => {
    const loop = ['a#press', 'b#edit', 'c#press'];
    const steps: ObserverEvent[] = [];
    for (let rep = 0; rep < 4; rep += 1) {
      for (const s of loop) {
        const [rolePath, action] = s.split('#') as [string, 'press' | 'edit'];
        steps.push(
          event({
            id: `e${rep}_${s}`,
            ax: { role_path: rolePath, action, label_redacted: 'x', value_class: 'none' },
          }),
        );
      }
    }
    const candidates = sequenceCandidates(steps);
    expect(candidates.length).toBeGreaterThan(0);
    expect(candidates[0]!.count).toBeGreaterThanOrEqual(3);
  });
});
