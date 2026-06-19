# Reach-Me Channels 06 — Offline Enablement Track Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Start the multi-day, real-world lead-time clock for SMS and WhatsApp in parallel with the in-repo build: a precise offline-action checklist (the ⚑ steps only the user / legal / an account owner can do) **plus** the in-repo scaffolding that those steps slot into — consent + STOP/HELP/TCPA copy, the SMS STOP/HELP/opt-out handler, the subprocessor registry entries, and the provider-retention disclosure (D-N3) — so the channels can flip live the moment registration clears.

**Architecture:** Two halves. The **checklist** (`docs/tasks/reach-me-offline-enablement.md`) is the canonical tracker of every ⚑ action with owner + dependency. The **scaffolding** is real code/copy: a single source of truth for consent + keyword copy (`packages/channels/src/compliance/`), the SMS STOP/HELP/opt-out handler wired into the Plan 03 SMS route (TCPA), and subprocessor registry data (Twilio/Telegram/Meta) ready to publish. Nothing here sends to a real provider; it makes the offline steps unblock cleanly.

**Tech Stack:** Markdown checklist; `@nibbin/channels` compliance module + tests; the Plan 03 SMS route; the existing subprocessor surface (locate it — see Task 4).

## Global Constraints
- ⚑ marks an action that **cannot be done from the codebase** — it needs the user, legal/counsel, or an external account. These are documented, never faked.
- **No SMS before** 10DLC brand+campaign registration + opt-in consent record + STOP/HELP + TCPA quiet-hours; **no WhatsApp before** Meta Business verification + template pre-approval (D-N4). The `CHANNELS_*_ENABLED` flags (Plans 02/03) stay false until the matching checklist section is fully checked.
- **D-N3 disclosure:** the channel + provider-retention disclosure (Telegram/Meta/Twilio retain message history beyond Nibbin's reach) must be published before any user data flows to a provider, and folded into the #46 attorney review.
- **Subprocessors published before data flows** (T&C §6.3): Twilio/Telegram/Meta listed with regions, data categories, retention.
- Brand voice for all user-facing copy: sentence case, what happened → what's safe → what to do; locked vocabulary per `docs/AGREEMENTS.md`. Don't touch `reference/*.html` (if the published subprocessor page is a reference HTML, Task 4 produces the data + a flagged publish step, not an edit to that file).

## File Structure
- **Create** `docs/tasks/reach-me-offline-enablement.md` — the ⚑ checklist.
- **Create** `packages/channels/src/compliance/copy.ts` — consent / STOP / HELP / opt-out copy + keyword matchers.
- **Create** `packages/channels/src/compliance/subprocessors.ts` — the Twilio/Telegram/Meta registry entries (data).
- **Modify** `apps/web/app/api/channels/sms/route.ts` — STOP/HELP/opt-out handling before ingest.
- Tests under `packages/channels/test/compliance-*.test.ts`.

---

### Task 1: The offline-action checklist

**Files:**
- Create: `docs/tasks/reach-me-offline-enablement.md`

- [ ] **Step 1: Write the checklist** (the canonical tracker — owner + blocker for each ⚑)

```markdown
# Reach-Me — Offline Enablement Checklist (SMS + WhatsApp)

Source: spec §16 + D-N4. ⚑ = needs the user / counsel / an external account; cannot be done from the codebase.
Gate: the matching `CHANNELS_*_ENABLED` flag stays FALSE until its whole section is checked.

## SMS / Twilio (the long pole — start FIRST; carrier registration is multi-day)
- [ ] ⚑ Create/confirm the Twilio account; record the Account SID.
- [ ] ⚑ 10DLC **Brand registration** (legal entity, EIN) — submit; wait for vetting.
- [ ] ⚑ 10DLC **Campaign registration** (use-case: account notifications + 2-way) — submit; wait for carrier approval (multi-day).
- [ ] ⚑ Provision a 10DLC phone number; attach to the approved campaign.
- [ ] ⚑ Counsel: review TCPA consent language + quiet-hours policy + record-keeping.
- [ ] In-repo: opt-in consent copy + STOP/HELP handler shipped (Tasks 2–3 below).
- [ ] ⚑ Configure the Twilio messaging webhook → `https://nibbin.com/api/channels/sms` with request-signature validation on.
- [ ] Set env: `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, `TWILIO_FROM_NUMBER`, `SMS_WEBHOOK_URL`, `TWILIO_PER_MESSAGE_MICROUSD`.
- [ ] ⚑ COGS modeling: fold per-message SMS cost into the unit-economics model; tune the §11 SMS sub-cap (`smsSpendCapMicroUsd`).
- [ ] Flip `CHANNELS_SMS_ENABLED=true` (dev → staging → prod) once all above are checked.

## WhatsApp Business
- [ ] ⚑ Meta Business verification.
- [ ] ⚑ WhatsApp Business API access; create the phone number; record `WHATSAPP_PHONE_NUMBER_ID`.
- [ ] ⚑ Submit + get approval for the proactive-escalation **message template(s)**.
- [ ] ⚑ Configure the Meta webhook → `https://nibbin.com/api/channels/whatsapp` with the verify token + app secret.
- [ ] Set env: `WHATSAPP_PHONE_NUMBER_ID`, `WHATSAPP_ACCESS_TOKEN`, `WHATSAPP_APP_SECRET`, `WHATSAPP_VERIFY_TOKEN`, `WHATSAPP_PER_MESSAGE_MICROUSD`.
- [ ] Flip `CHANNELS_WHATSAPP_ENABLED=true` once all above are checked.

## Telegram (mostly in-repo — included for completeness)
- [ ] ⚑ Create the bot via BotFather; record `TELEGRAM_BOT_TOKEN` + bot username (`NEXT_PUBLIC_TELEGRAM_BOT`).
- [ ] ⚑ Set the Telegram webhook → `https://nibbin.com/api/channels/telegram` with a secret token (`TELEGRAM_WEBHOOK_SECRET`).
- [ ] Set env (above) in dev/staging/prod.

## Cross-cutting (gates ALL channels)
- [ ] ⚑ Subprocessor registry: publish Twilio + Telegram + Meta entries (regions, data categories, retention) — data prepared in Task 4; ⚑ = publish + counsel sign-off.
- [ ] ⚑ Privacy/legal: provider-retention disclosure (D-N3) folded into the #46 attorney review; SMS consent record-keeping confirmed.
```

- [ ] **Step 2: Commit**
```bash
git add docs/tasks/reach-me-offline-enablement.md
git commit -m "docs(reach-me): offline enablement checklist (10DLC + Meta + subprocessors)"
```

---

### Task 2: Consent + STOP/HELP copy (single source of truth)

**Files:**
- Create: `packages/channels/src/compliance/copy.ts`
- Modify: `packages/channels/src/index.ts`
- Test: `packages/channels/test/compliance-copy.test.ts`

**Interfaces:**
- Produces: `SMS_CONSENT_COPY`, `SMS_HELP_REPLY`, `SMS_STOP_REPLY` (strings); `isStopKeyword(text)`, `isHelpKeyword(text)`, `isStartKeyword(text)` (the CTIA standard keywords).

- [ ] **Step 1: Write the failing test**
```ts
import { describe, it, expect } from 'vitest';
import { isStopKeyword, isHelpKeyword, isStartKeyword, SMS_CONSENT_COPY, SMS_HELP_REPLY, SMS_STOP_REPLY } from '@nibbin/channels';

describe('SMS compliance keywords', () => {
  it('recognizes the standard STOP set (case/space-insensitive)', () => {
    for (const k of ['STOP', 'stop', ' Stop ', 'UNSUBSCRIBE', 'CANCEL', 'END', 'QUIT']) expect(isStopKeyword(k)).toBe(true);
    expect(isStopKeyword('stop the invoice')).toBe(false); // only the bare keyword opts out
  });
  it('recognizes HELP and START', () => {
    expect(isHelpKeyword('HELP')).toBe(true);
    expect(isHelpKeyword('info')).toBe(true);
    expect(isStartKeyword('START')).toBe(true);
    expect(isStartKeyword('unstop')).toBe(true);
  });
  it('consent + help + stop copy are non-empty and on-brand (sentence case, actionable)', () => {
    expect(SMS_CONSENT_COPY.length).toBeGreaterThan(20);
    expect(SMS_HELP_REPLY).toMatch(/STOP/);
    expect(SMS_STOP_REPLY).toMatch(/opted out|no more|won.t/i);
  });
});
```

- [ ] **Step 2: Run → FAIL.**

- [ ] **Step 3: Implement** `packages/channels/src/compliance/copy.ts`:
```ts
// CTIA standard keyword sets (TCPA / carrier requirements). Only the bare
// keyword opts in/out — "stop the invoice" is a normal message, not an opt-out.
const STOP = new Set(['STOP', 'STOPALL', 'UNSUBSCRIBE', 'CANCEL', 'END', 'QUIT']);
const HELP = new Set(['HELP', 'INFO']);
const START = new Set(['START', 'YES', 'UNSTOP']);

const norm = (t: string) => t.trim().toUpperCase();

export function isStopKeyword(text: string): boolean { return STOP.has(norm(text)); }
export function isHelpKeyword(text: string): boolean { return HELP.has(norm(text)); }
export function isStartKeyword(text: string): boolean { return START.has(norm(text)); }

// Shown at opt-in (the connect flow records this consent — see the checklist).
export const SMS_CONSENT_COPY =
  'Your grove can text you about things that need you — like approving a draft. Message frequency varies. ' +
  'Message and data rates may apply. Reply HELP for help, STOP to opt out anytime.';

export const SMS_HELP_REPLY =
  'Nibbin: your grove texts you when something needs you. Reply STOP to opt out. More in the app at nibbin.com/app.';

export const SMS_STOP_REPLY =
  'You’ve opted out — your grove won’t text this number again. You can still reach it in the app, and reply START here to turn texts back on.';
```
Export all six from `index.ts`.

- [ ] **Step 4: Run → PASS. Commit.**
```bash
git add packages/channels/src/compliance/copy.ts packages/channels/src/index.ts packages/channels/test/compliance-copy.test.ts
git commit -m "feat(channels): SMS consent + STOP/HELP/START copy and keyword matchers (TCPA)"
```

---

### Task 3: SMS STOP/HELP/opt-out handler in the route

**Files:**
- Modify: `apps/web/app/api/channels/sms/route.ts`
- Create: `apps/web/lib/channels/sms-compliance.ts` (opt-out persistence over service role)
- Test: `apps/web/app/api/channels/sms/route.test.ts`

**Interfaces:**
- Consumes: `isStopKeyword`/`isHelpKeyword`/`isStartKeyword`, `SMS_HELP_REPLY`/`SMS_STOP_REPLY` (Task 2); the Plan 01 `revoke_channel`/`request_channel_link` shape (opt-out = revoke the sms channel for that external_id; opt-in keyword is handled at connect-time, but START re-enables).
- Produces: in the SMS route, **before** `ingestInbound`: if STOP → revoke the sender's sms channel + reply `SMS_STOP_REPLY` (TwiML); if HELP → reply `SMS_HELP_REPLY`; else fall through to ingest. `optOutSms(externalId)` / `optInSms(externalId)` over the service role.

- [ ] **Step 1: Write the failing test** (extend `route.test.ts` — mock ingest + the compliance fns): assert STOP returns TwiML containing the stop reply and calls `optOutSms`, never `ingestInbound`; HELP returns the help reply and does not ingest; a normal message ingests.

- [ ] **Step 2: Run → FAIL.**

- [ ] **Step 3: Implement** the branch in `route.ts` (after signature verification, before parse-to-ingest):
```ts
import { isStopKeyword, isHelpKeyword, SMS_HELP_REPLY, SMS_STOP_REPLY } from '@nibbin/channels';
import { optOutSms } from '../../../../lib/channels/sms-compliance';

// ...inside POST, after signature check and reading `params`:
const from = params.From ?? '';
const bodyText = params.Body ?? '';
const twiml = (msg: string) => new NextResponse(`<Response><Message>${msg}</Message></Response>`, { status: 200, headers: { 'content-type': 'text/xml' } });

if (isStopKeyword(bodyText)) {
  await optOutSms(from);
  return twiml(SMS_STOP_REPLY);
}
if (isHelpKeyword(bodyText)) {
  return twiml(SMS_HELP_REPLY);
}
// else: normal inbound -> ingest (existing path)
```
Create `apps/web/lib/channels/sms-compliance.ts`:
```ts
import { createServiceClient } from '../supabase/service'; // ADJUST to the real helper
export async function optOutSms(externalId: string): Promise<void> {
  const svc = createServiceClient();
  // revoke every live sms binding for this number (TCPA: stop reaching them)
  await svc.from('notification_channels')
    .update({ status: 'revoked', revoked_at: new Date().toISOString() })
    .eq('channel', 'sms').eq('external_id', externalId).neq('status', 'revoked');
}
```
> NOTE: a direct service-role update is acceptable here (the service role bypasses RLS); for audit parity, prefer adding a small `sms_opt_out(p_external_id text)` service-role RPC that also writes `audit_log` (`action='channel.sms_opt_out'`). Recommended: do the RPC. Add it to a tiny migration if you take that route.

- [ ] **Step 4: Run → PASS. Typecheck. Commit.**
```bash
git add apps/web/app/api/channels/sms/route.ts apps/web/lib/channels/sms-compliance.ts apps/web/app/api/channels/sms/route.test.ts
git commit -m "feat(web): SMS STOP/HELP/opt-out handling (TCPA) before ingest"
```

---

### Task 4: Subprocessor registry entries (data, ready to publish)

**Files:**
- Create: `packages/channels/src/compliance/subprocessors.ts`
- Modify: `packages/channels/src/index.ts`
- Test: `packages/channels/test/compliance-subprocessors.test.ts`

**Interfaces:**
- Produces: `CHANNEL_SUBPROCESSORS: SubprocessorEntry[]` with `{ name; purpose; regions; dataCategories; retention; url }` for Twilio, Telegram, Meta (WhatsApp) — the D-N3 retention note included. Plus the published-page wiring step.

- [ ] **Step 1: Write the failing test**
```ts
import { describe, it, expect } from 'vitest';
import { CHANNEL_SUBPROCESSORS } from '@nibbin/channels';

describe('channel subprocessors', () => {
  it('lists Twilio, Telegram and Meta with regions, data categories and retention', () => {
    const names = CHANNEL_SUBPROCESSORS.map((s) => s.name);
    expect(names).toEqual(expect.arrayContaining(['Twilio', 'Telegram', 'Meta Platforms']));
    for (const s of CHANNEL_SUBPROCESSORS) {
      expect(s.dataCategories.length).toBeGreaterThan(0);
      expect(s.retention).toMatch(/\w/);
      // D-N3: each notes provider retention is beyond Nibbin's reach
      expect(s.retention.toLowerCase()).toMatch(/provider|beyond|their/);
    }
  });
});
```

- [ ] **Step 2: Run → FAIL.**

- [ ] **Step 3: Implement** `packages/channels/src/compliance/subprocessors.ts`:
```ts
export interface SubprocessorEntry {
  name: string;
  purpose: string;
  regions: string;
  dataCategories: string[];
  retention: string;
  url: string;
}

// D-N3: providers retain message history beyond Nibbin's reach — say so plainly.
export const CHANNEL_SUBPROCESSORS: SubprocessorEntry[] = [
  {
    name: 'Twilio',
    purpose: 'SMS delivery and inbound message relay',
    regions: 'United States',
    dataCategories: ['phone number', 'message content', 'delivery metadata'],
    retention: 'Per Twilio’s policy; message history is retained by the provider beyond Nibbin’s control.',
    url: 'https://www.twilio.com/legal/privacy',
  },
  {
    name: 'Telegram',
    purpose: 'Telegram message delivery and inbound relay',
    regions: 'Global',
    dataCategories: ['Telegram chat id', 'message content'],
    retention: 'Per Telegram’s policy; message history is retained by the provider beyond Nibbin’s reach.',
    url: 'https://telegram.org/privacy',
  },
  {
    name: 'Meta Platforms',
    purpose: 'WhatsApp Business message delivery and inbound relay',
    regions: 'Global',
    dataCategories: ['phone number', 'message content', 'delivery metadata'],
    retention: 'Per Meta’s policy; message history is retained by the provider beyond Nibbin’s reach.',
    url: 'https://www.whatsapp.com/legal/business-data-transfer-addendum',
  },
];
```
Export from `index.ts`.

- [ ] **Step 4: Wire into the published page** — locate the published subprocessors surface (search the repo for `subprocessor`; memory notes a subprocessor draft shipped in #120). If it's a React route, render `CHANNEL_SUBPROCESSORS` rows into it. **If it is only `reference/*.html`,** do NOT edit that file (constraint) — instead add a checklist item flagging the publish step for the content owner and leave the data module as the source of truth. Document which it was.

- [ ] **Step 5: Run → PASS. Commit.**
```bash
git add packages/channels/src/compliance/subprocessors.ts packages/channels/src/index.ts packages/channels/test/compliance-subprocessors.test.ts
git commit -m "feat(channels): channel subprocessor registry entries (Twilio/Telegram/Meta, D-N3 retention)"
```

---

## Self-review notes
- **Scope = the user's "checklist + scaffolding" choice:** the ⚑ checklist tracks every offline action with owner; the scaffolding (consent/STOP/HELP copy, the TCPA handler, subprocessor data) is real, tested code the offline steps slot into.
- **D-N4 gate honored:** flags stay false until each section is fully checked; no real provider send is possible before registration.
- **D-N3 disclosure:** subprocessor entries state plainly that providers retain message history beyond Nibbin's reach; flagged into the #46 attorney review.
- **TCPA:** STOP/HELP/START handled before ingest; opt-out revokes the binding (prefer the audited RPC variant).
- **Honest boundaries:** anything needing counsel/an external account is ⚑ and left to the owner; the plan never fakes a registration or publishes legal copy without sign-off.
- **Deferred:** the published subprocessor page edit if it lives in `reference/*.html` (flagged to the content owner, per the no-touch constraint); WhatsApp template content (⚑ Meta approval).
```
