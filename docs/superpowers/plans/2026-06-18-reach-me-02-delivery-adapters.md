# Reach-Me Channels 02 — Delivery Adapters Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A new `@nibbin/channels` package providing one uniform `ChannelPort.deliver()` interface, the Telegram adapter (fully working), SMS (Twilio) and WhatsApp adapters (complete code, inert until offline registration), the in-app `notifications`-leaf floor adapter, and a dispatcher that walks the per-channel priority order with a fallback chain and logs every send to `channel_messages` with delivery COGS.

**Architecture:** Mirrors `@nibbin/email` exactly — pure adapters behind an injected transport (the `resendProvider(apiKey, fetch)` pattern), returning a typed result, with the side-effecting store/transport injected so everything is unit-testable. The dispatcher is the multi-channel analogue of the drip worker's per-arc delivery (`packages/drip/src/worker.ts:57-121`): claim → deliver → on-failure walk the fallback chain → terminal floor = the in-app `notifications` leaf (which always succeeds). Idempotent sends via a dedup anchor, like `drip_sends`.

**Tech Stack:** TypeScript ESM package (`packages/channels`), Vitest with injected `fetch`; consumes the Plan 01 tables (`notification_channels`, `channel_prefs`, `notification_settings`, `channel_messages`) and the existing `notifications` leaf.

## Global Constraints
- New package name `@nibbin/channels`; `"type": "module"`; `exports: { ".": "./src/index.ts" }`; `tsconfig.json` extends `../../tsconfig.base.json` and includes `src/**/*.ts`, `test/**/*.ts` (mirror `packages/email`).
- Wiring (both required or tsc/tests won't see the package): add `tsc --noEmit -p packages/channels` to the root `package.json` `typecheck` script (between `email` and `apps/web`); add a `@nibbin/channels` alias to `vitest.config.ts` `resolve.alias`.
- `ChannelKind = 'push' | 'email' | 'sms' | 'telegram' | 'whatsapp'`. The dispatcher floor channel is the in-app `notifications` leaf (not a `ChannelKind`).
- Adapters are **pure over an injected transport** — no global `fetch`, no env reads inside the adapter; the caller supplies the token/transport. Return `DeliveryResult`, never throw on a provider error (throwing is reserved for programmer error).
- **SMS + WhatsApp adapters are built but inert:** their code is complete and tested against an injected fake transport, but they are NOT registered in the live port set until Plan 06's env/feature gate clears (`CHANNELS_SMS_ENABLED` / `CHANNELS_WHATSAPP_ENABLED` false by default). No real provider call can happen without the offline registration.
- Secret boundary (N-P2): `deliver()` renders only `body`/`deepLink`/`actions` — never a secret. The Telegram bot token / Twilio auth are transport config, never message fields.
- Brand voice for any fallback/throttle copy: what happened → what's safe → what to do, sentence case.

## File Structure
- **Create** `packages/channels/package.json`, `packages/channels/tsconfig.json`, `packages/channels/src/index.ts`.
- **Create** `packages/channels/src/types.ts` — `ChannelKind`, `OutboundChannelMessage`, `ChannelAction`, `DeliveryResult`, `ChannelPort`.
- **Create** `packages/channels/src/adapters/floor.ts` — in-app `notifications`-leaf adapter (always delivers).
- **Create** `packages/channels/src/adapters/telegram.ts` — Telegram Bot API adapter.
- **Create** `packages/channels/src/adapters/sms.ts` — Twilio adapter (inert).
- **Create** `packages/channels/src/adapters/whatsapp.ts` — WhatsApp Business adapter (inert).
- **Create** `packages/channels/src/dispatch.ts` — `deliverWithFallback` + the `ChannelRegistry`/store ports.
- **Create** tests under `packages/channels/test/`.
- **Modify** `package.json` (root `typecheck` script) and `vitest.config.ts` (alias).
- **Create** `apps/web/lib/channels/ports.ts` — builds the live `ChannelPort[]` from env (Telegram live; SMS/WA gated) + a `ChannelStore` over Supabase.

---

### Task 1: Scaffold the package + wiring

**Files:**
- Create: `packages/channels/package.json`, `packages/channels/tsconfig.json`, `packages/channels/src/index.ts`, `packages/channels/src/types.ts`
- Modify: `package.json`, `vitest.config.ts`
- Test: `packages/channels/test/types.test.ts`

**Interfaces:**
- Produces: the `@nibbin/channels` types below, consumed by every later task and Plans 03/05.

- [ ] **Step 1: Write the failing test**

Create `packages/channels/test/types.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { CHANNEL_KINDS, type OutboundChannelMessage } from '@nibbin/channels';

describe('@nibbin/channels types', () => {
  it('exposes the channel kinds', () => {
    expect(CHANNEL_KINDS).toEqual(['push', 'email', 'sms', 'telegram', 'whatsapp']);
  });
  it('an outbound message never carries a secret field', () => {
    const msg: OutboundChannelMessage = {
      accountId: 'a', channel: 'telegram', externalId: '123',
      kind: 'escalation', urgency: 'high', body: 'Approve the draft?',
    };
    expect(Object.keys(msg)).not.toContain('secret');
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd /c/nibbin-reach-me && npx vitest run packages/channels/test/types.test.ts`
Expected: FAIL — cannot resolve `@nibbin/channels`.

- [ ] **Step 3: Create the package files**

`packages/channels/package.json`:
```json
{
  "name": "@nibbin/channels",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "description": "Multi-channel reach-me delivery (spec §5/§10) — uniform ChannelPort, Telegram/SMS/WhatsApp adapters, fallback chain to the in-app notifications floor.",
  "exports": { ".": "./src/index.ts" },
  "scripts": { "typecheck": "tsc --noEmit" }
}
```

`packages/channels/tsconfig.json`:
```json
{
  "extends": "../../tsconfig.base.json",
  "include": ["src/**/*.ts", "test/**/*.ts"]
}
```

`packages/channels/src/types.ts`:
```ts
export const CHANNEL_KINDS = ['push', 'email', 'sms', 'telegram', 'whatsapp'] as const;
export type ChannelKind = (typeof CHANNEL_KINDS)[number];

export type Urgency = 'normal' | 'high' | 'urgent';
export type OutboundKind = 'escalation' | 'beat' | 'news' | 'reply';

/** A channel-agnostic action affordance (Telegram inline button / WA button /
 *  SMS reply-keyword). `open`/`deepLink` is how the secret boundary (N-P2) is
 *  honored: sensitive steps deep-link to the app instead of collecting on-channel. */
export interface ChannelAction {
  id: string;
  label: string;
  kind: 'approve' | 'deny' | 'open' | 'reply';
  deepLink?: string;
}

export interface OutboundChannelMessage {
  accountId: string;
  channel: ChannelKind;
  externalId: string;            // resolved verified destination (chat id / phone / device token)
  kind: OutboundKind;
  urgency: Urgency;
  body: string;                  // already channel-rendered text; never a secret
  deepLink?: string;
  actions?: ChannelAction[];
  requestId?: string;            // links a runtime AgentRequest/escalation
  expiresAt?: number;            // epoch ms
}

export interface DeliveryResult {
  delivered: boolean;
  providerMessageId?: string;
  costMicroUsd?: number;         // delivery COGS (SMS/WhatsApp); 0 for free channels
  error?: string;                // set when delivered=false
}

/** One per channel, behind a uniform interface (spec §5 "register, not rewrite"). */
export interface ChannelPort {
  readonly channel: ChannelKind;
  deliver(msg: OutboundChannelMessage): Promise<DeliveryResult>;
}
```

`packages/channels/src/index.ts`:
```ts
export * from './types.js';
export { floorAdapter, type NotificationsFloorStore } from './adapters/floor.js';
export { telegramAdapter, type TelegramConfig } from './adapters/telegram.js';
export { smsAdapter, type SmsConfig } from './adapters/sms.js';
export { whatsappAdapter, type WhatsAppConfig } from './adapters/whatsapp.js';
export { deliverWithFallback, type ChannelStore, type DispatchContext, type DispatchResult } from './dispatch.js';
```
(The later exports won't resolve until their tasks land; that's fine — this task only needs `types.ts`. Temporarily comment the not-yet-created exports, uncommenting each as its task completes, OR create empty stub files. Prefer: comment them now, uncomment per task.)

For this task, `index.ts` is just:
```ts
export * from './types.js';
```

- [ ] **Step 4: Wire typecheck + vitest alias**

In root `package.json` `typecheck` script, insert `&& tsc --noEmit -p packages/channels` immediately before `&& tsc --noEmit -p apps/web`.

In `vitest.config.ts` `resolve.alias`, add after the `@nibbin/email` line:
```ts
      '@nibbin/channels': fileURLToPath(new URL('./packages/channels/src/index.ts', import.meta.url)),
```

- [ ] **Step 5: Run to verify it passes**

Run: `cd /c/nibbin-reach-me && npx vitest run packages/channels/test/types.test.ts`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add packages/channels/package.json packages/channels/tsconfig.json packages/channels/src/index.ts packages/channels/src/types.ts packages/channels/test/types.test.ts package.json vitest.config.ts
git commit -m "feat(channels): scaffold @nibbin/channels package + ChannelPort types"
```

---

### Task 2: The in-app notifications floor adapter

**Files:**
- Create: `packages/channels/src/adapters/floor.ts`
- Test: `packages/channels/test/floor.test.ts`

**Interfaces:**
- Consumes: `ChannelPort`, `OutboundChannelMessage`, `DeliveryResult` (Task 1).
- Produces: `floorAdapter(store: NotificationsFloorStore): ChannelPort` and `interface NotificationsFloorStore { insertNotification(accountId, n): Promise<void> }`. The floor is the terminal fallback (§10): it always returns `{ delivered: true }`.

- [ ] **Step 1: Write the failing test**

Create `packages/channels/test/floor.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import { floorAdapter, type NotificationsFloorStore } from '@nibbin/channels';

describe('floorAdapter', () => {
  it('always delivers by writing the in-app notifications leaf', async () => {
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
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd /c/nibbin-reach-me && npx vitest run packages/channels/test/floor.test.ts`
Expected: FAIL — `floorAdapter` not exported.

- [ ] **Step 3: Implement**

Create `packages/channels/src/adapters/floor.ts`:
```ts
import type { ChannelPort, DeliveryResult, OutboundChannelMessage } from '../types.js';

export interface NotificationsFloorStore {
  /** Insert an in-app notifications-leaf row (idempotent on its own anchor). */
  insertNotification(
    accountId: string,
    n: { kind: string; sourceId: string; title: string; body: string; payload: Record<string, unknown> },
  ): Promise<void>;
}

const TITLE: Record<OutboundChannelMessage['kind'], string> = {
  escalation: 'A Nibbin needs you',
  beat: 'A note from your grove',
  news: 'News from your grove',
  reply: 'A reply from your grove',
};

/** The terminal fallback (§10): the in-app leaf always succeeds. */
export function floorAdapter(store: NotificationsFloorStore): ChannelPort {
  return {
    channel: 'push',
    async deliver(msg: OutboundChannelMessage): Promise<DeliveryResult> {
      await store.insertNotification(msg.accountId, {
        kind: msg.kind === 'beat' ? 'beat' : 'reach',
        sourceId: msg.requestId ?? `${msg.kind}:${msg.expiresAt ?? ''}:${msg.body.slice(0, 32)}`,
        title: TITLE[msg.kind],
        body: msg.body,
        payload: { deepLink: msg.deepLink ?? null, actions: msg.actions ?? [], requestId: msg.requestId ?? null },
      });
      return { delivered: true, costMicroUsd: 0 };
    },
  };
}
```
Uncomment the `floor` export in `src/index.ts`.

> NOTE: the `notifications.kind` CHECK currently allows `('beat','evolution','graduation')` (`20260612000000_m5_drip_email.sql:88`). Adding a `'reach'` kind needs an additive migration **in Plan 03** (where inbound/reach notifications first persist). For this task the floor only emits `'beat'`-kind rows (valid today); the `'reach'` kind + its migration are deferred to Plan 03's first task. Adjust `kind` here to `'beat'` constant until then.

- [ ] **Step 4: Run to verify it passes**

Run: `cd /c/nibbin-reach-me && npx vitest run packages/channels/test/floor.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/channels/src/adapters/floor.ts packages/channels/src/index.ts packages/channels/test/floor.test.ts
git commit -m "feat(channels): in-app notifications floor adapter (delivery §10 terminal)"
```

---

### Task 3: Telegram adapter

**Files:**
- Create: `packages/channels/src/adapters/telegram.ts`
- Test: `packages/channels/test/telegram.test.ts`

**Interfaces:**
- Produces: `telegramAdapter(cfg: TelegramConfig): ChannelPort` where `interface TelegramConfig { botToken: string; fetchImpl?: typeof fetch }`. Renders `actions` as an inline keyboard; sends via `sendMessage`; returns `{ delivered, providerMessageId }`. Telegram is free → `costMicroUsd: 0`.

- [ ] **Step 1: Write the failing test**

Create `packages/channels/test/telegram.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import { telegramAdapter } from '@nibbin/channels';

function fakeFetch(captured: { url?: string; body?: any }, ok = true) {
  return (async (url: string, init?: any) => {
    captured.url = url;
    captured.body = JSON.parse(init.body);
    return {
      ok,
      status: ok ? 200 : 400,
      async json() {
        return ok ? { ok: true, result: { message_id: 4242 } } : { ok: false, description: 'blocked' };
      },
    } as any;
  }) as unknown as typeof fetch;
}

describe('telegramAdapter', () => {
  it('sends to the chat id and renders actions as an inline keyboard', async () => {
    const cap: { url?: string; body?: any } = {};
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
    expect(cap.body.chat_id).toBe('987');
    // inline keyboard: callback buttons carry requestId; open is a url button
    const kb = cap.body.reply_markup.inline_keyboard.flat();
    expect(kb.find((b: any) => b.text === 'Approve').callback_data).toBe('r1:approve');
    expect(kb.find((b: any) => b.text === 'Open app').url).toContain('/app/approvals/r1');
  });

  it('returns delivered=false (no throw) on a provider error', async () => {
    const cap: { url?: string; body?: any } = {};
    const port = telegramAdapter({ botToken: 'BOT', fetchImpl: fakeFetch(cap, false) });
    const res = await port.deliver({
      accountId: 'acc', channel: 'telegram', externalId: '987',
      kind: 'news', urgency: 'normal', body: 'hi',
    });
    expect(res.delivered).toBe(false);
    expect(res.error).toContain('blocked');
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd /c/nibbin-reach-me && npx vitest run packages/channels/test/telegram.test.ts`
Expected: FAIL — `telegramAdapter` not exported.

- [ ] **Step 3: Implement**

Create `packages/channels/src/adapters/telegram.ts`:
```ts
import type { ChannelAction, ChannelPort, DeliveryResult, OutboundChannelMessage } from '../types.js';

export interface TelegramConfig {
  botToken: string;
  fetchImpl?: typeof fetch;
}

function button(a: ChannelAction, requestId?: string) {
  if (a.kind === 'open' && a.deepLink) return { text: a.label, url: a.deepLink };
  // callback buttons carry "<requestId>:<kind>" so the inbound webhook routes
  // the press through the existing approval gate (Plan 05). Never a secret.
  return { text: a.label, callback_data: `${requestId ?? ''}:${a.kind}` };
}

export function telegramAdapter(cfg: TelegramConfig): ChannelPort {
  const doFetch = cfg.fetchImpl ?? fetch;
  return {
    channel: 'telegram',
    async deliver(msg: OutboundChannelMessage): Promise<DeliveryResult> {
      const body: Record<string, unknown> = { chat_id: msg.externalId, text: msg.body };
      if (msg.actions?.length) {
        body.reply_markup = { inline_keyboard: [msg.actions.map((a) => button(a, msg.requestId))] };
      }
      try {
        const res = await doFetch(`https://api.telegram.org/bot${cfg.botToken}/sendMessage`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(body),
        });
        const data = (await res.json()) as { ok: boolean; result?: { message_id: number }; description?: string };
        if (!res.ok || !data.ok) return { delivered: false, error: data.description ?? `telegram ${res.status}` };
        return { delivered: true, providerMessageId: String(data.result?.message_id ?? ''), costMicroUsd: 0 };
      } catch (e) {
        return { delivered: false, error: e instanceof Error ? e.message : 'telegram network error' };
      }
    },
  };
}
```
Uncomment the `telegram` export in `src/index.ts`.

- [ ] **Step 4: Run to verify it passes**

Run: `cd /c/nibbin-reach-me && npx vitest run packages/channels/test/telegram.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/channels/src/adapters/telegram.ts packages/channels/src/index.ts packages/channels/test/telegram.test.ts
git commit -m "feat(channels): Telegram adapter (inline-keyboard approvals, free)"
```

---

### Task 4: SMS (Twilio) adapter — complete but inert

**Files:**
- Create: `packages/channels/src/adapters/sms.ts`
- Test: `packages/channels/test/sms.test.ts`

**Interfaces:**
- Produces: `smsAdapter(cfg: SmsConfig): ChannelPort` where `interface SmsConfig { accountSid: string; authToken: string; fromNumber: string; perMessageMicroUsd: number; fetchImpl?: typeof fetch }`. Renders `actions` as appended reply-keyword lines (no buttons on SMS); posts form-encoded to the Twilio Messages API; returns `{ delivered, providerMessageId, costMicroUsd: perMessageMicroUsd }`.

- [ ] **Step 1: Write the failing test**

Create `packages/channels/test/sms.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import { smsAdapter } from '@nibbin/channels';

function fakeFetch(cap: { url?: string; auth?: string; form?: URLSearchParams }, ok = true) {
  return (async (url: string, init?: any) => {
    cap.url = url;
    cap.auth = init.headers.authorization;
    cap.form = new URLSearchParams(init.body);
    return { ok, status: ok ? 201 : 400, async json() { return ok ? { sid: 'SM123' } : { message: 'unverified number' }; } } as any;
  }) as unknown as typeof fetch;
}

describe('smsAdapter', () => {
  it('posts form-encoded to Twilio with basic auth and reports per-message COGS', async () => {
    const cap: { url?: string; auth?: string; form?: URLSearchParams } = {};
    const port = smsAdapter({
      accountSid: 'AC1', authToken: 'tok', fromNumber: '+15550000000',
      perMessageMicroUsd: 7900, fetchImpl: fakeFetch(cap),
    });
    const res = await port.deliver({
      accountId: 'acc', channel: 'sms', externalId: '+15551234567',
      kind: 'escalation', urgency: 'high', body: 'Approve the draft?',
      actions: [{ id: 'a', label: 'Approve', kind: 'approve' }, { id: 'd', label: 'Deny', kind: 'deny' }],
      requestId: 'r1',
    });
    expect(res.delivered).toBe(true);
    expect(res.providerMessageId).toBe('SM123');
    expect(res.costMicroUsd).toBe(7900);
    expect(cap.url).toContain('/Accounts/AC1/Messages.json');
    expect(cap.auth).toMatch(/^Basic /);
    expect(cap.form?.get('To')).toBe('+15551234567');
    expect(cap.form?.get('From')).toBe('+15550000000');
    expect(cap.form?.get('Body')).toContain('Reply APPROVE or DENY'); // reply-keyword affordance
  });

  it('returns delivered=false on a provider error', async () => {
    const cap = {};
    const port = smsAdapter({ accountSid: 'AC1', authToken: 'tok', fromNumber: '+1', perMessageMicroUsd: 7900, fetchImpl: fakeFetch(cap, false) });
    const res = await port.deliver({ accountId: 'acc', channel: 'sms', externalId: '+1', kind: 'news', urgency: 'normal', body: 'hi' });
    expect(res.delivered).toBe(false);
    expect(res.error).toContain('unverified');
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd /c/nibbin-reach-me && npx vitest run packages/channels/test/sms.test.ts`
Expected: FAIL — `smsAdapter` not exported.

- [ ] **Step 3: Implement**

Create `packages/channels/src/adapters/sms.ts`:
```ts
import type { ChannelPort, DeliveryResult, OutboundChannelMessage } from '../types.js';

export interface SmsConfig {
  accountSid: string;
  authToken: string;
  fromNumber: string;
  perMessageMicroUsd: number;   // delivery COGS estimate (tuned against the §11 SMS sub-cap)
  fetchImpl?: typeof fetch;
}

/** SMS has no buttons — approve/deny become reply keywords (the inbound webhook
 *  maps the keyword back through the approval gate, Plan 05). */
function renderBody(msg: OutboundChannelMessage): string {
  const hasApprove = msg.actions?.some((a) => a.kind === 'approve');
  const hasDeny = msg.actions?.some((a) => a.kind === 'deny');
  const lines = [msg.body];
  if (hasApprove && hasDeny) lines.push('Reply APPROVE or DENY.');
  if (msg.deepLink) lines.push(msg.deepLink);
  return lines.join('\n');
}

export function smsAdapter(cfg: SmsConfig): ChannelPort {
  const doFetch = cfg.fetchImpl ?? fetch;
  const auth = 'Basic ' + Buffer.from(`${cfg.accountSid}:${cfg.authToken}`).toString('base64');
  return {
    channel: 'sms',
    async deliver(msg: OutboundChannelMessage): Promise<DeliveryResult> {
      const form = new URLSearchParams({ To: msg.externalId, From: cfg.fromNumber, Body: renderBody(msg) });
      try {
        const res = await doFetch(`https://api.twilio.com/2010-04-01/Accounts/${cfg.accountSid}/Messages.json`, {
          method: 'POST',
          headers: { authorization: auth, 'content-type': 'application/x-www-form-urlencoded' },
          body: form.toString(),
        });
        const data = (await res.json()) as { sid?: string; message?: string };
        if (!res.ok || !data.sid) return { delivered: false, error: data.message ?? `twilio ${res.status}` };
        return { delivered: true, providerMessageId: data.sid, costMicroUsd: cfg.perMessageMicroUsd };
      } catch (e) {
        return { delivered: false, error: e instanceof Error ? e.message : 'twilio network error' };
      }
    },
  };
}
```
Uncomment the `sms` export in `src/index.ts`.

- [ ] **Step 4: Run to verify it passes** — `npx vitest run packages/channels/test/sms.test.ts` → PASS.

- [ ] **Step 5: Commit**
```bash
git add packages/channels/src/adapters/sms.ts packages/channels/src/index.ts packages/channels/test/sms.test.ts
git commit -m "feat(channels): SMS (Twilio) adapter — complete, inert until 10DLC clears"
```

---

### Task 5: WhatsApp Business adapter — complete but inert

**Files:**
- Create: `packages/channels/src/adapters/whatsapp.ts`
- Test: `packages/channels/test/whatsapp.test.ts`

**Interfaces:**
- Produces: `whatsappAdapter(cfg: WhatsAppConfig): ChannelPort` where `interface WhatsAppConfig { phoneNumberId: string; accessToken: string; perMessageMicroUsd: number; fetchImpl?: typeof fetch }`. Sends an interactive button message (≤3 buttons) via the Graph API; returns `{ delivered, providerMessageId, costMicroUsd }`.

- [ ] **Step 1: Write the failing test**

Create `packages/channels/test/whatsapp.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import { whatsappAdapter } from '@nibbin/channels';

function fakeFetch(cap: { url?: string; auth?: string; body?: any }, ok = true) {
  return (async (url: string, init?: any) => {
    cap.url = url; cap.auth = init.headers.authorization; cap.body = JSON.parse(init.body);
    return { ok, status: ok ? 200 : 400, async json() { return ok ? { messages: [{ id: 'wamid.1' }] } : { error: { message: 'template not approved' } }; } } as any;
  }) as unknown as typeof fetch;
}

describe('whatsappAdapter', () => {
  it('sends an interactive button message via the Graph API', async () => {
    const cap: { url?: string; auth?: string; body?: any } = {};
    const port = whatsappAdapter({ phoneNumberId: 'PN1', accessToken: 'tok', perMessageMicroUsd: 5000, fetchImpl: fakeFetch(cap) });
    const res = await port.deliver({
      accountId: 'acc', channel: 'whatsapp', externalId: '15551234567',
      kind: 'escalation', urgency: 'high', body: 'Approve the draft?',
      actions: [{ id: 'a', label: 'Approve', kind: 'approve' }, { id: 'd', label: 'Deny', kind: 'deny' }],
      requestId: 'r1',
    });
    expect(res.delivered).toBe(true);
    expect(res.providerMessageId).toBe('wamid.1');
    expect(res.costMicroUsd).toBe(5000);
    expect(cap.url).toContain('/PN1/messages');
    expect(cap.auth).toBe('Bearer tok');
    expect(cap.body.to).toBe('15551234567');
    expect(cap.body.interactive.action.buttons[0].reply.id).toBe('r1:approve');
  });

  it('returns delivered=false on a provider error', async () => {
    const cap = {};
    const port = whatsappAdapter({ phoneNumberId: 'PN1', accessToken: 'tok', perMessageMicroUsd: 5000, fetchImpl: fakeFetch(cap, false) });
    const res = await port.deliver({ accountId: 'acc', channel: 'whatsapp', externalId: '1', kind: 'news', urgency: 'normal', body: 'hi' });
    expect(res.delivered).toBe(false);
    expect(res.error).toContain('template not approved');
  });
});
```

- [ ] **Step 2: Run to verify it fails** — `npx vitest run packages/channels/test/whatsapp.test.ts` → FAIL.

- [ ] **Step 3: Implement**

Create `packages/channels/src/adapters/whatsapp.ts`:
```ts
import type { ChannelPort, DeliveryResult, OutboundChannelMessage } from '../types.js';

export interface WhatsAppConfig {
  phoneNumberId: string;
  accessToken: string;
  perMessageMicroUsd: number;
  fetchImpl?: typeof fetch;
}

export function whatsappAdapter(cfg: WhatsAppConfig): ChannelPort {
  const doFetch = cfg.fetchImpl ?? fetch;
  return {
    channel: 'whatsapp',
    async deliver(msg: OutboundChannelMessage): Promise<DeliveryResult> {
      const buttons = (msg.actions ?? [])
        .filter((a) => a.kind === 'approve' || a.kind === 'deny')
        .slice(0, 3)
        .map((a) => ({ type: 'reply', reply: { id: `${msg.requestId ?? ''}:${a.kind}`, title: a.label } }));
      const payload = buttons.length
        ? { messaging_product: 'whatsapp', to: msg.externalId, type: 'interactive',
            interactive: { type: 'button', body: { text: msg.body }, action: { buttons } } }
        : { messaging_product: 'whatsapp', to: msg.externalId, type: 'text', text: { body: msg.body } };
      try {
        const res = await doFetch(`https://graph.facebook.com/v21.0/${cfg.phoneNumberId}/messages`, {
          method: 'POST',
          headers: { authorization: `Bearer ${cfg.accessToken}`, 'content-type': 'application/json' },
          body: JSON.stringify(payload),
        });
        const data = (await res.json()) as { messages?: { id: string }[]; error?: { message: string } };
        if (!res.ok || !data.messages?.[0]) return { delivered: false, error: data.error?.message ?? `whatsapp ${res.status}` };
        return { delivered: true, providerMessageId: data.messages[0].id, costMicroUsd: cfg.perMessageMicroUsd };
      } catch (e) {
        return { delivered: false, error: e instanceof Error ? e.message : 'whatsapp network error' };
      }
    },
  };
}
```
Uncomment the `whatsapp` export in `src/index.ts`.

- [ ] **Step 4: Run to verify it passes** — PASS.

- [ ] **Step 5: Commit**
```bash
git add packages/channels/src/adapters/whatsapp.ts packages/channels/src/index.ts packages/channels/test/whatsapp.test.ts
git commit -m "feat(channels): WhatsApp Business adapter — complete, inert until Meta verification"
```

---

### Task 6: The dispatcher (priority order + fallback chain + log)

**Files:**
- Create: `packages/channels/src/dispatch.ts`
- Test: `packages/channels/test/dispatch.test.ts`

**Interfaces:**
- Consumes: `ChannelPort`, `OutboundChannelMessage`, `floorAdapter`.
- Produces:
  - `interface ChannelStore { verifiedChannels(accountId): Promise<{ channel: ChannelKind; externalId: string }[]>; prefs(accountId): Promise<{ channel: ChannelKind; enabled: boolean; priority: number; urgencyThreshold: Urgency | 'all' }[]>; quietHours(accountId): Promise<{ start: number; end: number } | null>; logDelivery(row): Promise<void>; }`
  - `interface DispatchContext { ports: Map<ChannelKind, ChannelPort>; floor: ChannelPort; store: ChannelStore; now(): Date; localHour(date, accountId?): number }`
  - `deliverWithFallback(msg, ctx): Promise<DispatchResult>` where `interface DispatchResult { deliveredVia: ChannelKind | 'floor'; attempts: { channel: ChannelKind; ok: boolean }[] }`.
- Behavior: order verified+enabled channels by `priority`; drop channels whose `urgencyThreshold` excludes `msg.urgency`; in quiet hours, only `urgent` proceeds (non-urgent goes straight to the floor per §6/§8 digest); try each port in order, logging each attempt to `channel_messages`; first `delivered` wins; if all fail (or none eligible), the floor delivers and is logged with `status='fallback'`.

- [ ] **Step 1: Write the failing test**

Create `packages/channels/test/dispatch.test.ts`:
```ts
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
});
```

- [ ] **Step 2: Run to verify it fails** — FAIL (`deliverWithFallback` not exported).

- [ ] **Step 3: Implement**

Create `packages/channels/src/dispatch.ts`:
```ts
import type { ChannelKind, ChannelPort, OutboundChannelMessage, Urgency } from './types.js';

const URGENCY_RANK: Record<Urgency, number> = { normal: 0, high: 1, urgent: 2 };

export interface ChannelStore {
  verifiedChannels(accountId: string): Promise<{ channel: ChannelKind; externalId: string }[]>;
  prefs(accountId: string): Promise<{ channel: ChannelKind; enabled: boolean; priority: number; urgencyThreshold: Urgency | 'all' }[]>;
  quietHours(accountId: string): Promise<{ start: number; end: number } | null>;
  logDelivery(row: {
    accountId: string; channel: ChannelKind | 'push'; direction: 'outbound'; kind: OutboundChannelMessage['kind'];
    status: 'delivered' | 'failed' | 'fallback'; urgency: Urgency; providerMessageId?: string; costMicroUsd: number; requestId?: string;
  }): Promise<void>;
}

export interface DispatchContext {
  ports: Map<ChannelKind, ChannelPort>;
  floor: ChannelPort;
  store: ChannelStore;
  now(): Date;
  /** Resolve the account's local hour (0..23) for the given instant. */
  localHour(date: Date, accountId?: string): number;
}

export interface DispatchResult {
  deliveredVia: ChannelKind | 'floor';
  attempts: { channel: ChannelKind; ok: boolean }[];
}

function inQuietHours(hour: number, q: { start: number; end: number }): boolean {
  return q.start <= q.end ? hour >= q.start && hour < q.end : hour >= q.start || hour < q.end;
}

export async function deliverWithFallback(msg: OutboundChannelMessage, ctx: DispatchContext): Promise<DispatchResult> {
  const [verified, prefs, quiet] = await Promise.all([
    ctx.store.verifiedChannels(msg.accountId),
    ctx.store.prefs(msg.accountId),
    ctx.store.quietHours(msg.accountId),
  ]);
  const prefBy = new Map(prefs.map((p) => [p.channel, p]));
  const quietNow = quiet ? inQuietHours(ctx.localHour(ctx.now(), msg.accountId), quiet) : false;

  // eligible = verified ∧ enabled ∧ urgency≥threshold ∧ (not quiet OR urgent), ordered by priority asc
  const eligible = verified
    .map((v) => ({ v, p: prefBy.get(v.channel) }))
    .filter(({ p }) => p && p.enabled)
    .filter(({ p }) => p!.urgencyThreshold === 'all' || URGENCY_RANK[msg.urgency] >= URGENCY_RANK[p!.urgencyThreshold as Urgency])
    .filter(() => !quietNow || msg.urgency === 'urgent')
    .sort((a, b) => a.p!.priority - b.p!.priority);

  const attempts: { channel: ChannelKind; ok: boolean }[] = [];
  for (const { v } of eligible) {
    const port = ctx.ports.get(v.channel);
    if (!port) continue;
    const res = await port.deliver({ ...msg, channel: v.channel, externalId: v.externalId });
    attempts.push({ channel: v.channel, ok: res.delivered });
    await ctx.store.logDelivery({
      accountId: msg.accountId, channel: v.channel, direction: 'outbound', kind: msg.kind,
      status: res.delivered ? 'delivered' : 'failed', urgency: msg.urgency,
      providerMessageId: res.providerMessageId, costMicroUsd: res.costMicroUsd ?? 0, requestId: msg.requestId,
    });
    if (res.delivered) return { deliveredVia: v.channel, attempts };
  }

  // terminal floor — always succeeds (§10)
  await ctx.floor.deliver(msg);
  await ctx.store.logDelivery({
    accountId: msg.accountId, channel: 'push', direction: 'outbound', kind: msg.kind,
    status: 'fallback', urgency: msg.urgency, costMicroUsd: 0, requestId: msg.requestId,
  });
  return { deliveredVia: 'floor', attempts };
}
```
Uncomment the `dispatch` export in `src/index.ts`.

- [ ] **Step 4: Run to verify it passes** — `npx vitest run packages/channels/test/dispatch.test.ts` → PASS.

- [ ] **Step 5: Commit**
```bash
git add packages/channels/src/dispatch.ts packages/channels/src/index.ts packages/channels/test/dispatch.test.ts
git commit -m "feat(channels): dispatcher — priority order, urgency/quiet filters, fallback to floor"
```

---

### Task 7: Web wiring — build the live port set + Supabase ChannelStore

**Files:**
- Create: `apps/web/lib/channels/ports.ts`
- Test: `apps/web/lib/channels/ports.test.ts`

**Interfaces:**
- Consumes: the adapters + `ChannelStore` shape (Tasks 2–6); env (`TELEGRAM_BOT_TOKEN`, gated `CHANNELS_SMS_ENABLED`/`TWILIO_*`, `CHANNELS_WHATSAPP_ENABLED`/`WHATSAPP_*`).
- Produces: `buildPorts(env): { ports: Map<ChannelKind, ChannelPort>; floor: ChannelPort }` and `supabaseChannelStore(svc): ChannelStore` (reads `notification_channels` verified, `channel_prefs`, `notification_settings`; writes `channel_messages`).

- [ ] **Step 1: Write the failing test**

Create `apps/web/lib/channels/ports.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import { buildPorts } from './ports';

describe('buildPorts', () => {
  it('registers Telegram when the bot token is set; SMS/WhatsApp only when their flag is on', () => {
    const a = buildPorts({ TELEGRAM_BOT_TOKEN: 'BOT' });
    expect(a.ports.has('telegram')).toBe(true);
    expect(a.ports.has('sms')).toBe(false);
    expect(a.ports.has('whatsapp')).toBe(false);

    const b = buildPorts({
      TELEGRAM_BOT_TOKEN: 'BOT',
      CHANNELS_SMS_ENABLED: 'true', TWILIO_ACCOUNT_SID: 'AC', TWILIO_AUTH_TOKEN: 't', TWILIO_FROM_NUMBER: '+1',
    });
    expect(b.ports.has('sms')).toBe(true);
  });

  it('omits Telegram when no token is configured (no live port without config)', () => {
    const a = buildPorts({});
    expect(a.ports.has('telegram')).toBe(false);
  });
});
```

- [ ] **Step 2: Run to verify it fails** — FAIL.

- [ ] **Step 3: Implement**

Create `apps/web/lib/channels/ports.ts`:
```ts
import {
  floorAdapter, telegramAdapter, smsAdapter, whatsappAdapter,
  type ChannelKind, type ChannelPort, type ChannelStore, type NotificationsFloorStore,
} from '@nibbin/channels';
import type { SupabaseClient } from '@supabase/supabase-js';

type Env = Record<string, string | undefined>;

export function buildPorts(env: Env): { ports: Map<ChannelKind, ChannelPort>; floor: ChannelPort } {
  const ports = new Map<ChannelKind, ChannelPort>();
  if (env.TELEGRAM_BOT_TOKEN) ports.set('telegram', telegramAdapter({ botToken: env.TELEGRAM_BOT_TOKEN }));
  // ⚑ inert until Plan 06's offline registration flips the flag
  if (env.CHANNELS_SMS_ENABLED === 'true' && env.TWILIO_ACCOUNT_SID && env.TWILIO_AUTH_TOKEN && env.TWILIO_FROM_NUMBER) {
    ports.set('sms', smsAdapter({
      accountSid: env.TWILIO_ACCOUNT_SID, authToken: env.TWILIO_AUTH_TOKEN, fromNumber: env.TWILIO_FROM_NUMBER,
      perMessageMicroUsd: Number(env.TWILIO_PER_MESSAGE_MICROUSD ?? '7900'),
    }));
  }
  if (env.CHANNELS_WHATSAPP_ENABLED === 'true' && env.WHATSAPP_PHONE_NUMBER_ID && env.WHATSAPP_ACCESS_TOKEN) {
    ports.set('whatsapp', whatsappAdapter({
      phoneNumberId: env.WHATSAPP_PHONE_NUMBER_ID, accessToken: env.WHATSAPP_ACCESS_TOKEN,
      perMessageMicroUsd: Number(env.WHATSAPP_PER_MESSAGE_MICROUSD ?? '5000'),
    }));
  }
  const floorStore: NotificationsFloorStore = {
    async insertNotification() { throw new Error('floor store must be bound per request via supabaseChannelStore'); },
  };
  return { ports, floor: floorAdapter(floorStore) };
}

export function supabaseChannelStore(svc: SupabaseClient): ChannelStore {
  return {
    async verifiedChannels(accountId) {
      const { data } = await svc.from('notification_channels')
        .select('channel, external_id').eq('account_id', accountId).eq('status', 'verified');
      return (data ?? []).map((r) => ({ channel: r.channel, externalId: r.external_id }));
    },
    async prefs(accountId) {
      const { data } = await svc.from('channel_prefs')
        .select('channel, enabled, priority, urgency_threshold').eq('account_id', accountId);
      return (data ?? []).map((r) => ({ channel: r.channel, enabled: r.enabled, priority: r.priority, urgencyThreshold: r.urgency_threshold }));
    },
    async quietHours(accountId) {
      const { data } = await svc.from('notification_settings')
        .select('quiet_start, quiet_end').eq('account_id', accountId).maybeSingle();
      return data ? { start: data.quiet_start, end: data.quiet_end } : null;
    },
    async logDelivery(row) {
      await svc.from('channel_messages').insert({
        account_id: row.accountId, channel: row.channel, direction: row.direction, kind: row.kind,
        status: row.status, urgency: row.urgency, provider_message_id: row.providerMessageId ?? null,
        cost_microusd: row.costMicroUsd, request_id: row.requestId ?? null,
      });
    },
  };
}
```
(The floor store is bound per-request from the same `svc` in the dispatch call site — Plan 05 wires the actual call site; here `supabaseChannelStore` + `buildPorts` are the reusable pieces. Bind the floor to a real `insertNotification` over `svc` at the call site.)

- [ ] **Step 4: Run to verify it passes** — PASS.

- [ ] **Step 5: Typecheck** — `cd /c/nibbin-reach-me && npx tsc --noEmit -p apps/web` → no errors.

- [ ] **Step 6: Commit**
```bash
git add apps/web/lib/channels/ports.ts apps/web/lib/channels/ports.test.ts
git commit -m "feat(web): channel port set (telegram live; sms/whatsapp flag-gated) + Supabase ChannelStore"
```

---

## Self-review notes
- **N1/N2 (multi-channel + adapter abstraction + fallback):** one `ChannelPort.deliver()` per channel; adding a channel is a `set()` in `buildPorts`, not a rewrite. Fallback chain + in-app floor in `deliverWithFallback`.
- **N14 (resilience):** every channel failure walks to the next; the floor always succeeds; each attempt logged to `channel_messages`. Idempotency anchor for the leaf is the `requestId` (Plan 03 adds the `'reach'` notifications-kind migration; until then the floor emits `'beat'`-kind).
- **N17 (delivery COGS):** SMS/WhatsApp adapters return `costMicroUsd`; the dispatcher logs it on `channel_messages`. (Per-turn LLM COGS is Plan 05's `model_calls` ALTER.)
- **All-adapters scope:** SMS + WhatsApp code is complete and fully unit-tested against injected transports, but `buildPorts` leaves them out of the live set unless `CHANNELS_*_ENABLED` is true — so no real provider call can occur before Plan 06's offline registration.
- **Secret boundary (N-P2):** adapters render only body/deepLink/actions; tokens are transport config. `open` actions deep-link to the app.
- **Deferred:** the actual escalation/beat *producers* and the dispatch *call site* are Plan 05; inbound (button presses / reply keywords routing back through the gate) is Plan 03 + Plan 05.
