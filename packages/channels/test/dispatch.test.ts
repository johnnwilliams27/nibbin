import { describe, it, expect } from 'vitest';
import { deliverWithFallback, floorAdapter, type ChannelPort, type ChannelStore, type DispatchContext } from '@nibbin/channels';

function port(channel: any, ok: boolean): ChannelPort {
  return { channel, async deliver() { return ok ? { delivered: true, providerMessageId: 'x' } : { delivered: false, error: 'down' }; } };
}

function ctx(over: Partial<ChannelStore>, ports: ChannelPort[], hour = 12): DispatchContext {
  const logs: any[] = [];
  const store: ChannelStore = {
    async verifiedChannels() { return [{ channel: 'telegram', externalId: 't' }, { channel: 'sms', externalId: 's' }]; },
    async prefs() {
      return [
        { channel: 'telegram', enabled: true, priority: 10, urgencyThreshold: 'all' },
        { channel: 'sms', enabled: true, priority: 20, urgencyThreshold: 'high' },
      ];
    },
    async quietHours() { return null; },
    async logDelivery(row) { logs.push(row); },
    ...over,
  };
  const floorWrites: any[] = [];
  const floor = floorAdapter({ async insertNotification(a, n) { floorWrites.push({ a, n }); } });
  return Object.assign(
    { ports: new Map(ports.map((p) => [p.channel, p])), floor, store, now: () => new Date(), localHour: () => hour },
    { _logs: logs, _floorWrites: floorWrites } as any,
  ) as any;
}

describe('deliverWithFallback', () => {
  it('delivers via the highest-priority eligible channel', async () => {
    const c = ctx({}, [port('telegram', true), port('sms', true)]);
    const r = await deliverWithFallback({ accountId: 'a', channel: 'telegram', externalId: '', kind: 'escalation', urgency: 'high', body: 'go?' }, c);
    expect(r.deliveredVia).toBe('telegram');
  });

  it('walks the fallback chain when the first channel fails', async () => {
    const c = ctx({}, [port('telegram', false), port('sms', true)]);
    const r = await deliverWithFallback({ accountId: 'a', channel: 'telegram', externalId: '', kind: 'escalation', urgency: 'high', body: 'go?' }, c);
    expect(r.deliveredVia).toBe('sms');
    expect(r.attempts).toEqual([{ channel: 'telegram', ok: false }, { channel: 'sms', ok: true }]);
  });

  it('falls to the in-app floor when every channel fails', async () => {
    const c = ctx({}, [port('telegram', false), port('sms', false)]);
    const r = await deliverWithFallback({ accountId: 'a', channel: 'telegram', externalId: '', kind: 'escalation', urgency: 'high', body: 'go?' }, c);
    expect(r.deliveredVia).toBe('floor');
    expect((c as any)._floorWrites).toHaveLength(1);
    // a fallback log row must have been written
    expect((c as any)._logs.some((l: any) => l.status === 'fallback')).toBe(true);
  });

  it('respects the urgency threshold (sms only takes >= high)', async () => {
    const c = ctx({}, [port('telegram', false), port('sms', true)]);
    const r = await deliverWithFallback({ accountId: 'a', channel: 'telegram', externalId: '', kind: 'news', urgency: 'normal', body: 'fyi' }, c);
    // telegram(all) fails, sms excluded by threshold -> floor
    expect(r.deliveredVia).toBe('floor');
  });

  it('in quiet hours, non-urgent goes straight to the floor', async () => {
    const c = ctx({ async quietHours() { return { start: 21, end: 9 }; } }, [port('telegram', true)], 23);
    const r = await deliverWithFallback({ accountId: 'a', channel: 'telegram', externalId: '', kind: 'beat', urgency: 'normal', body: 'evening' }, c);
    expect(r.deliveredVia).toBe('floor');
  });

  it('in quiet hours, urgent message still delivers via an eligible channel (not floor)', async () => {
    // §6 allows urgent through quiet hours; §8 would suppress non-urgent. Urgent must NOT fall to floor.
    const c = ctx({ async quietHours() { return { start: 21, end: 9 }; } }, [port('telegram', true)], 23);
    const r = await deliverWithFallback({ accountId: 'a', channel: 'telegram', externalId: '', kind: 'escalation', urgency: 'urgent', body: 'wake up' }, c);
    expect(r.deliveredVia).toBe('telegram');
  });
});
