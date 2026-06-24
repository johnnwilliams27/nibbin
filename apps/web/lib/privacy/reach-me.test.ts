/**
 * loadReachMeData — view-model assembly tests.
 *
 * Stubs the request-scoped supabase client and the channel feature-flag env so
 * the loader's mapping (connected status, pref carry-through, live flags) is
 * verified without a database. Mirrors the privacy page's own queries.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { loadReachMeData } from './reach-me';

type Row = Record<string, unknown>;

/** Minimal supabase stub: .from(table).select(...) resolves to the seeded rows. */
function stubClient(channels: Row[], prefs: Row[]) {
  return {
    from(table: string) {
      const data = table === 'notification_channels' ? channels : prefs;
      const builder = {
        select() {
          return builder;
        },
        neq() {
          // notification_channels query ends with .neq(...); return the thenable.
          return Promise.resolve({ data, error: null });
        },
        then(resolve: (v: { data: Row[]; error: null }) => void) {
          // channel_prefs query has no trailing .neq — it's awaited directly.
          return Promise.resolve({ data, error: null }).then(resolve);
        },
      };
      return builder;
    },
  } as never;
}

const ORIG = { ...process.env };

beforeEach(() => {
  delete process.env.TELEGRAM_BOT_TOKEN;
  delete process.env.CHANNELS_SMS_ENABLED;
  delete process.env.CHANNELS_WHATSAPP_ENABLED;
  delete process.env.NEXT_PUBLIC_TELEGRAM_BOT;
});

afterEach(() => {
  process.env = { ...ORIG };
});

describe('loadReachMeData', () => {
  it('returns all three channels in a stable order', async () => {
    const data = await loadReachMeData(stubClient([], []));
    expect(data.channels.map((c) => c.channel)).toEqual(['telegram', 'sms', 'whatsapp']);
  });

  it('marks telegram live only when TELEGRAM_BOT_TOKEN is set', async () => {
    let data = await loadReachMeData(stubClient([], []));
    expect(data.channels.find((c) => c.channel === 'telegram')!.live).toBe(false);

    process.env.TELEGRAM_BOT_TOKEN = 'x';
    data = await loadReachMeData(stubClient([], []));
    expect(data.channels.find((c) => c.channel === 'telegram')!.live).toBe(true);
  });

  it('maps verified connection + carries existing prefs through', async () => {
    process.env.TELEGRAM_BOT_TOKEN = 'x';
    const data = await loadReachMeData(
      stubClient(
        [{ id: 'nc-1', channel: 'telegram', status: 'verified', external_label: null }],
        [{ channel: 'telegram', enabled: false, priority: 250, urgency_threshold: 'high' }],
      ),
    );
    const tg = data.channels.find((c) => c.channel === 'telegram')!;
    expect(tg.status).toBe('verified');
    expect(tg.channelId).toBe('nc-1');
    expect(tg.enabled).toBe(false);
    expect(tg.priority).toBe(250);
    expect(tg.urgencyThreshold).toBe('high');
  });

  it('maps a pending connection as status="pending"', async () => {
    process.env.TELEGRAM_BOT_TOKEN = 'x';
    const data = await loadReachMeData(
      stubClient([{ id: 'nc-2', channel: 'telegram', status: 'pending' }], []),
    );
    const tg = data.channels.find((c) => c.channel === 'telegram')!;
    expect(tg.status).toBe('pending');
    expect(tg.channelId).toBe('nc-2');
  });

  it('defaults an unconnected channel to enabled=true / priority=100 / urgency=all', async () => {
    const data = await loadReachMeData(stubClient([], []));
    const tg = data.channels.find((c) => c.channel === 'telegram')!;
    expect(tg.status).toBeNull();
    expect(tg.channelId).toBeNull();
    expect(tg.enabled).toBe(true);
    expect(tg.priority).toBe(100);
    expect(tg.urgencyThreshold).toBe('all');
  });

  it('exposes the bot handle from NEXT_PUBLIC_TELEGRAM_BOT', async () => {
    process.env.NEXT_PUBLIC_TELEGRAM_BOT = 'NibbinGroveBot';
    const data = await loadReachMeData(stubClient([], []));
    expect(data.botHandle).toBe('NibbinGroveBot');
  });
});
