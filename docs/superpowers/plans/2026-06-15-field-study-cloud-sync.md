# Field Study Cloud Sync (Phase 2) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** When a field study finishes, the desktop segments its redacted events into a categorized synthesis packet on-device, uploads it (Bearer-authed) to `/api/study/packet`, and only then lets the daemon delete the raw data — producing a diagnosis the web app can read.

**Architecture:** A new deterministic on-device segmenter (`ObserverEvent[] → SynthesisPacket`, the cloud contract shape) lives in `packages/redaction`. The existing ingest endpoint gains a Bearer-auth path (desktop has no cookies) and idempotent upsert keyed on a new `study_id`. The desktop frontend orchestrates build → upload → advance, holding at `Synthesizing` on failure so raw data is never deleted before the packet is safely off-device (C3).

**Tech Stack:** TypeScript (segmenter + frontend + endpoint), Rust/Tauri (one bridge command), Supabase/Postgres (one migration), Vitest (web + redaction tests).

**Reference:** Design spec `docs/superpowers/specs/2026-06-15-field-study-cloud-sync-design.md`.

---

## Task 1: On-device segmenter

**Files:**
- Create: `packages/redaction/src/segment.ts`
- Create: `packages/redaction/test/segment.test.ts`
- Modify: `packages/redaction/src/index.ts` (export `segmentStudy`)

Context: `ObserverEvent` is in `packages/redaction/src/types.ts`. The output must match
`apps/web/lib/diagnosis/types.ts` `SynthesisPacket` exactly (plus a `studyId` field added in Task 2 —
for Task 1, define the shape locally including `studyId`). `batteryStillMatches(text): string | null`
is in `packages/redaction/src/battery.ts` (returns the first matching rule id, or null).
`sequenceCandidates(events, minN, maxN, minCount)` is exported from `packages/redaction/src/packet.ts`.

- [ ] **Step 1: Write the failing test**

```typescript
// packages/redaction/test/segment.test.ts
import { describe, it, expect } from 'vitest';
import { segmentStudy, PacketLeakError } from '../src/segment.js';
import type { ObserverEvent } from '../src/types.js';

function ev(partial: Partial<ObserverEvent> & { ts: string; session: string }): ObserverEvent {
  return {
    v: 1,
    id: `e-${partial.ts}-${partial.session}`,
    kind: 'ax_delta',
    app: { bundle_id: 'com.test', name: 'TestApp' },
    window: { title_redacted: 'Untitled', id: 'w1' },
    url: null,
    ax: { role_path: 'button', action: 'press', label_redacted: 'OK', value_class: 'none' },
    input: { keys: 0, clicks: 1, duration_ms: 60000 },
    frame_ref: null,
    redaction: { rules_hit: [], review_state: 'auto' },
    ...partial,
  };
}

const NOW = '2026-06-20T00:00:00.000Z';

describe('segmentStudy', () => {
  it('groups events into one workflow per category with aggregates', async () => {
    const events: ObserverEvent[] = [
      ev({ ts: '2026-06-10T09:00:00.000Z', session: 's1', app: { bundle_id: 'g', name: 'Gmail' },
           url: { host: 'mail.google.com', path_template: '/mail/u/0' } }),
      ev({ ts: '2026-06-10T09:05:00.000Z', session: 's1', app: { bundle_id: 'g', name: 'Gmail' },
           url: { host: 'mail.google.com', path_template: '/mail/u/0' } }),
      ev({ ts: '2026-06-11T10:00:00.000Z', session: 's2', app: { bundle_id: 's', name: 'Stripe' },
           url: { host: 'stripe.com', path_template: '/invoices' } }),
    ];
    const packet = await segmentStudy('study_1', events, NOW);
    expect(packet.version).toBe(1);
    expect(packet.studyId).toBe('study_1');
    const email = packet.workflows.find((w) => w.category === 'email');
    const payments = packet.workflows.find((w) => w.category === 'payments');
    expect(email).toBeDefined();
    expect(email!.minutesObserved).toBe(2); // 2 × 60000ms = 2 min
    expect(email!.sessions).toBe(1);
    expect(email!.apps).toEqual(['Gmail']);
    expect(payments!.minutesObserved).toBe(1);
    expect(payments!.sessions).toBe(1);
    expect(packet.capturedFrom).toBe('2026-06-10T09:00:00.000Z');
    expect(packet.capturedTo).toBe('2026-06-11T10:00:00.000Z');
    expect(packet.studyDays).toBe(2);
  });

  it('excludes user_deleted events', async () => {
    const events: ObserverEvent[] = [
      ev({ ts: '2026-06-10T09:00:00.000Z', session: 's1', url: { host: 'mail.google.com', path_template: '/' },
           redaction: { rules_hit: [], review_state: 'user_deleted' } }),
    ];
    const packet = await segmentStudy('study_1', events, NOW);
    expect(packet.workflows).toHaveLength(0);
  });

  it('throws PacketLeakError when a residual PII shape survives into the packet', async () => {
    // An app name that looks like an email address trips the battery re-scan.
    const events: ObserverEvent[] = [
      ev({ ts: '2026-06-10T09:00:00.000Z', session: 's1',
           app: { bundle_id: 'x', name: 'leak test@example.com' },
           url: { host: 'mail.google.com', path_template: '/' } }),
    ];
    await expect(segmentStudy('study_1', events, NOW)).rejects.toBeInstanceOf(PacketLeakError);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- segment`
Expected: FAIL — `Cannot find module '../src/segment.js'`.

- [ ] **Step 3: Write the segmenter**

```typescript
// packages/redaction/src/segment.ts
/**
 * On-device study segmenter (SPEC §5; design 2026-06-15). Turns the redacted
 * ObserverEvent stream into the cloud's diagnosis-packet contract
 * (apps/web/lib/diagnosis/types.ts SynthesisPacket) WITHOUT the event stream
 * ever leaving the device — only categorized workflow summaries upload (C1/C7).
 *
 * Deterministic v0: category by host→app dictionary, one workflow per category,
 * coarse `${category}.general` keys (the server's Opus pass writes warm labels
 * and finer keys; this stays honest). Paranoid re-scan before returning.
 */
import { batteryStillMatches } from './battery.js';
import { sequenceCandidates } from './packet.js';
import type { ObserverEvent } from './types.js';

export class PacketLeakError extends Error {
  constructor(ruleId: string) {
    super(`synthesis packet failed the paranoid re-scan: battery rule ${ruleId} still matches`);
    this.name = 'PacketLeakError';
  }
}

export type WorkflowCategory =
  | 'email' | 'calendar' | 'payments' | 'crm' | 'docs' | 'social' | 'other';

export interface PacketWorkflow {
  key: string;
  label: string;
  category: WorkflowCategory;
  apps: string[];
  minutesObserved: number;
  sessions: number;
  friction?: string;
}

export interface SynthesisPacket {
  version: 1;
  studyId: string;
  studyDays: number;
  capturedFrom: string;
  capturedTo: string;
  workflows: PacketWorkflow[];
}

const CATEGORY_LABEL: Record<WorkflowCategory, string> = {
  email: 'Email', calendar: 'Calendar', payments: 'Payments & invoicing',
  crm: 'Client records', docs: 'Documents', social: 'Social', other: 'Other work',
};

/** host substring → category (checked first), then app-name substring. */
const HOST_RULES: Array<[string, WorkflowCategory]> = [
  ['mail.google.com', 'email'], ['outlook.', 'email'], ['mail.yahoo.', 'email'],
  ['calendar.google.com', 'calendar'], ['cal.', 'calendar'],
  ['stripe.com', 'payments'], ['paypal.com', 'payments'], ['squareup.com', 'payments'],
  ['quickbooks.', 'payments'], ['intuit.com', 'payments'],
  ['salesforce.com', 'crm'], ['hubspot.com', 'crm'], ['pipedrive.com', 'crm'], ['honeybook.com', 'crm'],
  ['docs.google.com', 'docs'], ['notion.so', 'docs'], ['dropbox.com', 'docs'], ['office.com', 'docs'],
  ['x.com', 'social'], ['twitter.com', 'social'], ['linkedin.com', 'social'],
  ['facebook.com', 'social'], ['instagram.com', 'social'],
];

const APP_RULES: Array<[string, WorkflowCategory]> = [
  ['gmail', 'email'], ['outlook', 'email'], ['mail', 'email'], ['spark', 'email'], ['superhuman', 'email'],
  ['calendar', 'calendar'], ['fantastical', 'calendar'],
  ['stripe', 'payments'], ['quickbooks', 'payments'], ['quicken', 'payments'],
  ['salesforce', 'crm'], ['hubspot', 'crm'], ['honeybook', 'crm'],
  ['notion', 'docs'], ['word', 'docs'], ['excel', 'docs'], ['pages', 'docs'], ['docs', 'docs'],
  ['slack', 'social'], ['twitter', 'social'], ['linkedin', 'social'],
];

function categorize(e: ObserverEvent): WorkflowCategory {
  const host = e.url?.host?.toLowerCase() ?? '';
  for (const [needle, cat] of HOST_RULES) if (host.includes(needle)) return cat;
  const app = e.app.name.toLowerCase();
  for (const [needle, cat] of APP_RULES) if (app.includes(needle)) return cat;
  return 'other';
}

function isoFloorToDays(fromMs: number, toMs: number): number {
  const days = Math.ceil((toMs - fromMs) / 86_400_000);
  return Math.max(1, Math.min(14, days || 1));
}

export async function segmentStudy(
  studyId: string,
  events: ObserverEvent[],
  now: string,
): Promise<SynthesisPacket> {
  const exportable = events.filter((e) => e.redaction.review_state !== 'user_deleted');

  const byCat = new Map<WorkflowCategory, ObserverEvent[]>();
  for (const e of exportable) {
    const cat = categorize(e);
    (byCat.get(cat) ?? byCat.set(cat, []).get(cat)!).push(e);
  }

  const workflows: PacketWorkflow[] = [];
  for (const [category, evs] of byCat) {
    const ms = evs.reduce((s, e) => s + (e.input?.duration_ms ?? 0), 0);
    const sessions = new Set(evs.map((e) => e.session)).size;
    const apps = [...new Set(evs.map((e) => e.app.name))].sort();
    const seqs = sequenceCandidates(evs);
    const top = seqs[0];
    const friction =
      top && top.count >= 3 ? `Repeated ${top.steps.length}-step sequence observed ${top.count}×` : undefined;
    workflows.push({
      key: `${category}.general`,
      label: CATEGORY_LABEL[category],
      category,
      apps,
      minutesObserved: Math.round((ms / 60000) * 10) / 10,
      sessions,
      ...(friction ? { friction } : {}),
    });
  }
  workflows.sort((a, b) => b.minutesObserved - a.minutesObserved);

  const tss = exportable.map((e) => e.ts).sort();
  const capturedFrom = tss[0] ?? now;
  const capturedTo = tss[tss.length - 1] ?? now;
  const studyDays = isoFloorToDays(Date.parse(capturedFrom), Date.parse(capturedTo));

  const packet: SynthesisPacket = {
    version: 1, studyId, studyDays, capturedFrom, capturedTo, workflows,
  };

  const residual = batteryStillMatches(JSON.stringify(packet));
  if (residual !== null) throw new PacketLeakError(residual);

  return packet;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- segment`
Expected: PASS (3 tests).

Note: if `Date.parse`/`Date.now` is disallowed in the package's lint config, `now` is passed in by
the caller (it is) and `capturedFrom/To` come from event timestamps — `Date.parse` on fixed ISO
strings is pure. If the redaction package forbids `Date`, compute day-count by string comparison
instead; adjust and re-run.

- [ ] **Step 5: Export it**

```typescript
// packages/redaction/src/index.ts  (add alongside existing exports)
export { segmentStudy, PacketLeakError } from './segment.js';
export type { SynthesisPacket, PacketWorkflow, WorkflowCategory } from './segment.js';
```

Verify `packages/redaction/src/index.ts` does not already export a `PacketLeakError` (one exists in
`packet.ts`). If it does, re-export the segment one under the same name only if identical, otherwise
export `segmentStudy` + types only and import `PacketLeakError` from `packet.js` in the test.

- [ ] **Step 6: Commit**

```bash
git add packages/redaction/src/segment.ts packages/redaction/test/segment.test.ts packages/redaction/src/index.ts
git commit -m "feat(redaction): on-device study segmenter (events → diagnosis packet)"
```

---

## Task 2: Add `studyId` to the diagnosis packet contract

**Files:**
- Modify: `apps/web/lib/diagnosis/types.ts` (add `studyId` to `SynthesisPacket`)
- Modify: `apps/web/lib/diagnosis/synthesize.ts` (`validateSynthesisPacket` reads `studyId`)
- Test: `apps/web/lib/diagnosis/synthesize.test.ts` (create if absent, else extend)

Context: `validateSynthesisPacket(input): SynthesisPacket | null` lives in `synthesize.ts`. It uses
`clampStr(v, max)` already defined in that file. The web `SynthesisPacket` currently has
`version, studyDays, capturedFrom, capturedTo, workflows`.

- [ ] **Step 1: Write the failing test**

```typescript
// apps/web/lib/diagnosis/synthesize.test.ts
import { describe, it, expect } from 'vitest';
import { validateSynthesisPacket } from './synthesize';

const base = {
  version: 1, studyDays: 5, capturedFrom: '2026-06-10', capturedTo: '2026-06-15',
  workflows: [{ key: 'email.general', label: 'Email', category: 'email', apps: ['Gmail'],
                minutesObserved: 120, sessions: 10 }],
};

describe('validateSynthesisPacket studyId', () => {
  it('passes studyId through, clamped', () => {
    const p = validateSynthesisPacket({ ...base, studyId: 'study_abc' });
    expect(p?.studyId).toBe('study_abc');
  });
  it('tolerates a missing studyId (web caller)', () => {
    const p = validateSynthesisPacket(base);
    expect(p).not.toBeNull();
    expect(p?.studyId ?? '').toBe('');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- diagnosis/synthesize`
Expected: FAIL — `studyId` is not on the returned object (type error or undefined).

- [ ] **Step 3: Add `studyId` to the type**

```typescript
// apps/web/lib/diagnosis/types.ts — in interface SynthesisPacket, above version
export interface SynthesisPacket {
  version: 1;
  /** Stable id of the study this packet came from (idempotent upsert key). */
  studyId?: string;
  studyDays: number;
  capturedFrom: string;
  capturedTo: string;
  workflows: PacketWorkflow[];
}
```

- [ ] **Step 4: Read `studyId` in the validator**

```typescript
// apps/web/lib/diagnosis/synthesize.ts — in validateSynthesisPacket's return object
  return {
    version: 1,
    studyId: clampStr(p.studyId, 64) || undefined,
    studyDays,
    capturedFrom: clampStr(p.capturedFrom, 40),
    capturedTo: clampStr(p.capturedTo, 40),
    workflows,
  };
```

- [ ] **Step 5: Run test to verify it passes**

Run from repo root `C:\Nibbin`: `npm test -- diagnosis/synthesize`
(There is no `-w apps/web` test script — a single ROOT vitest config globs
`apps/*/lib/**/*.test.ts`, `apps/*/test/**/*.test.ts`, `packages/*/test/**`, and `tests/**`. Always
run tests from root with `npm test -- <path-substring>`.)
Expected: PASS.

- [ ] **Step 6: Drift guard — segmenter output must satisfy the cloud validator**

This is the guard the spec calls for. It must import BOTH the segmenter (`packages/redaction`) and the
validator (`apps/web`), so it lives in the root `tests/` dir (globbed; can use relative imports across
both — `apps/web/lib/diagnosis/synthesize.ts` imports only `./types`, no `server-only`, so it's safe to
import from a root test). `apps/web` does NOT depend on `@nibbin/redaction` and the package is not
aliased in vitest, so relative imports are required (not the `@nibbin/redaction` specifier).

```typescript
// tests/diagnosis-packet-contract.test.ts
import { describe, it, expect } from 'vitest';
import { segmentStudy } from '../packages/redaction/src/segment';
import { validateSynthesisPacket } from '../apps/web/lib/diagnosis/synthesize';
import type { ObserverEvent } from '../packages/redaction/src/types';

function ev(ts: string, session: string, host: string, app: string): ObserverEvent {
  return {
    v: 1, id: `${ts}-${session}`, ts, session, kind: 'ax_delta',
    app: { bundle_id: 'b', name: app }, window: { title_redacted: 'x', id: 'w' },
    url: { host, path_template: '/' },
    ax: { role_path: 'button', action: 'press', label_redacted: 'OK', value_class: 'none' },
    input: { keys: 0, clicks: 1, duration_ms: 60000 }, frame_ref: null,
    redaction: { rules_hit: [], review_state: 'auto' },
  };
}

describe('diagnosis packet contract (segmenter ↔ validator drift guard)', () => {
  it('segmentStudy output passes validateSynthesisPacket with workflows intact', async () => {
    const events = [
      ev('2026-06-10T09:00:00.000Z', 's1', 'mail.google.com', 'Gmail'),
      ev('2026-06-11T10:00:00.000Z', 's2', 'stripe.com', 'Stripe'),
    ];
    const packet = await segmentStudy('study_1', events, '2026-06-20T00:00:00.000Z');
    const validated = validateSynthesisPacket(packet);
    expect(validated).not.toBeNull();
    expect(validated!.studyId).toBe('study_1');
    expect(validated!.workflows.length).toBe(packet.workflows.length);
    expect(validated!.workflows.length).toBeGreaterThan(0);
  });
});
```

Run from root: `npm test -- diagnosis-packet-contract`
Expected: PASS. (Depends on Task 1's segmenter AND this task's `studyId` validator change.)

- [ ] **Step 7: Commit**

```bash
git add apps/web/lib/diagnosis/types.ts apps/web/lib/diagnosis/synthesize.ts apps/web/lib/diagnosis/synthesize.test.ts tests/diagnosis-packet-contract.test.ts
git commit -m "feat(diagnosis): carry studyId on the synthesis packet contract + drift guard"
```

---

## Task 3: Migration — `study_id` column + unique index

**Files:**
- Create: `supabase/migrations/20260615120000_diagnoses_study_id.sql`

Context: the latest existing migration is `20260614121000_desktop_auth_codes.sql`, so
`20260615120000` sorts strictly after it. The `diagnoses` table is defined in
`20260613150000_m7_diagnoses.sql`.

- [ ] **Step 1: Write the migration**

```sql
-- 20260615120000_diagnoses_study_id.sql
-- Phase 2 (field-study cloud sync): make packet upload idempotent. The desktop
-- may retry an upload (200 returned but the app died before advancing the study),
-- so key the diagnosis to its study and upsert instead of duplicating. Nullable +
-- partial unique index so existing rows (study_id null) are untouched and any
-- future web caller without a study id still inserts.
alter table public.diagnoses add column if not exists study_id text;
create unique index if not exists diagnoses_account_study_idx
  on public.diagnoses (account_id, study_id) where study_id is not null;
```

- [ ] **Step 2: Apply to the DEV Supabase project**

Apply via the Supabase MCP `apply_migration` to the dev project (Nibbin, `oqnqzytctwlptfdvyagl`).
Do NOT apply to prod in this task — prod apply happens at branch-land time with the user's OK.
Expected: success; `study_id` column present on `public.diagnoses`.

- [ ] **Step 3: Commit**

```bash
git add supabase/migrations/<timestamp>_diagnoses_study_id.sql
git commit -m "feat(db): study_id on diagnoses for idempotent packet upload"
```

---

## Task 4: Endpoint — Bearer auth + idempotent upsert

**Files:**
- Modify: `apps/web/app/api/study/packet/route.ts`
- Test: `apps/web/test/study-packet-route.test.ts` (create)

NOTE: the test goes under `apps/web/test/` (NOT next to the route under `apps/web/app/...`) because the
root vitest config only globs `apps/*/lib/**`, `apps/*/test/**`, `packages/*/test/**`, and `tests/**`.
A test under `app/` would never run. Import the route via relative path
`../app/api/study/packet/route`. Run from root: `npm test -- study-packet-route`.

Context: the handler currently does `const supabase = await createClient(); supabase.auth.getUser()`
(cookie path). `createServerClient` comes from `@supabase/ssr`; URL/key from
`apps/web/lib/supabase/env.ts` (`getSupabaseUrl`, `getSupabasePublishableKey`). `serviceClient()` is
in `apps/web/lib/supabase/service.ts`. The insert is at the `.from('diagnoses').insert({...})` call.

- [ ] **Step 1: Write the failing test (Bearer resolves user; upsert is idempotent)**

```typescript
// apps/web/test/study-packet-route.test.ts
// Mock specifiers are resolved relative to THIS file (apps/web/test/). They match
// the route's imports by resolved module id, so `../lib/...` here and the route's
// `../../../../lib/...` both point at apps/web/lib/... and the mock applies.
import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock the supabase layers so the route is testable without a live DB.
const upsert = vi.fn();
vi.mock('../lib/supabase/service', () => ({
  serviceClient: () => ({
    from: () => ({ upsert: (...a: unknown[]) => { upsert(...a); return {
      select: () => ({ single: () => ({ data: { id: 'diag_1' }, error: null }) }) }; },
      insert: () => ({ select: () => ({ single: () => ({ data: { id: 'diag_1' }, error: null }) }) }) }),
    rpc: async () => ({ data: null, error: null }),
  }),
}));
vi.mock('@supabase/ssr', () => ({
  createServerClient: () => ({
    auth: { getUser: async () => ({ data: { user: { id: 'u1', email: 'u@x.com' } } }) },
    rpc: async () => ({ data: 'acct_1', error: null }),
  }),
}));
vi.mock('../lib/supabase/server', () => ({
  createClient: async () => ({ auth: { getUser: async () => ({ data: { user: null } }) } }),
}));
vi.mock('../lib/auth/bootstrap', () => ({ ensureAccount: async () => 'acct_1' }));
vi.mock('../lib/auth/profile', () => ({ upsertOwnProfile: async () => {} }));
vi.mock('../lib/diagnosis/label', () => ({
  labelDiagnosis: async () => ({ map: { workflows: [], totalHoursPerWeek: 0, topRecommendations: [] }, letter: null }),
}));

import { POST } from '../app/api/study/packet/route';

function reqWith(body: unknown, headers: Record<string, string> = {}) {
  return new Request('http://localhost/api/study/packet', {
    method: 'POST', headers: { 'content-type': 'application/json', ...headers },
    body: JSON.stringify(body),
  }) as unknown as Parameters<typeof POST>[0];
}

const packet = {
  version: 1, studyId: 'study_1', studyDays: 5, capturedFrom: '2026-06-10', capturedTo: '2026-06-15',
  workflows: [{ key: 'email.general', label: 'Email', category: 'email', apps: ['Gmail'], minutesObserved: 60, sessions: 5 }],
};

describe('POST /api/study/packet', () => {
  beforeEach(() => upsert.mockClear());

  it('401s without a Bearer token or cookie session', async () => {
    const res = await POST(reqWith(packet));
    expect(res.status).toBe(401);
  });

  it('accepts a Bearer token and upserts keyed on study_id', async () => {
    const res = await POST(reqWith(packet, { authorization: 'Bearer abc.def.ghi' }));
    expect(res.status).toBe(200);
    expect(upsert).toHaveBeenCalledTimes(1);
    const [row, opts] = upsert.mock.calls[0];
    expect(row).toMatchObject({ account_id: 'acct_1', study_id: 'study_1' });
    expect(opts).toMatchObject({ onConflict: 'account_id,study_id' });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- study-packet-route`
Expected: FAIL — route still cookie-only (401 on the Bearer case) and uses `insert` not `upsert`.

- [ ] **Step 3: Add the Bearer client + upsert to the route**

```typescript
// apps/web/app/api/study/packet/route.ts
import { createServerClient } from '@supabase/ssr';
import { getSupabaseUrl, getSupabasePublishableKey } from '../../../../lib/supabase/env';
// ...existing imports (createClient, serviceClient, ensureAccount, upsertOwnProfile,
//    synthesizeDiagnosis, validateSynthesisPacket, labelDiagnosis)

// Desktop callers have no cookies — authenticate via Authorization: Bearer <jwt>.
// The token-bound client runs RPCs (bootstrap_account) under the user's auth.uid().
async function clientForRequest(req: NextRequest) {
  const bearer = req.headers.get('authorization')?.match(/^Bearer (.+)$/)?.[1];
  if (bearer) {
    return createServerClient(getSupabaseUrl(), getSupabasePublishableKey(), {
      global: { headers: { Authorization: `Bearer ${bearer}` } },
      cookies: { getAll: () => [], setAll: () => {} },
    });
  }
  return createClient();
}
```

Replace the first two lines of the handler:

```typescript
export async function POST(req: NextRequest): Promise<NextResponse> {
  const supabase = await clientForRequest(req);
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  // ...unchanged: ensureAccount, body parse, validateSynthesisPacket, synthesize, label...
```

Replace the insert with an idempotent upsert keyed on `study_id` (fall back to insert when absent):

```typescript
  const svc = serviceClient();
  const row = { account_id: accountId, status: 'ready' as const, packet, map, letter,
                ...(packet.studyId ? { study_id: packet.studyId } : {}) };
  const writer = packet.studyId
    ? svc.from('diagnoses').upsert(row, { onConflict: 'account_id,study_id' })
    : svc.from('diagnoses').insert(row);
  const { data, error } = await writer.select('id').single();
  if (error) return NextResponse.json({ error: 'store_failed' }, { status: 502 });
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- study-packet-route`
Expected: PASS (3 tests). Also run `npx tsc -p apps/web --noEmit` (or the repo's typecheck) to confirm types.

- [ ] **Step 5: Commit**

```bash
git add apps/web/app/api/study/packet/route.ts apps/web/app/api/study/packet/route.test.ts
git commit -m "feat(api): Bearer auth + idempotent upsert on study-packet ingest"
```

---

## Task 5: Bridge — expose the access token

**Files:**
- Modify: `apps/desktop/src-tauri/app/src/auth.rs` (add `access_token` command)
- Modify: `apps/desktop/src-tauri/app/src/lib.rs` (register it in `invoke_handler`)
- Modify: `apps/desktop/src/ui/bridge.ts` (add `accessToken()`)

Context: `auth.rs` has `pub fn session_tokens() -> Option<(String, String)>` returning
`(access, refresh)`. Other commands (`auth_session`, `sign_out`, `store_session`) are registered in
`lib.rs` `tauri::generate_handler![...]`. `bridge.ts` wraps `invoke(...)` calls.

- [ ] **Step 1: Add the command**

```rust
// apps/desktop/src-tauri/app/src/auth.rs
/// The keychain access token, for Bearer-authing desktop→web API calls
/// (e.g. the study-packet upload). Refresh token stays in the keychain; neither
/// is ever placed in a URL.
#[tauri::command]
pub fn access_token() -> Option<String> {
    session_tokens().map(|(access, _refresh)| access)
}
```

- [ ] **Step 2: Register it**

```rust
// apps/desktop/src-tauri/app/src/lib.rs — add auth::access_token to generate_handler![...]
```

Find the existing `tauri::generate_handler![` macro and add `auth::access_token,` alongside the other
`auth::` commands.

- [ ] **Step 3: Add the bridge wrapper**

```typescript
// apps/desktop/src/ui/bridge.ts — alongside the other invoke wrappers
export async function accessToken(): Promise<string | null> {
  return (await invoke<string | null>('access_token')) ?? null;
}
```

Match the file's existing export style (if `bridge.ts` exports a single `bridge` object, add
`accessToken` as a method on it instead).

- [ ] **Step 4: Verify it compiles**

Run: `cargo check --manifest-path apps/desktop/src-tauri/app/Cargo.toml`
Expected: success (no unused-warning on `access_token`; it is wired into the handler).
Also: `npm run build -w apps/desktop` (frontend typecheck) if the bridge is typechecked separately.

- [ ] **Step 5: Commit**

```bash
git add apps/desktop/src-tauri/app/src/auth.rs apps/desktop/src-tauri/app/src/lib.rs apps/desktop/src/ui/bridge.ts
git commit -m "feat(desktop): access_token bridge command for Bearer-authed uploads"
```

---

## Task 6: Frontend — build → upload → advance (C3 ordering)

**Files:**
- Create: `apps/desktop/src/ui/sync-study.ts` (the orchestration, unit-testable)
- Create: `apps/desktop/test/sync-study.test.ts`
- Modify: `apps/desktop/src/ui/views/field-study.ts` (call it on entering Synthesizing; render states)
- Modify: `apps/desktop/src/ui/observer.css` (synthesizing states: building/uploading/error)

Context: `bridge.ts` exposes `reviewEvents()`, `sendControl(cmd)`, and now `accessToken()`.
`segmentStudy` is imported from `@nibbin/redaction`. The web base URL on desktop is the prod origin
(`https://nibbin.com`); read it the same way the Grove tab does (`web_url()` mirror — in the
frontend, hardcode `https://nibbin.com` or read an injected constant; match how `supabase.ts`
resolves its URL). The study snapshot (with `studyId`) comes from `bridge.studyStatus()` →
`.study.studyId`.

- [ ] **Step 1: Write the failing test (C3 guard is the critical assertion)**

```typescript
// apps/desktop/test/sync-study.test.ts
import { describe, it, expect, vi } from 'vitest';

// Orchestration test: segmentation is covered in packages/redaction. Mock it so
// this file tests only build→upload→advance ordering (the C3 guard).
vi.mock('@nibbin/redaction', () => ({
  segmentStudy: vi.fn(async (studyId: string) => ({
    version: 1, studyId, studyDays: 1, capturedFrom: '2026-06-19', capturedTo: '2026-06-20', workflows: [],
  })),
}));

import { syncStudy } from '../src/ui/sync-study.js';

const events = [{ redaction: { review_state: 'auto' } } as never];

function bridgeStub(over: Partial<Record<string, unknown>> = {}) {
  return {
    reviewEvents: vi.fn(async () => events),
    accessToken: vi.fn(async () => 'tok'),
    sendControl: vi.fn(async () => {}),
    ...over,
  };
}

describe('syncStudy (C3 ordering)', () => {
  it('advances the study only after a 200', async () => {
    const bridge = bridgeStub();
    const fetchFn = vi.fn(async () => new Response(JSON.stringify({ ok: true }), { status: 200 }));
    const onState = vi.fn();
    const res = await syncStudy({ studyId: 's1', bridge: bridge as never, fetchFn, now: '2026-06-20T00:00:00Z', onState });
    expect(res.ok).toBe(true);
    expect(bridge.sendControl).toHaveBeenCalledWith('synthesis_complete');
    expect(onState).toHaveBeenCalledWith('done');
  });

  it('does NOT advance the study when upload fails (raw data preserved)', async () => {
    const bridge = bridgeStub();
    const fetchFn = vi.fn(async () => new Response('err', { status: 502 }));
    const onState = vi.fn();
    const res = await syncStudy({ studyId: 's1', bridge: bridge as never, fetchFn, now: '2026-06-20T00:00:00Z', onState });
    expect(res.ok).toBe(false);
    expect(bridge.sendControl).not.toHaveBeenCalled(); // C3: no deletion before packet is off-device
    expect(onState).toHaveBeenCalledWith('error');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- sync-study`
Expected: FAIL — `Cannot find module '../src/ui/sync-study.js'`.

- [ ] **Step 3: Write the orchestration**

```typescript
// apps/desktop/src/ui/sync-study.ts
/**
 * Field-study cloud sync (design 2026-06-15). Build the diagnosis packet
 * on-device, upload it Bearer-authed, and advance the study ONLY on a 200 —
 * holding at Synthesizing on any failure so the daemon never deletes raw data
 * before the packet is safely off-device (C3).
 */
import { segmentStudy } from '@nibbin/redaction';

export type SyncState = 'building' | 'uploading' | 'done' | 'error';

const WEB_ORIGIN = 'https://nibbin.com';

interface SyncBridge {
  reviewEvents(): Promise<unknown[]>;
  accessToken(): Promise<string | null>;
  sendControl(cmd: string): Promise<void>;
}

export async function syncStudy(opts: {
  studyId: string;
  bridge: SyncBridge;
  now: string;
  fetchFn?: typeof fetch;
  onState?: (s: SyncState) => void;
}): Promise<{ ok: boolean; error?: string }> {
  const { studyId, bridge, now, fetchFn = fetch, onState = () => {} } = opts;
  try {
    onState('building');
    const events = (await bridge.reviewEvents()) as Parameters<typeof segmentStudy>[1];
    const packet = await segmentStudy(studyId, events, now);
    const token = await bridge.accessToken();
    if (!token) { onState('error'); return { ok: false, error: 'not_signed_in' }; }

    onState('uploading');
    const res = await fetchFn(`${WEB_ORIGIN}/api/study/packet`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
      body: JSON.stringify(packet),
    });
    if (!res.ok) { onState('error'); return { ok: false, error: `upload_${res.status}` }; }

    // 200 confirmed → safe to let the daemon delete raw data.
    await bridge.sendControl('synthesis_complete');
    onState('done');
    return { ok: true };
  } catch (e) {
    onState('error');
    return { ok: false, error: e instanceof Error ? e.message : 'sync_failed' };
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- sync-study`
Expected: PASS (2 tests), including the C3 guard.

- [ ] **Step 5: Wire it into the Synthesizing view + styles**

In `apps/desktop/src/ui/views/field-study.ts`, when rendering the `SYNTHESIZING` state, call
`syncStudy({ studyId, bridge, now: new Date().toISOString() })` once (guard against double-fire with a
module flag or the daemon state), render the `SyncState` (building → "Building your diagnosis…",
uploading → "Sending to Nibbin…", done → "Done — your diagnosis is ready", error → message + a
"Retry" button that re-invokes `syncStudy`). Match the existing field-study sub-view markup and the
warm copy register. Add the corresponding `.sync-*` styles to `observer.css` consistent with the
existing field-study states (reuse the DAEMON_OFFLINE / state-card patterns already there).

- [ ] **Step 6: Verify build**

Run: `npm run build -w apps/desktop`
Expected: success (frontend typechecks, bundles).

- [ ] **Step 7: Commit**

```bash
git add apps/desktop/src/ui/sync-study.ts apps/desktop/test/sync-study.test.ts apps/desktop/src/ui/views/field-study.ts apps/desktop/src/ui/observer.css
git commit -m "feat(desktop): field-study cloud sync — segment, upload, advance on 200 (C3)"
```

---

## Task 7: STATE.md follow-ups + final review

**Files:**
- Modify: `docs/STATE.md`

- [ ] **Step 1: Record Phase 2 + the deferred items**

Add under M7 in `docs/STATE.md`: field-study cloud sync shipped (on-device segmenter v0 → Bearer
upload → idempotent diagnosis).

**Retention model (decided 2026-06-15):** keep the existing auto-delete of raw (events + on-device
frames) at study end — that is the product's trust anchor ("we watch, learn, delete"). The redacted
synthesis packet *becomes* the diagnosis and is retained durably until account close (#29), so the
*findings* persist; only the raw substrate is deleted. To preserve future re-analysis value as models
improve, **enrich the retained packet** rather than retain raw (chosen over a user-controlled raw
retention model).

Note the deferred follow-ups:
- (a) **Packet enrichment (committed direction)** — the v0 packet retains only coarse per-category
  aggregates. Enrich it with re-minable redacted structure (e.g. the sequence candidates + daily
  app-duration aggregates `buildSynthesisPacket` already computes, per-workflow role_path patterns)
  within the 256KB `diagnoses.packet` cap, so future/better models can re-mine without raw. Needs its
  own mini-design (fields + size budget + re-mining schema). Highest-value next step after Phase 2.
- (b) **Ad-hoc / incremental analysis (Phase 3)** — partial studies ALREADY work (early-stop →
  window-aware `studyDays` → diagnosis, just noisier). Net-new is an *ad-hoc single-workflow capture*
  ("quick scan") entry point + a session-type study, built on the same segmenter/packet/endpoint. Its
  own spec.
- (c) finer workflow mining (split `email.general` into inquiries/overdue/newsletter).
- (d) packet compression/chunking for studies that exceed the 256KB `diagnoses.packet` cap.
- (e) prod migration apply + `NIBBIN_GROVE_HANDOFF`/web-origin wiring at branch-land time.

- [ ] **Step 2: Commit**

```bash
git add docs/STATE.md
git commit -m "docs(state): record field-study cloud sync + Phase 2 follow-ups"
```

- [ ] **Step 3: Final full-suite check**

Run: `npm test -- segment diagnosis-packet-contract study-packet-route`
Expected: all green. Then dispatch the final code-reviewer over the whole Phase 2 diff.
