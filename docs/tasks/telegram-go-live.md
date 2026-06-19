# Telegram Go-Live Runbook

Cross-reference: [reach-me-offline-enablement.md](reach-me-offline-enablement.md) (Telegram section).

The Telegram channel is code-complete. This runbook covers the one-time webhook
registration that activates it in a deployed environment.

---

## Prerequisites

- A deployed Nibbin web environment (Vercel preview or production).
- `INTERNAL_API_SECRET` set in Vercel env vars (the shared server-to-server secret used by all internal routes).

---

## Step 1 — Create the bot via BotFather

1. Open Telegram and search for `@BotFather`.
2. Send `/newbot` and follow the prompts (name + username).
3. BotFather replies with the **bot token** (format: `<id>:<hash>`). Keep it secret.
4. Note the **bot username** (e.g. `nibbinbot`) — you will set it as `NEXT_PUBLIC_TELEGRAM_BOT`.

---

## Step 2 — Set environment variables in Vercel

In your Vercel project settings → Environment Variables, add:

| Variable | Value |
|---|---|
| `TELEGRAM_BOT_TOKEN` | The token from BotFather |
| `TELEGRAM_WEBHOOK_SECRET` | A random 32-byte hex string (see below) |
| `NEXT_PUBLIC_TELEGRAM_BOT` | The bot username (without `@`) |
| `TELEGRAM_WEBHOOK_URL` | *(optional)* Override the webhook target. If unset, the route derives `<NEXT_PUBLIC_SITE_URL>/api/channels/telegram`. |

Generate the webhook secret:

```sh
openssl rand -hex 32
```

**Redeploy** the Vercel project after setting env vars so they are picked up.

---

## Step 3 — Register the webhook

Call the internal route from a trusted context (your machine, a CI secret, the
admin app):

```sh
curl -X POST https://nibbin.com/api/internal/telegram/register-webhook \
  -H "Authorization: Bearer $INTERNAL_API_SECRET"
```

Expected response:

```json
{ "ok": true, "description": "Webhook was set" }
```

If `ok` is `false`, the `description` field contains the Telegram error. Common causes:

- `TELEGRAM_BOT_TOKEN` not set or wrong → 500 with a clear error message.
- `TELEGRAM_WEBHOOK_SECRET` not set → 500 with a clear error message.
- Token malformed → Telegram returns `Bad Request: invalid bot token`.

---

## Step 4 — Verify the webhook is registered

```sh
curl https://nibbin.com/api/internal/telegram/register-webhook \
  -H "Authorization: Bearer $INTERNAL_API_SECRET"
```

Expected response (the registered URL should match what you set):

```json
{ "ok": true, "url": "https://nibbin.com/api/channels/telegram" }
```

---

## Step 5 — Enable the channel and smoke-test

1. Set `CHANNELS_TELEGRAM_ENABLED=true` in Vercel env vars and redeploy.
2. Open Telegram, search for your bot (`@<NEXT_PUBLIC_TELEGRAM_BOT>`), send `/start`.
3. Verify the connect/link flow works as described in the reach-me connect spec (spec §5):
   - The bot replies with the account-link deep-link URL.
   - After approving in the app, the bot acknowledges and the channel status shows `verified` in settings.
4. Send an approval-required notification in the app; verify the Telegram message arrives and the approve/deny tap-buttons work.

---

## Troubleshooting

| Symptom | Check |
|---|---|
| `POST /register-webhook` returns 401 | `INTERNAL_API_SECRET` env var missing or wrong Bearer token |
| `POST /register-webhook` returns 500 with `TELEGRAM_BOT_TOKEN` | Env var not set or Vercel not redeployed |
| Telegram bot does not respond to `/start` | `CHANNELS_TELEGRAM_ENABLED` is not `true`; or webhook not registered; or `TELEGRAM_WEBHOOK_SECRET` mismatch |
| `/api/channels/telegram` returns 401 | Telegram signature header `X-Telegram-Bot-Api-Secret-Token` does not match `TELEGRAM_WEBHOOK_SECRET` |
| Approval tap-buttons do nothing | Check the callback route and that the bot token is correct |

---

## Re-registration

The webhook can be re-registered at any time (e.g. after a domain change) by
repeating Step 3. Telegram silently replaces the existing registration.
