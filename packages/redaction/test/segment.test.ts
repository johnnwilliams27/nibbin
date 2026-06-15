import { describe, it, expect } from 'vitest';
import { segmentStudy, PacketLeakError } from '../src/segment.js';
import type { ObserverEvent } from '../src/types.js';

function ev(partial: Partial<ObserverEvent> & { ts: string; session: string }): ObserverEvent {
  return {
    v: 1,
    id: `e-${partial.ts}-${partial.session}`,
    kind: 'ax_delta',
    app: { bundle_id: 'com.test', name: 'TestApp' },
    window: { title_redacted: 'Untitled', id: 'w1' },
    url: null,
    ax: { role_path: 'button', action: 'press', label_redacted: 'OK', value_class: 'none' },
    input: { keys: 0, clicks: 1, duration_ms: 60000 },
    frame_ref: null,
    redaction: { rules_hit: [], review_state: 'auto' },
    ...partial,
  };
}

const NOW = '2026-06-20T00:00:00.000Z';

describe('segmentStudy', () => {
  it('groups events into one workflow per category with aggregates', async () => {
    const events: ObserverEvent[] = [
      ev({ ts: '2026-06-10T09:00:00.000Z', session: 's1', app: { bundle_id: 'g', name: 'Gmail' },
           url: { host: 'mail.google.com', path_template: '/mail/u/0' } }),
      ev({ ts: '2026-06-10T09:05:00.000Z', session: 's1', app: { bundle_id: 'g', name: 'Gmail' },
           url: { host: 'mail.google.com', path_template: '/mail/u/0' } }),
      ev({ ts: '2026-06-11T10:00:00.000Z', session: 's2', app: { bundle_id: 's', name: 'Stripe' },
           url: { host: 'stripe.com', path_template: '/invoices' } }),
    ];
    const packet = await segmentStudy('study_1', events, NOW);
    expect(packet.version).toBe(1);
    expect(packet.studyId).toBe('study_1');
    const email = packet.workflows.find((w) => w.category === 'email');
    const payments = packet.workflows.find((w) => w.category === 'payments');
    expect(email).toBeDefined();
    expect(email!.minutesObserved).toBe(2); // 2 × 60000ms = 2 min
    expect(email!.sessions).toBe(1);
    expect(email!.apps).toEqual(['Gmail']);
    expect(payments!.minutesObserved).toBe(1);
    expect(payments!.sessions).toBe(1);
    expect(packet.capturedFrom).toBe('2026-06-10T09:00:00.000Z');
    expect(packet.capturedTo).toBe('2026-06-11T10:00:00.000Z');
    expect(packet.studyDays).toBe(2);
  });

  it('excludes user_deleted events', async () => {
    const events: ObserverEvent[] = [
      ev({ ts: '2026-06-10T09:00:00.000Z', session: 's1', url: { host: 'mail.google.com', path_template: '/' },
           redaction: { rules_hit: [], review_state: 'user_deleted' } }),
    ];
    const packet = await segmentStudy('study_1', events, NOW);
    expect(packet.workflows).toHaveLength(0);
  });

  it('emits bounded enrichment: sequences, urlTemplates, dailyMinutes, dailyAppMinutes', async () => {
    // 4 identical-shaped email events across 2 days to create a repeated sequence.
    const events: ObserverEvent[] = [];
    for (let i = 0; i < 6; i += 1) {
      events.push(ev({
        ts: `2026-06-${10 + (i % 2)}T09:0${i}:00.000Z`, session: `s${i % 2}`,
        app: { bundle_id: 'g', name: 'Gmail' },
        url: { host: 'mail.google.com', path_template: `/mail/u/${i % 3}` },
        ax: { role_path: 'list>row', action: 'press', label_redacted: 'Open', value_class: 'none' },
      }));
    }
    const packet = await segmentStudy('study_1', events, NOW);
    const email = packet.workflows.find((w) => w.category === 'email')!;
    expect(Array.isArray(email.sequences)).toBe(true);
    expect(email.sequences!.length).toBeLessThanOrEqual(10);
    expect(email.urlTemplates!.length).toBeLessThanOrEqual(20);
    expect(new Set(email.urlTemplates)).toEqual(new Set(['/mail/u/0', '/mail/u/1', '/mail/u/2']));
    // dailyMinutes summed per ISO day (each event 60000ms = 1 min)
    expect(Object.keys(email.dailyMinutes!).sort()).toEqual(['2026-06-10', '2026-06-11']);
    // top-level daily app minutes present
    expect(packet.dailyAppMinutes!['2026-06-10'].Gmail).toBeGreaterThan(0);
  });

  it('throws PacketLeakError when a residual PII shape survives into the packet', async () => {
    // An app name that looks like an email address trips the battery re-scan.
    const events: ObserverEvent[] = [
      ev({ ts: '2026-06-10T09:00:00.000Z', session: 's1',
           app: { bundle_id: 'x', name: 'leak test@example.com' },
           url: { host: 'mail.google.com', path_template: '/' } }),
    ];
    await expect(segmentStudy('study_1', events, NOW)).rejects.toBeInstanceOf(PacketLeakError);
  });

  it('stays under the 256KB packet cap for a large study', async () => {
    const hosts = ['mail.google.com', 'stripe.com', 'salesforce.com', 'docs.google.com', 'x.com'];
    const events: ObserverEvent[] = [];
    for (let d = 10; d <= 23; d += 1) {
      for (let i = 0; i < 200; i += 1) {
        const h = hosts[i % hosts.length];
        events.push(ev({
          ts: `2026-06-${d}T${String(8 + (i % 10)).padStart(2, '0')}:00:00.000Z`, session: `s${d}-${i % 12}`,
          app: { bundle_id: 'b', name: `App${i % 5}` }, url: { host: h, path_template: `/p/${i % 25}` },
          ax: { role_path: `r${i % 7}>c${i % 3}`, action: 'press', label_redacted: 'x', value_class: 'none' },
        }));
      }
    }
    const packet = await segmentStudy('big', events, '2026-06-24T00:00:00.000Z');
    expect(JSON.stringify(packet).length).toBeLessThan(262144);
  });
});
