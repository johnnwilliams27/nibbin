# Review-Before-Upload Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Insert a user-visible review gate between building the field-study diagnosis packet and uploading it, so the only artifact that ever leaves the device (the synthesis packet, C7) is shown to the user — who can drop any workflow or delete everything — before it is sent.

**Architecture:** Today `syncStudy()` builds the packet and `POST`s it straight to `/api/study/packet` with no review. We add an optional `review` callback to `syncStudy`: after the packet is built, `syncStudy` awaits the user's decision (`send` the possibly-filtered packet / `delete` everything / `cancel`). The reviewable, removable unit is `SynthesisPacket.workflows[]` (each has a stable `key`). Filtering is a pure function (`filterPacket`) so the egress-gating logic is fully unit-tested in Node; the on-screen review list is a thin presentational view verified by the type checker.

**Tech Stack:** TypeScript (the `apps/desktop` framework-free UI), `@nibbin/redaction` (`segmentStudy`, the packet contract), Vitest (monorepo-wide, node environment).

**Source spec:** `docs/superpowers/specs/2026-06-17-trust-and-controls-design.md` §5.2 (requirements T3, T4; principle TC-P4).

---

## Implementation note: discharges T3 and T4

- **T3** — review-before-upload shows the real packet contents and lets the user redact/cancel.
- **T4** — no upload without explicit confirm; a "delete instead" path.

## Testing-boundary note

The desktop app has no DOM test runner (no jsdom; every existing repo test is node-environment logic). Rather than add DOM tooling, the load-bearing logic — the egress gate flow and packet filtering — lives in pure functions (`syncStudy`, `filterPacket`) with full Vitest coverage (Task 1). The review *view* (Task 2) is thin glue over `filterPacket` and is verified by the type checker. A jsdom-based view test is a reasonable later addition but is out of scope here.

## File Structure

- **Modify** `vitest.config.ts` — add the `@nibbin/redaction` source alias (the other `@nibbin/*` packages are already aliased) so desktop tests resolve the package to its TS source.
- **Modify** `apps/desktop/src/ui/sync-study.ts` — add `DiagnosisPacket`/`ReviewDecision` types, the `reviewing` sync state, the `review` callback, `filterPacket`, and the gated upload/delete flow.
- **Create** `apps/desktop/test/sync-study.test.ts` — Vitest (node) coverage of the gate.
- **Create** `apps/desktop/src/ui/views/packet-review.ts` — the review screen (presentational).
- **Modify** `apps/desktop/src/ui/views/field-study.ts` — wire `synthesizingView` to render the review screen and resolve the decision; add the `reviewing` copy.

---

### Task 1: The review gate in `syncStudy` + `filterPacket`

**Files:**
- Modify: `vitest.config.ts:11-16` (alias block)
- Modify: `apps/desktop/src/ui/sync-study.ts` (whole file)
- Test: `apps/desktop/test/sync-study.test.ts`

- [ ] **Step 1: Alias `@nibbin/redaction` to its source for tests**

In `vitest.config.ts`, add one line to the `resolve.alias` object (after the `@nibbin/email` line, keeping the same `fileURLToPath(new URL(...))` form):

```ts
      '@nibbin/email': fileURLToPath(new URL('./packages/email/src/index.ts', import.meta.url)),
      '@nibbin/redaction': fileURLToPath(new URL('./packages/redaction/src/index.ts', import.meta.url)),
```

(The `packages/redaction` own tests import via relative `../src` paths, so this alias does not affect them.)

- [ ] **Step 2: Write the failing tests**

Create `apps/desktop/test/sync-study.test.ts`:

```ts
import { describe, it, expect, vi } from 'vitest';
import { syncStudy, filterPacket, type DiagnosisPacket, type ReviewDecision } from '../src/ui/sync-study.js';

function packet(keys: string[] = ['email.general', 'payments.invoices']): DiagnosisPacket {
  return {
    version: 1,
    studyId: 's',
    studyDays: 14,
    capturedFrom: '2026-06-01T00:00:00Z',
    capturedTo: '2026-06-15T00:00:00Z',
    workflows: keys.map((key) => ({
      key,
      label: key,
      category: 'other',
      apps: ['App'],
      minutesObserved: 10,
      sessions: 1,
    })),
  } as DiagnosisPacket;
}

function bridge() {
  return {
    reviewEvents: async () => [],
    accessToken: async () => 'tok',
    sendControl: vi.fn(async () => {}),
  };
}

const okFetch = () => vi.fn(async () => ({ ok: true, status: 200 }) as unknown as Response);

describe('syncStudy review gate', () => {
  it('does not upload until the review resolves', async () => {
    const fetchFn = okFetch();
    let resolveReview!: (d: ReviewDecision) => void;
    const review = (_p: DiagnosisPacket) =>
      new Promise<ReviewDecision>((res) => { resolveReview = res; });

    const pending = syncStudy({ studyId: 's', bridge: bridge(), now: 'n', fetchFn, review });
    await new Promise((r) => setTimeout(r, 0)); // let build + review start
    expect(fetchFn).not.toHaveBeenCalled();

    resolveReview({ action: 'send', packet: packet() });
    await pending;
    expect(fetchFn).toHaveBeenCalledOnce();
  });

  it('uploads exactly the reviewed (filtered) packet', async () => {
    const fetchFn = okFetch();
    const reviewed = packet(['payments.invoices']);
    const res = await syncStudy({
      studyId: 's', bridge: bridge(), now: 'n', fetchFn,
      review: async () => ({ action: 'send', packet: reviewed }),
    });
    expect(res.ok).toBe(true);
    const body = JSON.parse((fetchFn.mock.calls[0][1] as RequestInit).body as string);
    expect(body.workflows.map((w: { key: string }) => w.key)).toEqual(['payments.invoices']);
  });

  it('cancel uploads nothing and deletes nothing', async () => {
    const fetchFn = okFetch();
    const b = bridge();
    const res = await syncStudy({
      studyId: 's', bridge: b, now: 'n', fetchFn,
      review: async () => ({ action: 'cancel' }),
    });
    expect(fetchFn).not.toHaveBeenCalled();
    expect(b.sendControl).not.toHaveBeenCalled();
    expect(res).toEqual({ ok: false, error: 'review_cancelled' });
  });

  it('delete instead wipes locally and uploads nothing', async () => {
    const fetchFn = okFetch();
    const b = bridge();
    const res = await syncStudy({
      studyId: 's', bridge: b, now: 'n', fetchFn,
      review: async () => ({ action: 'delete' }),
    });
    expect(fetchFn).not.toHaveBeenCalled();
    expect(b.sendControl).toHaveBeenCalledWith('delete_everything');
    expect(res).toEqual({ ok: true, deleted: true });
  });

  it('filterPacket drops workflows by key', () => {
    const filtered = filterPacket(packet(['a', 'b']), new Set(['a']));
    expect(filtered.workflows.map((w) => w.key)).toEqual(['b']);
  });
});
```

- [ ] **Step 3: Run the tests to verify they fail**

Run: `npx vitest run apps/desktop/test/sync-study.test.ts`
Expected: FAIL — `filterPacket`, `DiagnosisPacket`, `ReviewDecision`, and the `review` option do not exist yet.

- [ ] **Step 4: Implement the gate**

Replace the entire contents of `apps/desktop/src/ui/sync-study.ts` with:

```ts
/**
 * Field-study cloud sync (design 2026-06-15) + review-before-upload gate
 * (Trust & Controls spec §5.2). Build the diagnosis packet on-device, show it
 * to the user, and upload only what they approve — advancing the study ONLY on
 * a 200 so the daemon never deletes raw data before the packet is safely
 * off-device (C3/C7).
 */
import { segmentStudy } from '@nibbin/redaction';

export type SyncState = 'building' | 'reviewing' | 'uploading' | 'done' | 'error';

/** The on-device diagnosis packet `segmentStudy` produces (the cloud contract). */
export type DiagnosisPacket = Awaited<ReturnType<typeof segmentStudy>>;

/** The user's choice at the review-before-upload gate (T3/T4). */
export type ReviewDecision =
  | { action: 'send'; packet: DiagnosisPacket }
  | { action: 'delete' }
  | { action: 'cancel' };

const WEB_ORIGIN = 'https://nibbin.com';

interface SyncBridge {
  reviewEvents(): Promise<unknown[]>;
  accessToken(): Promise<string | null>;
  sendControl(cmd: string): Promise<void>;
}

/** Drop the workflows the user removed at the review gate, by key. */
export function filterPacket(packet: DiagnosisPacket, removedKeys: Set<string>): DiagnosisPacket {
  return { ...packet, workflows: packet.workflows.filter((w) => !removedKeys.has(w.key)) };
}

export async function syncStudy(opts: {
  studyId: string;
  bridge: SyncBridge;
  now: string;
  kind?: 'full_study' | 'quick_scan';
  label?: string | null;
  fetchFn?: typeof fetch;
  onState?: (s: SyncState) => void;
  /** Review-before-upload gate (§5.2): the only egress artifact is shown before
   * it leaves the device. Omitted = legacy direct upload (back-compat). */
  review?: (packet: DiagnosisPacket) => Promise<ReviewDecision>;
}): Promise<{ ok: boolean; error?: string; deleted?: boolean }> {
  const { studyId, bridge, now, kind, label, fetchFn = fetch, onState = () => {}, review } = opts;
  try {
    onState('building');
    const events = (await bridge.reviewEvents()) as Parameters<typeof segmentStudy>[1];
    const packet = await segmentStudy(studyId, events, now, { kind, label });

    let toUpload: DiagnosisPacket = packet;
    if (review) {
      onState('reviewing');
      const decision = await review(packet);
      if (decision.action === 'cancel') {
        // Nothing leaves the device; the study waits for the user to come back.
        return { ok: false, error: 'review_cancelled' };
      }
      if (decision.action === 'delete') {
        // "Delete instead": wipe locally, upload nothing (TC-P4).
        await bridge.sendControl('delete_everything');
        return { ok: true, deleted: true };
      }
      toUpload = decision.packet;
    }

    const token = await bridge.accessToken();
    if (!token) { onState('error'); return { ok: false, error: 'not_signed_in' }; }

    onState('uploading');
    const res = await fetchFn(`${WEB_ORIGIN}/api/study/packet`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
      body: JSON.stringify(toUpload),
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

- [ ] **Step 5: Run the tests to verify they pass**

Run: `npx vitest run apps/desktop/test/sync-study.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 6: Typecheck the desktop app**

Run: `npx tsc --noEmit -p apps/desktop`
Expected: no errors.

- [ ] **Step 7: Commit**

```bash
git add vitest.config.ts apps/desktop/src/ui/sync-study.ts apps/desktop/test/sync-study.test.ts
git commit -m "feat(desktop): review-before-upload gate in syncStudy + filterPacket"
```

---

### Task 2: The review screen

**Files:**
- Create: `apps/desktop/src/ui/views/packet-review.ts`

This is a presentational view over the tested `filterPacket`. It lists each workflow with a remove/keep toggle and resolves the caller's `ReviewDecision` on **Send** (the filtered packet) or **Delete instead**.

- [ ] **Step 1: Write the view**

Create `apps/desktop/src/ui/views/packet-review.ts`:

```ts
/**
 * Review-before-upload screen (Trust & Controls spec §5.2). Shows the actual
 * diagnosis packet — the only artifact that leaves the device (C7) — and lets
 * the user drop any workflow before upload, or delete everything instead.
 * Resolves the caller's ReviewDecision on the user's choice.
 */
import { button, el } from '../dom.js';
import { filterPacket, type DiagnosisPacket, type ReviewDecision } from '../sync-study.js';

export function packetReviewView(
  packet: DiagnosisPacket,
  onDecision: (decision: ReviewDecision) => void,
): HTMLElement {
  const removed = new Set<string>();
  const root = el('div', {});

  function render(): void {
    const rows = packet.workflows.map((w) => {
      const dropped = removed.has(w.key);
      const meta = `${w.apps.join(', ') || '—'} · ${Math.round(w.minutesObserved)} min`;
      const toggle = button(
        dropped ? 'Removed — keep' : 'Remove',
        () => {
          if (dropped) removed.delete(w.key);
          else removed.add(w.key);
          render();
        },
        dropped ? 'danger' : '',
      );
      return el('div', { class: `card review-row ${dropped ? 'review-removed' : ''}` }, [
        el('div', {}, [
          el('p', { class: 'sync-status' }, [w.label]),
          el('p', { class: 'muted' }, [meta]),
        ]),
        toggle,
      ]);
    });

    const remaining = packet.workflows.length - removed.size;
    root.replaceChildren(
      el('p', { class: 'eyebrow' }, ['Field study']),
      el('h1', {}, ['Review before it leaves your device']),
      el('p', { class: 'muted' }, [
        'Only this redacted summary leaves your device — your screen recordings never do. Remove anything you don’t want to send.',
      ]),
      ...(rows.length ? rows : [el('p', { class: 'muted' }, ['No workflows were found to send.'])]),
      el('div', { class: 'card row' }, [
        button(
          `Send to Nibbin (${remaining})`,
          () => onDecision({ action: 'send', packet: filterPacket(packet, removed) }),
          'primary',
        ),
        button('Delete instead', () => onDecision({ action: 'delete' }), 'danger'),
      ]),
    );
  }

  render();
  return root;
}
```

- [ ] **Step 2: Typecheck**

Run: `npx tsc --noEmit -p apps/desktop`
Expected: no errors (confirms the view's use of `filterPacket`, `DiagnosisPacket`, `ReviewDecision`, `el`, and `button` is type-correct).

- [ ] **Step 3: Commit**

```bash
git add apps/desktop/src/ui/views/packet-review.ts
git commit -m "feat(desktop): packet review screen (workflow drop + delete-instead)"
```

---

### Task 3: Wire the review screen into the synthesizing flow

**Files:**
- Modify: `apps/desktop/src/ui/views/field-study.ts:16` (import), `:31-36` (SYNC_COPY), `:81-93` (kickoff)

`synthesizingView` currently kicks off `syncStudy` with no `review`. We pass a `review` that renders `packetReviewView` and resolves the decision on the user's click, and add the `reviewing` copy. The existing remount/Retry logic is unchanged — re-entry is safe because nothing uploads without **Send**.

- [ ] **Step 1: Import the review view**

In `field-study.ts`, change the `./study.js` import line (line 16) to also import the review view. After:

```ts
import { deleteEverythingCard, studyView } from './study.js';
```

add:

```ts
import { packetReviewView } from './packet-review.js';
import type { ReviewDecision } from '../sync-study.js';
```

- [ ] **Step 2: Add the `reviewing` copy**

The `SYNC_COPY` map (lines 31-36) is typed `Record<SyncState, string>`, so adding the `reviewing` state to `SyncState` (Task 1) makes this map a type error until the key is added. Add the `reviewing` entry:

```ts
const SYNC_COPY: Record<SyncState, string> = {
  building: 'Building your diagnosis…',
  reviewing: 'Review what’s about to be sent.',
  uploading: 'Sending to Nibbin…',
  done: 'Done — your diagnosis is ready.',
  error: `Couldn't send your diagnosis. Your raw data is still here, untouched — we'll only delete it once the diagnosis is safely saved.`,
};
```

- [ ] **Step 3: Render the review screen inside `synthesizingView`**

In `synthesizingView`, the `render()` function shows the `SYNC_COPY` card for every state. Add a branch so the `reviewing` state shows the actual review screen instead of a status line, and pass a `review` callback into `kickoff`'s `syncStudy` call.

Replace the `render()` function body (lines 64-79) with:

```ts
  function render(): void {
    // While reviewing, show the packet itself (the review screen owns the UI
    // and resolves the pending decision); otherwise show the status card.
    if (syncState === 'reviewing' && pendingReview) {
      root.replaceChildren(pendingReview);
      return;
    }
    // Retry is reachable on any non-'done' state of a re-mounted (resumed)
    // study, and on 'error' for the live first mount. Never strand on a
    // non-interactive spinner.
    const showRetry = syncState === 'error' || (resumed && syncState !== 'done');
    root.replaceChildren(
      el('p', { class: 'eyebrow' }, ['Field study']),
      el('h1', {}, ['Building your map…']),
      el('div', { class: `card sync-card sync-${syncState}` }, [
        el('p', { class: 'sync-status' }, [SYNC_COPY[syncState]]),
        ...(showRetry
          ? [el('div', { class: 'row' }, [button('Retry', () => { kickoff(); }, 'primary')])]
          : []),
      ]),
    );
  }
```

Add the `pendingReview` declaration just above `function setState` (after line 56, `let syncState: SyncState = persisted ?? 'building';`):

```ts
  let pendingReview: HTMLElement | null = null;
```

Replace the `kickoff()` function (lines 81-93) with:

```ts
  function kickoff(): void {
    void syncStudy({
      studyId,
      bridge,
      now: new Date().toISOString(),
      kind: meta.kind,
      label: meta.label,
      onState: (s) => { setState(s); },
      // Review-before-upload (§5.2): render the packet and resolve on the
      // user's choice. The pending element is shown by render() in 'reviewing'.
      review: (packet) =>
        new Promise<ReviewDecision>((resolve) => {
          pendingReview = packetReviewView(packet, (decision) => {
            pendingReview = null;
            resolve(decision);
          });
          render();
        }),
    }).then((res) => {
      // On success the daemon advances past SYNTHESIZING; reflect that promptly.
      if (res.ok) rerender();
    });
  }
```

- [ ] **Step 4: Typecheck the desktop app**

Run: `npx tsc --noEmit -p apps/desktop`
Expected: no errors. (If `SYNC_COPY` errors with "property 'reviewing' is missing", Step 2 was skipped; if `ReviewDecision`/`packetReviewView` are unresolved, Step 1 was skipped.)

- [ ] **Step 5: Re-run the gate tests (no regression)**

Run: `npx vitest run apps/desktop/test/sync-study.test.ts`
Expected: PASS (5 tests) — the wiring change does not touch `syncStudy`'s contract.

- [ ] **Step 6: Commit**

```bash
git add apps/desktop/src/ui/views/field-study.ts
git commit -m "feat(desktop): show review-before-upload screen in the synthesizing flow"
```

---

## Self-review notes (verified against the spec)

- **T3 covered** — Task 2 (the review screen shows real packet contents + per-workflow remove), Task 1 (`filterPacket` drops removed workflows; the reviewed packet is what uploads).
- **T4 covered** — Task 1 (no upload before `review` resolves; `cancel` → no egress; `delete` → `delete_everything`, no egress; only `send` uploads), proven by the four gate tests.
- **TC-P4 / C7 honored** — the review copy states only the redacted summary leaves the device; `cancel` keeps everything local (study waits).
- **Back-compat** — `review` is optional; existing callers/behavior are unchanged when it is omitted. The UI (Task 3) always supplies it, so the gate is always present in the product.
- **Re-entry safety** — the existing remount/Retry path re-enters review; because upload is gated on **Send**, re-entry can never double-upload.
- **Testing boundary** — the egress-deciding logic is pure and fully tested in node; the view is thin glue verified by `tsc`. No DOM runner was added (repo has none); a jsdom view test is a clean later addition.
- **Type consistency** — `DiagnosisPacket`, `ReviewDecision`, `filterPacket`, `packetReviewView`, `SyncState` (with `reviewing`) are used identically across all three files.
- **Depends on Plan 1?** No — this plan is independent of the exclusion-persistence plan; they share no code and can ship in either order.
```
