import { describe, it, expect } from 'vitest';
import { telegramAdapter } from '@nibbin/channels';

interface TgButton { text: string; callback_data?: string; url?: string }
interface TgBody { chat_id: string; text: string; reply_markup?: { inline_keyboard: TgButton[][] } }

function fakeFetch(captured: { url?: string; body?: TgBody }, ok = true): typeof fetch {
  return async (url: string | URL | Request, init?: RequestInit) => {
    captured.url = String(url);
    captured.body = JSON.parse(init?.body as string) as TgBody;
    return {
      ok,
      status: ok ? 200 : 400,
      async json() {
        return ok ? { ok: true, result: { message_id: 4242 } } : { ok: false, description: 'blocked' };
      },
    } as Response;
  };
}

describe('telegramAdapter', () => {
  it('sends to the chat id and renders actions as an inline keyboard', async () => {
    const cap: { url?: string; body?: TgBody } = {};
    const port = telegramAdapter({ botToken: 'BOT', fetchImpl: fakeFetch(cap) });
    const res = await port.deliver({
      accountId: 'acc', channel: 'telegram', externalId: '987',
      kind: 'escalation', urgency: 'high', body: 'Approve the invoice follow-up?',
      actions: [
        { id: 'a', label: 'Approve', kind: 'approve' },
        { id: 'd', label: 'Deny', kind: 'deny' },
        { id: 'o', label: 'Open app', kind: 'open', deepLink: 'https://nibbin.com/app/approvals/r1' },
      ],
      requestId: 'r1',
    });
    expect(res.delivered).toBe(true);
    expect(res.providerMessageId).toBe('4242');
    expect(res.costMicroUsd).toBe(0);
    expect(cap.url).toContain('/botBOT/sendMessage');
    expect(cap.body?.chat_id).toBe('987');
    // inline keyboard: callback buttons carry requestId; open is a url button
    const kb = (cap.body?.reply_markup?.inline_keyboard ?? []).flat();
    expect(kb.find((b) => b.text === 'Approve')?.callback_data).toBe('r1:approve');
    expect(kb.find((b) => b.text === 'Open app')?.url).toContain('/app/approvals/r1');
  });

  it('returns delivered=false (no throw) on a provider error', async () => {
    const cap: { url?: string; body?: TgBody } = {};
    const port = telegramAdapter({ botToken: 'BOT', fetchImpl: fakeFetch(cap, false) });
    const res = await port.deliver({
      accountId: 'acc', channel: 'telegram', externalId: '987',
      kind: 'news', urgency: 'normal', body: 'hi',
    });
    expect(res.delivered).toBe(false);
    expect(res.error).toContain('blocked');
  });
});
