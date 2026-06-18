# Reach-Me Channels 04 — Multi-Channel Preferences UI Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Extend the existing email-only Notifications card in Data & Privacy into the full multi-channel preferences surface (T13): connect/disconnect each channel (the link-from-app nonce flow), per-channel enable + priority + urgency threshold, and account-level quiet hours + digest mode — all honest about which channels are live vs coming.

**Architecture:** Pure form/metadata helpers (unit-tested) + four server actions that call the Plan 01 RPCs (`request_channel_link`, `revoke_channel`, `set_channel_prefs`, `set_notification_settings`), rendered with the existing `components/ui` kit. The page reads `notification_channels` / `channel_prefs` / `notification_settings` (all RLS member-read). The account-level quiet-hours action writes **both** `notification_settings` and the existing `drip_arcs` (via `set_notification_prefs`) so the live companion-email arc keeps honoring quiet hours until the drip worker migrates to `notification_settings` (flagged below).

**Tech Stack:** Next App Router server components + server actions, `components/ui` (`Card`/`Button`/`Badge`/`Select`/`InlineFeedback`), Vitest (node) for the helpers.

## Global Constraints
- **Honest copy (no fake controls):** only show connect/enable controls for channels that can actually be reached. Telegram is live; SMS/WhatsApp render as "Coming soon" (read the same `CHANNELS_*_ENABLED` flags as Plans 02/03) — visible so users know it's coming, but the connect button is disabled with a one-line reason. Brand voice: sentence case, what happened → what's safe → what to do.
- Reuse the existing form CSS (`components/settings/settings.module.css` `.form/.field/.label/.fieldHint/.actions`) and the `Select`/`HOUR_OPTIONS` already used by the email card. Zero new UI primitives.
- Channel display order and labels are centralized in one `CHANNEL_META` map so adding a channel is one edit.
- Don't break the shipped email card: keep `email_enabled` on `drip_arcs` via `set_notification_prefs`; layer the new controls around it.

## File Structure
- **Create** `apps/web/lib/privacy/channels.ts` — `CHANNEL_META`, `parseChannelPrefsForm`, `parseSettingsForm`, `channelStatusLabel`.
- **Create** `apps/web/lib/privacy/channels.test.ts`.
- **Modify** `apps/web/app/app/settings/privacy/actions.ts` — add `connectChannel`, `disconnectChannel`, `saveChannelPrefs`, `saveNotificationSettings`.
- **Modify** `apps/web/app/app/settings/privacy/page.tsx` — read channels/prefs/settings; render the Channels card + Quiet hours & digest card.

---

### Task 1: Pure helpers + tests

**Files:**
- Create: `apps/web/lib/privacy/channels.ts`, `apps/web/lib/privacy/channels.test.ts`

**Interfaces:**
- Produces:
  - `CHANNEL_META: Record<ChannelKind, { label: string; live: boolean; help: string }>` (live read from a passed flag set so it's testable).
  - `channelMeta(flags): Record<ChannelKind, {label;live;help}>`
  - `parseChannelPrefsForm(form): { channel; enabled; priority; urgencyThreshold }`
  - `parseSettingsForm(form): { quietStart; quietEnd; digestMode }`
  - `URGENCY_OPTIONS`, `DIGEST_OPTIONS` (`SelectOption[]`).

- [ ] **Step 1: Write the failing test**

Create `apps/web/lib/privacy/channels.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import { channelMeta, parseChannelPrefsForm, parseSettingsForm, URGENCY_OPTIONS, DIGEST_OPTIONS } from './channels';

function fd(o: Record<string, string>): FormData {
  const f = new FormData();
  for (const [k, v] of Object.entries(o)) f.append(k, v);
  return f;
}

describe('channelMeta', () => {
  it('marks telegram live when its token flag is set; sms/whatsapp gated', () => {
    const m = channelMeta({ telegram: true, sms: false, whatsapp: false });
    expect(m.telegram.live).toBe(true);
    expect(m.sms.live).toBe(false);
    expect(m.sms.help).toMatch(/coming/i);
  });
});

describe('parseChannelPrefsForm', () => {
  it('reads channel + clamps priority + validates urgency', () => {
    expect(parseChannelPrefsForm(fd({ channel: 'sms', enabled: 'on', priority: '5', urgency_threshold: 'high' })))
      .toEqual({ channel: 'sms', enabled: true, priority: 5, urgencyThreshold: 'high' });
    expect(parseChannelPrefsForm(fd({ channel: 'telegram', priority: '99999', urgency_threshold: 'bogus' })))
      .toEqual({ channel: 'telegram', enabled: false, priority: 1000, urgencyThreshold: 'all' });
  });
});

describe('parseSettingsForm', () => {
  it('clamps quiet hours and validates digest', () => {
    expect(parseSettingsForm(fd({ quiet_start: '25', quiet_end: '-1', digest_mode: 'daily' })))
      .toEqual({ quietStart: 23, quietEnd: 0, digestMode: 'daily' });
    expect(parseSettingsForm(fd({ quiet_start: '21', quiet_end: '9', digest_mode: 'nope' })).digestMode).toBe('smart');
  });
});

describe('option lists', () => {
  it('expose select options', () => {
    expect(URGENCY_OPTIONS.map((o) => o.value)).toEqual(['all', 'normal', 'high', 'urgent']);
    expect(DIGEST_OPTIONS.map((o) => o.value)).toEqual(['off', 'smart', 'daily']);
  });
});
```

- [ ] **Step 2: Run to verify it fails** — FAIL.

- [ ] **Step 3: Implement**

Create `apps/web/lib/privacy/channels.ts`:
```ts
import type { SelectOption } from '../../components/ui';

export type ChannelKind = 'push' | 'email' | 'sms' | 'telegram' | 'whatsapp';

export const URGENCY_OPTIONS: SelectOption[] = [
  { value: 'all', label: 'Everything' },
  { value: 'normal', label: 'Normal and up' },
  { value: 'high', label: 'Only important' },
  { value: 'urgent', label: 'Only urgent' },
];

export const DIGEST_OPTIONS: SelectOption[] = [
  { value: 'off', label: 'Send as they happen' },
  { value: 'smart', label: 'Batch the non-urgent' },
  { value: 'daily', label: 'One daily digest' },
];

export interface ChannelFlags {
  telegram?: boolean;
  sms?: boolean;
  whatsapp?: boolean;
}

export function channelMeta(flags: ChannelFlags): Record<ChannelKind, { label: string; live: boolean; help: string }> {
  const soon = (what: string) => `${what} arrives soon — your grove can't reach you here yet.`;
  return {
    push: { label: 'In-app', live: true, help: 'Always on — your grove always has a home in the app.' },
    email: { label: 'Email', live: true, help: 'Field-study nudges and your map, by email.' },
    telegram: { label: 'Telegram', live: !!flags.telegram, help: flags.telegram ? 'Connect Telegram for instant, free reach with one-tap approvals.' : soon('Telegram') },
    sms: { label: 'Text (SMS)', live: !!flags.sms, help: flags.sms ? 'Get texts for the things that matter most.' : soon('Text messages') },
    whatsapp: { label: 'WhatsApp', live: !!flags.whatsapp, help: flags.whatsapp ? 'Reach on WhatsApp with quick approve/deny.' : soon('WhatsApp') },
  };
}

function clampHour(v: FormDataEntryValue | null): number {
  const n = Math.trunc(Number(v));
  return Number.isFinite(n) ? Math.min(23, Math.max(0, n)) : 0;
}

const URGENCIES = new Set(['all', 'normal', 'high', 'urgent']);
const DIGESTS = new Set(['off', 'smart', 'daily']);

export function parseChannelPrefsForm(form: FormData): { channel: string; enabled: boolean; priority: number; urgencyThreshold: string } {
  const priorityRaw = Math.trunc(Number(form.get('priority')));
  const priority = Number.isFinite(priorityRaw) ? Math.min(1000, Math.max(0, priorityRaw)) : 100;
  const u = String(form.get('urgency_threshold') ?? '');
  return {
    channel: String(form.get('channel') ?? ''),
    enabled: form.get('enabled') === 'on',
    priority,
    urgencyThreshold: URGENCIES.has(u) ? u : 'all',
  };
}

export function parseSettingsForm(form: FormData): { quietStart: number; quietEnd: number; digestMode: string } {
  const d = String(form.get('digest_mode') ?? '');
  return {
    quietStart: clampHour(form.get('quiet_start')),
    quietEnd: clampHour(form.get('quiet_end')),
    digestMode: DIGESTS.has(d) ? d : 'smart',
  };
}
```

- [ ] **Step 4: Run to verify it passes** — PASS.

- [ ] **Step 5: Commit**
```bash
git add apps/web/lib/privacy/channels.ts apps/web/lib/privacy/channels.test.ts
git commit -m "feat(web): multi-channel prefs helpers (metadata, form parsing) + tests"
```

---

### Task 2: Server actions

**Files:**
- Modify: `apps/web/app/app/settings/privacy/actions.ts`

**Interfaces:**
- Consumes: `appSession()` + `redirect` (already imported in this file per `actions.ts:20-31`); `parseChannelPrefsForm`/`parseSettingsForm` (Task 1); the Plan 01 RPCs.
- Produces server actions: `connectChannel(formData)`, `disconnectChannel(formData)`, `saveChannelPrefs(formData)`, `saveNotificationSettings(formData)`.

- [ ] **Step 1: Add the actions**

Append to `apps/web/app/app/settings/privacy/actions.ts`:
```ts
import { parseChannelPrefsForm, parseSettingsForm } from '../../../../lib/privacy/channels';

export async function connectChannel(formData: FormData) {
  const channel = String(formData.get('channel') ?? '');
  const { supabase, accountId } = await appSession();
  const { data: nonce, error } = await supabase.rpc('request_channel_link', {
    target_account: accountId,
    channel,
  });
  if (error || !nonce) redirect('/app/settings/privacy?error=channel');
  // Telegram: deep-link the user to the bot with the nonce; other channels add
  // their own completion path here as they go live.
  if (channel === 'telegram' && process.env.NEXT_PUBLIC_TELEGRAM_BOT) {
    redirect(`https://t.me/${process.env.NEXT_PUBLIC_TELEGRAM_BOT}?start=${nonce}`);
  }
  redirect(`/app/settings/privacy?state=channel_pending&nonce=${nonce}&channel=${channel}`);
}

export async function disconnectChannel(formData: FormData) {
  const channelId = String(formData.get('channel_id') ?? '');
  const { supabase, accountId } = await appSession();
  const { error } = await supabase.rpc('revoke_channel', { target_account: accountId, channel_id: channelId });
  redirect(error ? '/app/settings/privacy?error=channel' : '/app/settings/privacy?state=channel_removed');
}

export async function saveChannelPrefs(formData: FormData) {
  const { channel, enabled, priority, urgencyThreshold } = parseChannelPrefsForm(formData);
  const { supabase, accountId } = await appSession();
  const { error } = await supabase.rpc('set_channel_prefs', {
    target_account: accountId,
    channel,
    enabled,
    priority,
    urgency_threshold: urgencyThreshold,
  });
  redirect(error ? '/app/settings/privacy?error=channel' : '/app/settings/privacy?state=channel_saved');
}

export async function saveNotificationSettings(formData: FormData) {
  const { quietStart, quietEnd, digestMode } = parseSettingsForm(formData);
  const { supabase, accountId } = await appSession();
  // Write the unified per-account settings...
  const { error } = await supabase.rpc('set_notification_settings', {
    target_account: accountId,
    quiet_start: quietStart,
    quiet_end: quietEnd,
    digest_mode: digestMode,
  });
  // ...and mirror quiet hours into drip_arcs so the LIVE companion-email arc
  // keeps honoring them until the drip worker reads notification_settings
  // (flagged follow-up). Errors here are non-fatal (a pre-arc account has no
  // drip row yet); the unified row is the source of truth.
  await supabase.rpc('set_notification_prefs', {
    target_account: accountId,
    email_enabled: formData.get('email_enabled') === 'on',
    quiet_start: quietStart,
    quiet_end: quietEnd,
  });
  redirect(error ? '/app/settings/privacy?error=notify' : '/app/settings/privacy?state=notify_saved');
}
```

- [ ] **Step 2: Typecheck** — `cd /c/nibbin-reach-me && npx tsc --noEmit -p apps/web` → no errors.

- [ ] **Step 3: Commit**
```bash
git add apps/web/app/app/settings/privacy/actions.ts
git commit -m "feat(web): channel connect/disconnect/prefs/settings server actions"
```

---

### Task 3: Render the Channels + Quiet-hours cards

**Files:**
- Modify: `apps/web/app/app/settings/privacy/page.tsx`

**Interfaces:**
- Consumes: the actions (Task 2), `channelMeta`/`URGENCY_OPTIONS`/`DIGEST_OPTIONS`/`HOUR_OPTIONS`, the `components/ui` kit.

- [ ] **Step 1: Read channels/prefs/settings + the live flags**

In `page.tsx`, after the existing `drip` read (around `page.tsx:136`), add:
```tsx
  const { data: channels } = await supabase
    .from('notification_channels')
    .select('id, channel, status, external_label')
    .neq('status', 'revoked');
  const { data: chanPrefs } = await supabase
    .from('channel_prefs')
    .select('channel, enabled, priority, urgency_threshold');
  const { data: settings } = await supabase
    .from('notification_settings')
    .select('quiet_start, quiet_end, digest_mode')
    .maybeSingle();

  const flags = {
    telegram: !!process.env.TELEGRAM_BOT_TOKEN,
    sms: process.env.CHANNELS_SMS_ENABLED === 'true',
    whatsapp: process.env.CHANNELS_WHATSAPP_ENABLED === 'true',
  };
  const meta = channelMeta(flags);
  const prefByChannel = new Map((chanPrefs ?? []).map((p) => [p.channel, p]));
  const connectedByChannel = new Map((channels ?? []).map((c) => [c.channel, c]));
  const settingsQuietStart = settings?.quiet_start ?? quietStart; // quietStart already read from drip
  const settingsQuietEnd = settings?.quiet_end ?? quietEnd;
  const digestMode = settings?.digest_mode ?? 'smart';
```

Add to the imports:
```tsx
import { setContribution, setNotificationPrefs, connectChannel, disconnectChannel, saveChannelPrefs, saveNotificationSettings } from './actions';
import { channelMeta, URGENCY_OPTIONS, DIGEST_OPTIONS } from '../../../../lib/privacy/channels';
```

- [ ] **Step 2: Render the Channels card** (place after the existing Notifications/email card)

```tsx
        <Card>
          <h2 className={styles.sectionTitle}>Where your grove reaches you</h2>
          <p className={styles.sectionHint}>
            Choose the channels your grove can reach you on, and how it tries them. The app always has
            your back — it’s the one place anything sensitive happens.
          </p>
          {state === 'channel_saved' && <InlineFeedback tone="success">Saved — your channel choices are recorded.</InlineFeedback>}
          {state === 'channel_removed' && <InlineFeedback tone="success">Disconnected.</InlineFeedback>}
          {error === 'channel' && <InlineFeedback tone="error">That didn’t go through — give it another go.</InlineFeedback>}

          {(['telegram', 'sms', 'whatsapp'] as const).map((ch) => {
            const m = meta[ch];
            const connected = connectedByChannel.get(ch);
            const pref = prefByChannel.get(ch);
            return (
              <div key={ch} className={styles.field}>
                <label className={styles.label}>
                  {m.label}{' '}
                  {connected?.status === 'verified' && <Badge tone="moss">Connected</Badge>}
                  {connected?.status === 'pending' && <Badge tone="honey">Pending</Badge>}
                  {!m.live && <Badge tone="neutral">Coming soon</Badge>}
                </label>
                <span className={styles.fieldHint}>{m.help}</span>

                {connected?.status === 'verified' ? (
                  <>
                    <form action={saveChannelPrefs} className={styles.form}>
                      <input type="hidden" name="channel" value={ch} />
                      <label className={styles.fieldHint}>
                        <input type="checkbox" name="enabled" defaultChecked={pref?.enabled ?? true} /> Reach me here
                      </label>
                      <Select name="urgency_threshold" defaultValue={pref?.urgency_threshold ?? 'all'} options={URGENCY_OPTIONS} aria-label={`${m.label} urgency`} />
                      <input type="hidden" name="priority" value={String(pref?.priority ?? 100)} />
                      <div className={styles.actions}><Button type="submit" variant="secondary">Save</Button></div>
                    </form>
                    <form action={disconnectChannel}>
                      <input type="hidden" name="channel_id" value={connected.id} />
                      <Button type="submit" variant="ghost">Disconnect</Button>
                    </form>
                  </>
                ) : (
                  <form action={connectChannel}>
                    <input type="hidden" name="channel" value={ch} />
                    <Button type="submit" variant="primary" disabled={!m.live}>
                      {m.live ? `Connect ${m.label}` : 'Coming soon'}
                    </Button>
                  </form>
                )}
              </div>
            );
          })}
        </Card>
```

- [ ] **Step 3: Render the Quiet hours & digest card**

```tsx
        <Card>
          <h2 className={styles.sectionTitle}>Quiet hours & digests</h2>
          <p className={styles.sectionHint}>
            Pick when your grove stays quiet, and how it batches the non-urgent. Only genuinely urgent
            things cross your quiet hours.
          </p>
          {state === 'notify_saved' && <InlineFeedback tone="success">Saved.</InlineFeedback>}
          {error === 'notify' && <InlineFeedback tone="error">That didn’t save — give it another go.</InlineFeedback>}
          <form action={saveNotificationSettings} className={styles.form}>
            <input type="hidden" name="email_enabled" value={emailEnabled ? 'on' : ''} />
            <div className={styles.field}>
              <label className={styles.label} htmlFor="qs">Quiet hours start</label>
              <Select id="qs" name="quiet_start" defaultValue={String(settingsQuietStart)} options={HOUR_OPTIONS} />
            </div>
            <div className={styles.field}>
              <label className={styles.label} htmlFor="qe">Quiet hours end</label>
              <Select id="qe" name="quiet_end" defaultValue={String(settingsQuietEnd)} options={HOUR_OPTIONS} />
            </div>
            <div className={styles.field}>
              <label className={styles.label} htmlFor="dm">Non-urgent notifications</label>
              <Select id="dm" name="digest_mode" defaultValue={digestMode} options={DIGEST_OPTIONS} />
            </div>
            <div className={styles.actions}><Button type="submit" variant="primary">Save quiet hours</Button></div>
          </form>
        </Card>
```

> NOTE: keep the existing email-only Notifications card for the `email_enabled` toggle, OR fold its toggle into this card and remove the old quiet-hours inputs from it (since quiet hours are now account-level). Recommended: keep the email card for `email_enabled` only (drop its quiet-hours selects), and let this card own quiet hours. Adjust the email card accordingly and update its copy ("Quiet hours moved to the card below").

- [ ] **Step 4: Typecheck + copy guard**

Run: `cd /c/nibbin-reach-me && npx tsc --noEmit -p apps/web && grep -niE "guarantee|100%|never miss" apps/web/app/app/settings/privacy/page.tsx || echo CLEAN`
Expected: no type errors + `CLEAN`.

- [ ] **Step 5: Commit**
```bash
git add apps/web/app/app/settings/privacy/page.tsx
git commit -m "feat(web): multi-channel prefs UI — channels card + quiet-hours/digest card (T13)"
```

---

## Self-review notes
- **N11 (per-channel prefs):** connect/disconnect, per-channel enable + urgency, account quiet hours + digest, all wired to the Plan 01 RPCs. Priority is stored (hidden field default 100) — a drag-reorder UI is a deferred enhancement; the dispatcher already orders by `priority`.
- **Honest UI:** SMS/WhatsApp show "Coming soon" with a disabled connect button until their flags flip (Plan 06) — no fake controls.
- **No silent breakage:** the account quiet-hours action mirrors into `drip_arcs` so the live email arc keeps honoring quiet hours; flagged follow-up: migrate the drip worker to read `notification_settings` and retire the mirror.
- **Reuses the kit:** Card/Button/Badge/Select/InlineFeedback + existing settings CSS; zero new primitives.
- **Deferred:** drag-reorder priority; per-channel quiet-hours overrides; the pending→verified live refresh (the page re-reads on navigation; a poll/realtime nicety is later).
