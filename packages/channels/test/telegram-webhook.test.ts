import { describe, it, expect, vi } from 'vitest';
import { setTelegramWebhook, getTelegramWebhookInfo } from '../src/admin/telegram-webhook';

describe('setTelegramWebhook', () => {
  it('POSTs to the bot setWebhook endpoint with url + secret_token + allowed_updates', async () => {
    const calls: Array<{ url: string; body: unknown }> = [];
    const fetchImpl = vi.fn(async (url: string, init?: RequestInit) => {
      calls.push({ url, body: JSON.parse(String(init?.body)) });
      return new Response(JSON.stringify({ ok: true, result: true, description: 'Webhook was set' }), { status: 200 });
    }) as unknown as typeof fetch;

    const r = await setTelegramWebhook({ botToken: 'T0KEN', url: 'https://nibbin.com/api/channels/telegram', secret: 's3cr3t', fetchImpl });

    expect(r.ok).toBe(true);
    expect(calls[0].url).toBe('https://api.telegram.org/botT0KEN/setWebhook');
    expect(calls[0].body).toMatchObject({
      url: 'https://nibbin.com/api/channels/telegram',
      secret_token: 's3cr3t',
      allowed_updates: ['message', 'callback_query'],
    });
  });

  it('returns ok:false when Telegram rejects', async () => {
    const fetchImpl = vi.fn(async () =>
      new Response(JSON.stringify({ ok: false, description: 'Bad Request' }), { status: 400 }),
    ) as unknown as typeof fetch;
    const r = await setTelegramWebhook({ botToken: 'x', url: 'https://e.x', secret: 's', fetchImpl });
    expect(r.ok).toBe(false);
    expect(r.description).toBe('Bad Request');
  });

  it('getTelegramWebhookInfo returns the registered url', async () => {
    const fetchImpl = vi.fn(async () =>
      new Response(JSON.stringify({ ok: true, result: { url: 'https://nibbin.com/api/channels/telegram' } }), { status: 200 }),
    ) as unknown as typeof fetch;
    const r = await getTelegramWebhookInfo({ botToken: 'x', fetchImpl });
    expect(r.ok).toBe(true);
    expect(r.url).toBe('https://nibbin.com/api/channels/telegram');
  });
});
