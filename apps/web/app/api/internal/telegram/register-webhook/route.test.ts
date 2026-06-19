import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Mock the channels helper so the route test is about auth gating + wiring,
// not Telegram network calls.
vi.mock('@nibbin/channels', async (importOriginal) => {
  const real = await importOriginal<typeof import('@nibbin/channels')>();
  return {
    ...real,
    setTelegramWebhook: vi.fn(async () => ({ ok: true, description: 'Webhook was set' })),
    getTelegramWebhookInfo: vi.fn(async () => ({ ok: true, url: 'https://nibbin.com/api/channels/telegram' })),
  };
});

import { POST, GET } from './route';
import { setTelegramWebhook, getTelegramWebhookInfo } from '@nibbin/channels';

function makeRequest(method: 'POST' | 'GET', secret?: string): Request {
  return new Request('https://nibbin.com/api/internal/telegram/register-webhook', {
    method,
    headers: secret ? { authorization: `Bearer ${secret}` } : {},
  });
}

const ENV_KEYS = ['INTERNAL_API_SECRET', 'TELEGRAM_BOT_TOKEN', 'TELEGRAM_WEBHOOK_SECRET', 'TELEGRAM_WEBHOOK_URL', 'NEXT_PUBLIC_SITE_URL', 'VERCEL_URL'];
const savedEnv: Record<string, string | undefined> = {};

beforeEach(() => {
  vi.clearAllMocks();
  for (const k of ENV_KEYS) savedEnv[k] = process.env[k];
  process.env.INTERNAL_API_SECRET = 'internal-secret';
  process.env.TELEGRAM_BOT_TOKEN = 'bot-token';
  process.env.TELEGRAM_WEBHOOK_SECRET = 'webhook-secret';
  delete process.env.TELEGRAM_WEBHOOK_URL;
  process.env.NEXT_PUBLIC_SITE_URL = 'https://nibbin.com';
  delete process.env.VERCEL_URL;
});

afterEach(() => {
  for (const k of ENV_KEYS) {
    if (savedEnv[k] === undefined) delete process.env[k];
    else process.env[k] = savedEnv[k];
  }
});

describe('POST /api/internal/telegram/register-webhook', () => {
  it('returns 401 without the internal secret', async () => {
    const res = await POST(makeRequest('POST'));
    expect(res.status).toBe(401);
    expect(vi.mocked(setTelegramWebhook)).not.toHaveBeenCalled();
  });

  it('returns 401 with a wrong secret', async () => {
    const res = await POST(makeRequest('POST', 'wrong-secret'));
    expect(res.status).toBe(401);
    expect(vi.mocked(setTelegramWebhook)).not.toHaveBeenCalled();
  });

  it('returns 500 when TELEGRAM_BOT_TOKEN is missing', async () => {
    delete process.env.TELEGRAM_BOT_TOKEN;
    const res = await POST(makeRequest('POST', 'internal-secret'));
    expect(res.status).toBe(500);
    const body = await res.json() as { error: string };
    expect(body.error).toMatch(/TELEGRAM_BOT_TOKEN/);
    expect(vi.mocked(setTelegramWebhook)).not.toHaveBeenCalled();
  });

  it('returns 500 when TELEGRAM_WEBHOOK_SECRET is missing', async () => {
    delete process.env.TELEGRAM_WEBHOOK_SECRET;
    const res = await POST(makeRequest('POST', 'internal-secret'));
    expect(res.status).toBe(500);
    const body = await res.json() as { error: string };
    expect(body.error).toMatch(/TELEGRAM_WEBHOOK_SECRET/);
    expect(vi.mocked(setTelegramWebhook)).not.toHaveBeenCalled();
  });

  it('calls setTelegramWebhook with the derived URL and returns ok', async () => {
    const res = await POST(makeRequest('POST', 'internal-secret'));
    expect(res.status).toBe(200);
    const body = await res.json() as { ok: boolean; description?: string };
    expect(body.ok).toBe(true);
    expect(vi.mocked(setTelegramWebhook)).toHaveBeenCalledOnce();
    const [callOpts] = vi.mocked(setTelegramWebhook).mock.calls[0];
    expect(callOpts.url).toBe('https://nibbin.com/api/channels/telegram');
    expect(callOpts.botToken).toBe('bot-token');
    expect(callOpts.secret).toBe('webhook-secret');
  });

  it('uses TELEGRAM_WEBHOOK_URL override when set', async () => {
    process.env.TELEGRAM_WEBHOOK_URL = 'https://custom.example.com/webhook';
    const res = await POST(makeRequest('POST', 'internal-secret'));
    expect(res.status).toBe(200);
    const [callOpts] = vi.mocked(setTelegramWebhook).mock.calls[0];
    expect(callOpts.url).toBe('https://custom.example.com/webhook');
  });
});

describe('GET /api/internal/telegram/register-webhook', () => {
  it('returns 401 without the internal secret', async () => {
    const res = await GET(makeRequest('GET'));
    expect(res.status).toBe(401);
    expect(vi.mocked(getTelegramWebhookInfo)).not.toHaveBeenCalled();
  });

  it('returns 500 when TELEGRAM_BOT_TOKEN is missing', async () => {
    delete process.env.TELEGRAM_BOT_TOKEN;
    const res = await GET(makeRequest('GET', 'internal-secret'));
    expect(res.status).toBe(500);
    expect(vi.mocked(getTelegramWebhookInfo)).not.toHaveBeenCalled();
  });

  it('returns webhook info when authorized and configured', async () => {
    const res = await GET(makeRequest('GET', 'internal-secret'));
    expect(res.status).toBe(200);
    const body = await res.json() as { ok: boolean; url?: string };
    expect(body.ok).toBe(true);
    expect(body.url).toBe('https://nibbin.com/api/channels/telegram');
    expect(vi.mocked(getTelegramWebhookInfo)).toHaveBeenCalledOnce();
    const [callOpts] = vi.mocked(getTelegramWebhookInfo).mock.calls[0];
    expect(callOpts.botToken).toBe('bot-token');
  });
});
