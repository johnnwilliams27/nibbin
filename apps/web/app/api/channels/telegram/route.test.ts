import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest';

// Mock the ingest module so the route test is about signature gating + wiring.
vi.mock('../../../../lib/channels/ingest', () => ({
  ingestInbound: vi.fn(async () => ({ status: 'accepted' })),
}));
vi.mock('../../../../lib/channels/ingest-deps', () => ({ supabaseIngestDeps: () => ({}) }));

import { POST } from './route';
import { ingestInbound } from '../../../../lib/channels/ingest';

function req(body: unknown, secret?: string) {
  return new Request('https://nibbin.com/api/channels/telegram', {
    method: 'POST',
    headers: secret ? { 'x-telegram-bot-api-secret-token': secret, 'content-type': 'application/json' } : { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

describe('telegram webhook route', () => {
  const OLD = process.env.TELEGRAM_WEBHOOK_SECRET;
  beforeAll(() => { process.env.TELEGRAM_WEBHOOK_SECRET = 's3cret'; });
  afterAll(() => { process.env.TELEGRAM_WEBHOOK_SECRET = OLD; });

  it('rejects a missing/wrong secret with 401 and never ingests', async () => {
    const res = await POST(req({ message: { chat: { id: 1 }, text: 'hi' } }, 'wrong'));
    expect(res.status).toBe(401);
    expect(ingestInbound).not.toHaveBeenCalled();
  });

  it('accepts a valid secret and ingests', async () => {
    const res = await POST(req({ message: { chat: { id: 1 }, text: 'hi' } }, 's3cret'));
    expect(res.status).toBe(200);
    expect(ingestInbound).toHaveBeenCalledOnce();
  });
});
