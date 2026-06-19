// One-time go-live helper: registers (and inspects) the Telegram webhook.
// Pure over an injected fetch so it is unit-testable; no env access here.

export interface SetWebhookOpts {
  botToken: string;
  url: string;
  secret: string;
  fetchImpl?: typeof fetch;
}

export async function setTelegramWebhook(opts: SetWebhookOpts): Promise<{ ok: boolean; description?: string }> {
  const f = opts.fetchImpl ?? fetch;
  const res = await f(`https://api.telegram.org/bot${opts.botToken}/setWebhook`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      url: opts.url,
      secret_token: opts.secret,
      allowed_updates: ['message', 'callback_query'],
    }),
  });
  const json = (await res.json().catch(() => ({}))) as { ok?: boolean; description?: string };
  return { ok: res.ok && json.ok === true, description: json.description };
}

export async function getTelegramWebhookInfo(opts: { botToken: string; fetchImpl?: typeof fetch }): Promise<{ ok: boolean; url?: string; description?: string }> {
  const f = opts.fetchImpl ?? fetch;
  const res = await f(`https://api.telegram.org/bot${opts.botToken}/getWebhookInfo`);
  const json = (await res.json().catch(() => ({}))) as { ok?: boolean; result?: { url?: string }; description?: string };
  return { ok: res.ok && json.ok === true, url: json.result?.url, description: json.description };
}
