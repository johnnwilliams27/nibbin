# Reach-Me Channels 03 — Inbound Ingest & Identity Verification Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn raw provider webhooks into verified, redaction-aware `InboundChannelMessage`s — channel-linking via the one-time nonce (N4), per-channel webhook signature verification, identity resolution of every inbound to a verified `(channel, external_id) → account` binding (N-P3), unverified-drop **pre-LLM**, and `applyBattery()` + `quarantine()` before anything is persisted (N10).

**Architecture:** Provider-specific parsers + signature verifiers live in `@nibbin/channels` (pure, injected-secret, unit-tested). The ingest pipeline (`apps/web/lib/channels/ingest.ts`) resolves identity against `notification_channels` under the **service role**, drops anything that doesn't bind to a verified channel (no info-leaking reply), redacts + quarantines the text, and writes an inbound `channel_messages` row. The Telegram `/start <nonce>` path calls the Plan 01 `verify_channel_binding` RPC to complete linking. Thin Next route handlers (`apps/web/app/api/channels/<channel>/route.ts`) verify the signature and call the pipeline. The conversation orchestrator that *acts on* a verified inbound is Plan 05 — this plan stops at "verified, redacted, persisted, handed off."

**Tech Stack:** `@nibbin/channels` (parsers/verifiers), Next App Router route handlers, `@nibbin/redaction` (`applyBattery`), `@nibbin/connectors` (`quarantine`), Supabase service-role client, Vitest.

## Global Constraints
- **N-P3 anti-spoof:** act on an inbound only after it binds to a verified `(channel, external_id)`. No match → ignored + flagged, **no reply**. Signature verification happens **before** parsing; a bad signature → 401, no body processed.
- **Unverified dropped pre-LLM (N15/§11):** the pipeline persists/hands-off only verified inbound; unverified is dropped before any model call (zero cost).
- **Redaction-before-storage (N10):** raw provider text is never persisted in the conversation/memory path. `applyBattery()` runs, then `quarantine()` wraps it; only `redacted_text` + `redaction_rules` land in `channel_messages`.
- **Secret boundary (N-P2):** the pipeline never accepts a secret typed into a channel; a reply that looks like a credential is still just redacted text — secrets are only entered in the app.
- Signatures: Telegram = `X-Telegram-Bot-Api-Secret-Token` constant-compare; Twilio = `X-Twilio-Signature` HMAC-SHA1 over URL+sorted-params; WhatsApp/Meta = `X-Hub-Signature-256` HMAC-SHA256 over the raw body. Use `crypto.timingSafeEqual`.
- SMS/WhatsApp routes are built but **inert** behind the same `CHANNELS_*_ENABLED` flags as Plan 02 (return 503 when disabled).

## File Structure
- **Create** `supabase/migrations/20260618050000_notifications_reach_kind.sql` — additive: allow `notifications.kind = 'reach'` (the floor's reach/escalation leaf).
- **Create** `packages/channels/src/inbound/types.ts` — `InboundChannelMessage`, `InboundResult`.
- **Create** `packages/channels/src/inbound/telegram.ts`, `inbound/sms.ts`, `inbound/whatsapp.ts` — parsers + signature verifiers + deep-link builders.
- **Modify** `packages/channels/src/index.ts` — export the inbound surface.
- **Create** `apps/web/lib/channels/ingest.ts` — the identity-resolving, redacting ingest pipeline.
- **Create** `apps/web/app/api/channels/telegram/route.ts`, `.../sms/route.ts`, `.../whatsapp/route.ts` — webhook handlers.
- Tests under `packages/channels/test/inbound-*.test.ts` and `apps/web/lib/channels/ingest.test.ts`.

---

### Task 1: The `'reach'` notifications kind (migration)

**Files:**
- Create: `supabase/migrations/20260618050000_notifications_reach_kind.sql`

- [ ] **Step 1: Write the migration**

```sql
-- The reach-me floor (Plan 02 floorAdapter) and inbound replies persist an
-- in-app leaf of kind 'reach' (escalations/replies surfaced in the app when a
-- channel is undeliverable or for the in-app mirror). Additive: widen the
-- existing CHECK from ('beat','evolution','graduation') to include 'reach'.
alter table public.notifications drop constraint notifications_kind_check;
alter table public.notifications
  add constraint notifications_kind_check
  check (kind in ('beat', 'evolution', 'graduation', 'reach'));
```

> NOTE: confirm the constraint's actual name first (`\d+ public.notifications` shows it; CHECK constraints created inline are auto-named `<table>_<col>_check` → `notifications_kind_check`). If the dump shows a different name, use it.

- [ ] **Step 2: Do NOT apply.** Verify the constraint name. Commit.
```bash
git add supabase/migrations/20260618050000_notifications_reach_kind.sql
git commit -m "feat(db): allow notifications.kind='reach' for the reach-me floor"
```

(Then update Plan 02's `floorAdapter` to emit `kind: 'reach'` for non-beat messages, replacing the temporary `'beat'` constant — do this as a one-line follow-up commit in this task once the migration exists.)

---

### Task 2: Inbound types + Telegram parser/verifier/deep-link

**Files:**
- Create: `packages/channels/src/inbound/types.ts`, `packages/channels/src/inbound/telegram.ts`
- Modify: `packages/channels/src/index.ts`
- Test: `packages/channels/test/inbound-telegram.test.ts`

**Interfaces:**
- Produces:
  - `interface InboundChannelMessage { channel: ChannelKind; externalId: string; text: string; inReplyTo?: string; action?: 'approve' | 'deny'; startNonce?: string; receivedAt: number }`
  - `interface InboundResult { status: 'accepted' | 'ignored_unverified' | 'ignored_expired' | 'bad_signature' | 'linked' }`
  - `parseTelegramUpdate(update: unknown, now: number): InboundChannelMessage | null`
  - `verifyTelegramSecret(expected: string, header: string | null): boolean`
  - `telegramStartLink(botUsername: string, nonce: string): string`

- [ ] **Step 1: Write the failing test**

Create `packages/channels/test/inbound-telegram.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import { parseTelegramUpdate, verifyTelegramSecret, telegramStartLink } from '@nibbin/channels';

describe('telegram inbound', () => {
  it('parses a /start <nonce> as a link request', () => {
    const m = parseTelegramUpdate({ message: { chat: { id: 987, username: 'maya' }, text: '/start ab12cd' } }, 1000);
    expect(m).toMatchObject({ channel: 'telegram', externalId: '987', startNonce: 'ab12cd', receivedAt: 1000 });
  });
  it('parses a plain message', () => {
    const m = parseTelegramUpdate({ message: { chat: { id: 987 }, text: 'what is my grove doing?' } }, 1);
    expect(m).toMatchObject({ externalId: '987', text: 'what is my grove doing?' });
    expect(m?.startNonce).toBeUndefined();
  });
  it('parses a callback button press into inReplyTo + action', () => {
    const m = parseTelegramUpdate({ callback_query: { message: { chat: { id: 987 } }, data: 'r1:approve' } }, 1);
    expect(m).toMatchObject({ externalId: '987', inReplyTo: 'r1', action: 'approve' });
  });
  it('returns null for an update with no actionable content', () => {
    expect(parseTelegramUpdate({ edited_message: {} }, 1)).toBeNull();
  });
  it('verifies the secret token (constant-time) and builds the start link', () => {
    expect(verifyTelegramSecret('s3cret', 's3cret')).toBe(true);
    expect(verifyTelegramSecret('s3cret', 'nope')).toBe(false);
    expect(verifyTelegramSecret('s3cret', null)).toBe(false);
    expect(telegramStartLink('NibbinBot', 'ab12cd')).toBe('https://t.me/NibbinBot?start=ab12cd');
  });
});
```

- [ ] **Step 2: Run to verify it fails** — FAIL.

- [ ] **Step 3: Implement**

`packages/channels/src/inbound/types.ts`:
```ts
import type { ChannelKind } from '../types.js';

export interface InboundChannelMessage {
  channel: ChannelKind;
  externalId: string;
  text: string;
  inReplyTo?: string;      // a requestId, parsed from a button/keyword
  action?: 'approve' | 'deny';
  startNonce?: string;     // a linking nonce
  receivedAt: number;      // epoch ms
}

export interface InboundResult {
  status: 'accepted' | 'ignored_unverified' | 'ignored_expired' | 'bad_signature' | 'linked';
}
```

`packages/channels/src/inbound/telegram.ts`:
```ts
import { timingSafeEqual } from 'node:crypto';
import type { InboundChannelMessage } from './types.js';

function safeEq(a: string, b: string): boolean {
  const ab = Buffer.from(a), bb = Buffer.from(b);
  return ab.length === bb.length && timingSafeEqual(ab, bb);
}

export function verifyTelegramSecret(expected: string, header: string | null): boolean {
  return header != null && safeEq(expected, header);
}

export function telegramStartLink(botUsername: string, nonce: string): string {
  return `https://t.me/${botUsername}?start=${nonce}`;
}

export function parseTelegramUpdate(update: unknown, now: number): InboundChannelMessage | null {
  const u = update as any;
  if (u?.callback_query) {
    const chatId = u.callback_query.message?.chat?.id;
    const data = String(u.callback_query.data ?? '');
    if (chatId == null) return null;
    const [requestId, action] = data.split(':');
    return {
      channel: 'telegram', externalId: String(chatId), text: data, receivedAt: now,
      inReplyTo: requestId || undefined,
      action: action === 'approve' || action === 'deny' ? action : undefined,
    };
  }
  const msg = u?.message;
  if (msg?.chat?.id == null || typeof msg.text !== 'string') return null;
  const startMatch = /^\/start\s+(\S+)/.exec(msg.text);
  return {
    channel: 'telegram',
    externalId: String(msg.chat.id),
    text: msg.text,
    startNonce: startMatch ? startMatch[1] : undefined,
    receivedAt: now,
  };
}
```

In `packages/channels/src/index.ts` add:
```ts
export * from './inbound/types.js';
export { parseTelegramUpdate, verifyTelegramSecret, telegramStartLink } from './inbound/telegram.js';
```

- [ ] **Step 4: Run to verify it passes** — PASS.

- [ ] **Step 5: Commit**
```bash
git add packages/channels/src/inbound/types.ts packages/channels/src/inbound/telegram.ts packages/channels/src/index.ts packages/channels/test/inbound-telegram.test.ts
git commit -m "feat(channels): telegram inbound parser + secret verify + start-link"
```

---

### Task 3: SMS + WhatsApp parsers/verifiers (inert)

**Files:**
- Create: `packages/channels/src/inbound/sms.ts`, `packages/channels/src/inbound/whatsapp.ts`
- Modify: `packages/channels/src/index.ts`
- Test: `packages/channels/test/inbound-sms.test.ts`, `packages/channels/test/inbound-whatsapp.test.ts`

**Interfaces:**
- Produces: `parseTwilioInbound(form: URLSearchParams, now): InboundChannelMessage | null`; `verifyTwilioSignature(authToken, url, params: Record<string,string>, header: string|null): boolean`; `parseWhatsAppWebhook(body, now): InboundChannelMessage | null`; `verifyMetaSignature(appSecret, rawBody: string, header: string|null): boolean`.

- [ ] **Step 1: Write the failing tests**

Create `packages/channels/test/inbound-sms.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import { parseTwilioInbound, verifyTwilioSignature } from '@nibbin/channels';
import { createHmac } from 'node:crypto';

describe('twilio inbound', () => {
  it('parses From + Body and maps APPROVE/DENY keywords to actions', () => {
    const m = parseTwilioInbound(new URLSearchParams({ From: '+15551234567', Body: 'APPROVE' }), 5);
    expect(m).toMatchObject({ channel: 'sms', externalId: '+15551234567', action: 'approve', receivedAt: 5 });
    const n = parseTwilioInbound(new URLSearchParams({ From: '+1', Body: 'chase the overdue ones' }), 5);
    expect(n?.action).toBeUndefined();
    expect(n?.text).toBe('chase the overdue ones');
  });
  it('verifies the X-Twilio-Signature (HMAC-SHA1 over url + sorted params)', () => {
    const url = 'https://nibbin.com/api/channels/sms';
    const params = { From: '+1', Body: 'hi' };
    const data = url + 'Body' + 'hi' + 'From' + '+1';
    const sig = createHmac('sha1', 'tok').update(data).digest('base64');
    expect(verifyTwilioSignature('tok', url, params, sig)).toBe(true);
    expect(verifyTwilioSignature('tok', url, params, 'bad')).toBe(false);
  });
});
```

Create `packages/channels/test/inbound-whatsapp.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import { parseWhatsAppWebhook, verifyMetaSignature } from '@nibbin/channels';
import { createHmac } from 'node:crypto';

describe('whatsapp inbound', () => {
  it('parses a text message and a button reply', () => {
    const text = parseWhatsAppWebhook({ entry: [{ changes: [{ value: { messages: [{ from: '15551', type: 'text', text: { body: 'hello' } }] } }] }] }, 9);
    expect(text).toMatchObject({ channel: 'whatsapp', externalId: '15551', text: 'hello' });
    const btn = parseWhatsAppWebhook({ entry: [{ changes: [{ value: { messages: [{ from: '15551', type: 'interactive', interactive: { button_reply: { id: 'r1:deny', title: 'Deny' } } }] } }] }] }, 9);
    expect(btn).toMatchObject({ inReplyTo: 'r1', action: 'deny' });
  });
  it('verifies the X-Hub-Signature-256', () => {
    const raw = '{"a":1}';
    const sig = 'sha256=' + createHmac('sha256', 'appsecret').update(raw).digest('hex');
    expect(verifyMetaSignature('appsecret', raw, sig)).toBe(true);
    expect(verifyMetaSignature('appsecret', raw, 'sha256=bad')).toBe(false);
  });
});
```

- [ ] **Step 2: Run to verify they fail** — FAIL.

- [ ] **Step 3: Implement**

`packages/channels/src/inbound/sms.ts`:
```ts
import { createHmac, timingSafeEqual } from 'node:crypto';
import type { InboundChannelMessage } from './types.js';

export function parseTwilioInbound(form: URLSearchParams, now: number): InboundChannelMessage | null {
  const from = form.get('From');
  const body = form.get('Body');
  if (!from || body == null) return null;
  const upper = body.trim().toUpperCase();
  const action = upper === 'APPROVE' ? 'approve' : upper === 'DENY' ? 'deny' : undefined;
  return { channel: 'sms', externalId: from, text: body, action, receivedAt: now };
}

export function verifyTwilioSignature(
  authToken: string, url: string, params: Record<string, string>, header: string | null,
): boolean {
  if (!header) return false;
  const data = url + Object.keys(params).sort().map((k) => k + params[k]).join('');
  const expected = createHmac('sha1', authToken).update(data).digest('base64');
  const a = Buffer.from(expected), b = Buffer.from(header);
  return a.length === b.length && timingSafeEqual(a, b);
}
```

`packages/channels/src/inbound/whatsapp.ts`:
```ts
import { createHmac, timingSafeEqual } from 'node:crypto';
import type { InboundChannelMessage } from './types.js';

export function parseWhatsAppWebhook(body: unknown, now: number): InboundChannelMessage | null {
  const msg = (body as any)?.entry?.[0]?.changes?.[0]?.value?.messages?.[0];
  if (!msg?.from) return null;
  if (msg.type === 'text' && msg.text?.body) {
    return { channel: 'whatsapp', externalId: String(msg.from), text: msg.text.body, receivedAt: now };
  }
  const reply = msg.interactive?.button_reply;
  if (reply?.id) {
    const [requestId, action] = String(reply.id).split(':');
    return {
      channel: 'whatsapp', externalId: String(msg.from), text: reply.title ?? reply.id, receivedAt: now,
      inReplyTo: requestId || undefined,
      action: action === 'approve' || action === 'deny' ? action : undefined,
    };
  }
  return null;
}

export function verifyMetaSignature(appSecret: string, rawBody: string, header: string | null): boolean {
  if (!header) return false;
  const expected = 'sha256=' + createHmac('sha256', appSecret).update(rawBody).digest('hex');
  const a = Buffer.from(expected), b = Buffer.from(header);
  return a.length === b.length && timingSafeEqual(a, b);
}
```

In `index.ts` add:
```ts
export { parseTwilioInbound, verifyTwilioSignature } from './inbound/sms.js';
export { parseWhatsAppWebhook, verifyMetaSignature } from './inbound/whatsapp.js';
```

- [ ] **Step 4: Run to verify they pass** — PASS.

- [ ] **Step 5: Commit**
```bash
git add packages/channels/src/inbound/sms.ts packages/channels/src/inbound/whatsapp.ts packages/channels/src/index.ts packages/channels/test/inbound-sms.test.ts packages/channels/test/inbound-whatsapp.test.ts
git commit -m "feat(channels): SMS + WhatsApp inbound parsers + signature verifiers"
```

---

### Task 4: The ingest pipeline (identity resolution + redaction)

**Files:**
- Create: `apps/web/lib/channels/ingest.ts`
- Test: `apps/web/lib/channels/ingest.test.ts`

**Interfaces:**
- Consumes: `InboundChannelMessage`, `InboundResult`; `applyBattery` (`@nibbin/redaction`); `quarantine` (`@nibbin/connectors`); the Plan 01 `verify_channel_binding` RPC + `notification_channels` lookup + `channel_messages` insert.
- Produces: `ingestInbound(inbound: InboundChannelMessage, deps: IngestDeps): Promise<InboundResult>` and
  `interface IngestDeps { resolveAccount(channel, externalId): Promise<string | null>; verifyBinding(nonce, externalId, label?): Promise<string | null>; persistInbound(row): Promise<void>; handoff(verified): Promise<void>; }`
- Behavior:
  1. `startNonce` present → `verifyBinding` → `{status: nonce ? 'linked' : 'ignored_expired'}` (no further processing).
  2. else `resolveAccount(channel, externalId)` → null → `{status:'ignored_unverified'}` (dropped pre-LLM, nothing persisted).
  3. else redact (`applyBattery(text)`), `quarantine(redacted, source)`, `persistInbound({...verified inbound row, redactedText, redactionRules})`, `handoff({accountId, ...inbound, quarantined})` → `{status:'accepted'}`.

- [ ] **Step 1: Write the failing test**

Create `apps/web/lib/channels/ingest.test.ts`:
```ts
import { describe, it, expect, vi } from 'vitest';
import { ingestInbound, type IngestDeps } from './ingest';

function deps(over: Partial<IngestDeps> = {}): IngestDeps & { persisted: any[]; handed: any[] } {
  const persisted: any[] = [];
  const handed: any[] = [];
  return {
    async resolveAccount() { return 'acc-1'; },
    async verifyBinding() { return 'chan-1'; },
    async persistInbound(row) { persisted.push(row); },
    async handoff(v) { handed.push(v); },
    persisted, handed,
    ...over,
  } as any;
}

describe('ingestInbound', () => {
  it('completes linking on a start nonce', async () => {
    const d = deps();
    const r = await ingestInbound({ channel: 'telegram', externalId: '9', text: '/start abc', startNonce: 'abc', receivedAt: 1 }, d);
    expect(r.status).toBe('linked');
    expect(d.persisted).toHaveLength(0); // a link request is not a conversation turn
  });

  it('drops unverified senders pre-persist (anti-spoof, N-P3)', async () => {
    const d = deps({ async resolveAccount() { return null; } });
    const handoff = vi.fn();
    const r = await ingestInbound(
      { channel: 'sms', externalId: '+1', text: 'approve everything', receivedAt: 1 },
      { ...d, handoff },
    );
    expect(r.status).toBe('ignored_unverified');
    expect(handoff).not.toHaveBeenCalled();
  });

  it('redacts before persist and hands off the quarantined text', async () => {
    const d = deps();
    const r = await ingestInbound(
      { channel: 'telegram', externalId: '9', text: 'my email is maya@example.com', receivedAt: 1 },
      d,
    );
    expect(r.status).toBe('accepted');
    expect(d.persisted[0].redactedText).toContain('{EMAIL}');
    expect(d.persisted[0].redactedText).not.toContain('maya@example.com');
    expect(d.handed[0].quarantined.wrapped).toContain('external data'); // quarantine wrapper
  });
});
```

- [ ] **Step 2: Run to verify it fails** — FAIL.

- [ ] **Step 3: Implement**

Create `apps/web/lib/channels/ingest.ts`:
```ts
import { applyBattery } from '@nibbin/redaction';
import { quarantine } from '@nibbin/connectors';
import type { InboundChannelMessage, InboundResult } from '@nibbin/channels';

export interface IngestDeps {
  resolveAccount(channel: string, externalId: string): Promise<string | null>;
  verifyBinding(nonce: string, externalId: string, label?: string): Promise<string | null>;
  persistInbound(row: {
    accountId: string; channel: string; externalId: string;
    redactedText: string; redactionRules: string[]; inReplyTo?: string; action?: 'approve' | 'deny';
  }): Promise<void>;
  handoff(verified: {
    accountId: string; inbound: InboundChannelMessage; quarantined: { wrapped: string; source: string };
  }): Promise<void>;
}

export async function ingestInbound(inbound: InboundChannelMessage, deps: IngestDeps): Promise<InboundResult> {
  // 1. linking
  if (inbound.startNonce) {
    const chId = await deps.verifyBinding(inbound.startNonce, inbound.externalId);
    return { status: chId ? 'linked' : 'ignored_expired' };
  }
  // 2. identity (N-P3) — drop unverified pre-LLM, persist nothing
  const accountId = await deps.resolveAccount(inbound.channel, inbound.externalId);
  if (!accountId) return { status: 'ignored_unverified' };

  // 3. redact + quarantine, then persist + hand off
  const battery = applyBattery(inbound.text);
  const quarantined = quarantine(battery.text, `${inbound.channel}:${accountId}:${inbound.externalId}`);
  await deps.persistInbound({
    accountId, channel: inbound.channel, externalId: inbound.externalId,
    redactedText: battery.text, redactionRules: battery.rulesHit,
    inReplyTo: inbound.inReplyTo, action: inbound.action,
  });
  await deps.handoff({ accountId, inbound, quarantined: { wrapped: quarantined.wrapped, source: quarantined.source } });
  return { status: 'accepted' };
}
```

- [ ] **Step 4: Run to verify it passes** — PASS.

- [ ] **Step 5: Commit**
```bash
git add apps/web/lib/channels/ingest.ts apps/web/lib/channels/ingest.test.ts
git commit -m "feat(web): inbound ingest — identity resolution, unverified drop, redaction-aware persist"
```

---

### Task 5: Webhook route handlers + Supabase ingest deps

**Files:**
- Create: `apps/web/app/api/channels/telegram/route.ts`, `apps/web/app/api/channels/sms/route.ts`, `apps/web/app/api/channels/whatsapp/route.ts`
- Create: `apps/web/lib/channels/ingest-deps.ts` — builds `IngestDeps` over the service-role client.
- Test: `apps/web/app/api/channels/telegram/route.test.ts`

**Interfaces:**
- Consumes: parsers/verifiers (Tasks 2–3), `ingestInbound` (Task 4); the service-role Supabase client helper (find the existing one — search `apps/web/lib` for `serviceClient`/`createServiceClient`/`SUPABASE_SECRET_KEY`).
- Produces: `supabaseIngestDeps(svc): IngestDeps` (resolveAccount → `notification_channels` verified lookup; verifyBinding → `verify_channel_binding` RPC; persistInbound → `channel_messages` insert direction='inbound', verified=true; handoff → enqueue for Plan 05 — for now insert the 'reach' floor leaf + a no-op event).

- [ ] **Step 1: Write the failing test** (route-level, signature gate + happy path)

Create `apps/web/app/api/channels/telegram/route.test.ts`:
```ts
import { describe, it, expect, vi } from 'vitest';

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
```
(Add `import { beforeAll, afterAll } from 'vitest'` at the top.)

- [ ] **Step 2: Run to verify it fails** — FAIL (`./route` missing).

- [ ] **Step 3: Implement the Telegram route**

Create `apps/web/app/api/channels/telegram/route.ts`:
```ts
import { NextResponse } from 'next/server';
import { parseTelegramUpdate, verifyTelegramSecret } from '@nibbin/channels';
import { ingestInbound } from '../../../../lib/channels/ingest';
import { supabaseIngestDeps } from '../../../../lib/channels/ingest-deps';

export async function POST(req: Request): Promise<Response> {
  const secret = process.env.TELEGRAM_WEBHOOK_SECRET ?? '';
  if (!verifyTelegramSecret(secret, req.headers.get('x-telegram-bot-api-secret-token'))) {
    return NextResponse.json({ ok: false }, { status: 401 });
  }
  const update = await req.json().catch(() => null);
  const msg = parseTelegramUpdate(update, Date.now());
  if (!msg) return NextResponse.json({ ok: true }); // nothing actionable; ack so Telegram stops retrying
  await ingestInbound(msg, supabaseIngestDeps());
  return NextResponse.json({ ok: true });
}
```

Create `apps/web/lib/channels/ingest-deps.ts`:
```ts
import { createServiceClient } from '../supabase/service'; // <-- ADJUST to the real helper found in Step 1 search
import type { IngestDeps } from './ingest';

export function supabaseIngestDeps(): IngestDeps {
  const svc = createServiceClient();
  return {
    async resolveAccount(channel, externalId) {
      const { data } = await svc.from('notification_channels')
        .select('account_id').eq('channel', channel).eq('external_id', externalId).eq('status', 'verified').maybeSingle();
      return data?.account_id ?? null;
    },
    async verifyBinding(nonce, externalId, label) {
      const { data } = await svc.rpc('verify_channel_binding', { p_nonce: nonce, p_external_id: externalId, p_external_label: label ?? null });
      return (data as string | null) ?? null;
    },
    async persistInbound(row) {
      await svc.from('channel_messages').insert({
        account_id: row.accountId, channel: row.channel, direction: 'inbound', kind: 'inbound',
        status: 'received', verified: true, redacted_text: row.redactedText, redaction_rules: row.redactionRules,
        request_id: row.inReplyTo ?? null,
      });
    },
    async handoff() {
      // Plan 05 consumes the verified inbound (escalation reply -> approval gate;
      // chat -> Grovekeeper). Until then this is a no-op; the inbound row is
      // persisted above for observability.
    },
  };
}
```

- [ ] **Step 4: Implement the SMS + WhatsApp routes (inert behind their flags)**

Create `apps/web/app/api/channels/sms/route.ts`:
```ts
import { NextResponse } from 'next/server';
import { parseTwilioInbound, verifyTwilioSignature } from '@nibbin/channels';
import { ingestInbound } from '../../../../lib/channels/ingest';
import { supabaseIngestDeps } from '../../../../lib/channels/ingest-deps';

export async function POST(req: Request): Promise<Response> {
  if (process.env.CHANNELS_SMS_ENABLED !== 'true') return NextResponse.json({ ok: false }, { status: 503 });
  const raw = await req.text();
  const params = Object.fromEntries(new URLSearchParams(raw));
  const url = process.env.SMS_WEBHOOK_URL ?? req.url;
  if (!verifyTwilioSignature(process.env.TWILIO_AUTH_TOKEN ?? '', url, params, req.headers.get('x-twilio-signature'))) {
    return NextResponse.json({ ok: false }, { status: 401 });
  }
  const msg = parseTwilioInbound(new URLSearchParams(raw), Date.now());
  if (msg) await ingestInbound(msg, supabaseIngestDeps());
  // STOP/HELP handling (TCPA) is Plan 06; for now ack with empty TwiML.
  return new NextResponse('<Response></Response>', { status: 200, headers: { 'content-type': 'text/xml' } });
}
```

Create `apps/web/app/api/channels/whatsapp/route.ts`:
```ts
import { NextResponse } from 'next/server';
import { parseWhatsAppWebhook, verifyMetaSignature } from '@nibbin/channels';
import { ingestInbound } from '../../../../lib/channels/ingest';
import { supabaseIngestDeps } from '../../../../lib/channels/ingest-deps';

// Meta verification handshake (GET) — echo hub.challenge when the verify token matches.
export async function GET(req: Request): Promise<Response> {
  const u = new URL(req.url);
  if (u.searchParams.get('hub.verify_token') === (process.env.WHATSAPP_VERIFY_TOKEN ?? '')) {
    return new NextResponse(u.searchParams.get('hub.challenge') ?? '', { status: 200 });
  }
  return NextResponse.json({ ok: false }, { status: 403 });
}

export async function POST(req: Request): Promise<Response> {
  if (process.env.CHANNELS_WHATSAPP_ENABLED !== 'true') return NextResponse.json({ ok: false }, { status: 503 });
  const raw = await req.text();
  if (!verifyMetaSignature(process.env.WHATSAPP_APP_SECRET ?? '', raw, req.headers.get('x-hub-signature-256'))) {
    return NextResponse.json({ ok: false }, { status: 401 });
  }
  const msg = parseWhatsAppWebhook(JSON.parse(raw), Date.now());
  if (msg) await ingestInbound(msg, supabaseIngestDeps());
  return NextResponse.json({ ok: true });
}
```

- [ ] **Step 5: Run to verify it passes + typecheck**

Run: `cd /c/nibbin-reach-me && npx vitest run apps/web/app/api/channels/telegram/route.test.ts && npx tsc --noEmit -p apps/web`
Expected: PASS + no type errors. (Fix the `createServiceClient` import path to the real helper.)

- [ ] **Step 6: Commit**
```bash
git add apps/web/app/api/channels apps/web/lib/channels/ingest-deps.ts
git commit -m "feat(web): channel webhooks (telegram live; sms/whatsapp gated) + service-role ingest deps"
```

---

## Self-review notes
- **N3/N4 (identity + link-from-app):** linking only completes via `verify_channel_binding`, which consumes a nonce that could only have come from the authenticated app's `request_channel_link`. Every non-link inbound resolves against verified `notification_channels` or is dropped.
- **N-P3 anti-spoof + pre-LLM drop:** signature verified before parse (bad sig → 401, no processing); unverified sender → `ignored_unverified`, nothing persisted, no handoff, no model call.
- **N10 (redaction-aware):** `applyBattery` + `quarantine` before persist; only `redacted_text` + `rules_hit` stored; the quarantined wrapper is what reaches the model in Plan 05.
- **No info leak:** unknown senders get an empty ack (Telegram/WhatsApp) / empty TwiML (SMS), never a content reply.
- **All-adapters scope:** SMS/WhatsApp routes + parsers complete; POST is inert (503) until `CHANNELS_*_ENABLED`. The WhatsApp GET handshake is ready for Meta's webhook setup.
- **Deferred:** acting on a verified inbound (button press → approval gate; chat → Grovekeeper) is Plan 05's `handoff`; STOP/HELP/consent (TCPA) is Plan 06.
