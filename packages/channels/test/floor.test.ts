import { describe, it, expect } from 'vitest';
import { floorAdapter, type NotificationsFloorStore } from '@nibbin/channels';

describe('floorAdapter', () => {
  it('stores non-beat messages as kind=reach', async () => {
    const writes: unknown[] = [];
    const store: NotificationsFloorStore = {
      async insertNotification(accountId, n) {
        writes.push({ accountId, ...n });
      },
    };
    const port = floorAdapter(store);
    const res = await port.deliver({
      accountId: 'acc', channel: 'push', externalId: 'n/a',
      kind: 'escalation', urgency: 'urgent', body: 'A Nibbin needs your go-ahead.',
      deepLink: '/app/approvals/r1', requestId: 'r1',
    });
    expect(res.delivered).toBe(true);
    expect(writes).toHaveLength(1);
    expect((writes[0] as any).kind).toBe('reach');
  });

  it('stores beat messages as kind=beat', async () => {
    const writes: unknown[] = [];
    const store: NotificationsFloorStore = {
      async insertNotification(accountId, n) {
        writes.push({ accountId, ...n });
      },
    };
    const port = floorAdapter(store);
    const res = await port.deliver({
      accountId: 'acc', channel: 'push', externalId: 'n/a',
      kind: 'beat', urgency: 'normal', body: 'A note from your grove.',
    });
    expect(res.delivered).toBe(true);
    expect(writes).toHaveLength(1);
    expect((writes[0] as any).kind).toBe('beat');
  });
});
