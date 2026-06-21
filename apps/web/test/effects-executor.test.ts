import { expect, it } from 'vitest';
import { buildEffectsExecutor } from '../lib/runtime/engine';
import type { Connection } from '@nibbin/connectors';

// ── Task 4: native-draft mirror + delete-sync ─────────────────────────────────
// (a) drafting an email step at draft level (nativeDraftRef absent, createDraft
//     present) calls createDraft and stores a native_draft_ref
it('Task 4: email.send with nativeDraft mode calls createDraft and returns the id in result', async () => {
  const drafts: string[] = [];
  const byId = new Map([['conn1', makeGmailConn([COMPOSE, SEND])]]);
  const executor = buildEffectsExecutor(byId, 'acc1', Date.now() - 86400000 * 30, {
    createDraft: async (rfc822: string) => { drafts.push(rfc822); return { id: 'draft-native-1' }; },
    sendMessage: async () => { throw new Error('should not send in draft mode'); },
    sendVelocityConsume: async () => { throw new Error('velocity should not be consumed for native draft'); },
    deleteDraft: async () => {},
    sendDraft: async () => { throw new Error('should not sendDraft without a ref'); },
  });
  // nativeDraftRef absent → createDraft path
  const result = await executor({
    connectionId: 'conn1',
    capability: 'email.send',
    args: { rfc822: 'cmF3', nativeDraft: true },
    idempotencyKey: 'ik-nd1',
  });
  expect(drafts).toEqual(['cmF3']);
  expect((result as { nativeDraftId?: string } | void)?.nativeDraftId).toBe('draft-native-1');
});

// (b) drafting a calendar step records NO native ref (nativeDraft false on the descriptor)
it('Task 4: calendar.event-create does NOT call createDraft (nativeDraft:false)', async () => {
  const draftCalls: unknown[] = [];
  const events: unknown[] = [];
  const byId = new Map([['cal1', makeCalendarConn(['https://www.googleapis.com/auth/calendar.events'])]]);
  const executor = buildEffectsExecutor(byId, 'acc1', Date.now() - 86400000 * 30, {
    createDraft: async () => { draftCalls.push(true); return { id: 'x' }; },
    sendMessage: async () => { throw new Error('should not send'); },
    sendVelocityConsume: async () => ({ allowed: true }),
    createEvent: async (_cid, ev) => { events.push(ev); return { id: 'evt-t4' }; },
    deleteDraft: async () => {},
    sendDraft: async () => ({}),
  });
  await executor({ connectionId: 'cal1', capability: 'calendar.event-create', args: { event: { summary: 'Test' } }, idempotencyKey: 'ik-cal-nd' });
  expect(draftCalls).toHaveLength(0); // no native draft for calendar
  expect(events).toHaveLength(1);
});

// (c) sending with a stored nativeDraftRef calls sendDraft (not a fresh send)
it('Task 4: email.send with nativeDraftRef calls sendDraft (not sendMessage)', async () => {
  const sends: string[] = [];
  const draftSends: string[] = [];
  const byId = new Map([['conn1', makeGmailConn([COMPOSE, SEND])]]);
  const executor = buildEffectsExecutor(byId, 'acc1', Date.now() - 86400000 * 30, {
    createDraft: async () => { throw new Error('should not re-create draft'); },
    sendMessage: async (r) => { sends.push(r); return { id: 's-fresh' }; },
    sendVelocityConsume: async () => ({ allowed: true }),
    deleteDraft: async () => {},
    sendDraft: async (draftId) => { draftSends.push(draftId); return { id: 's-stored' }; },
  });
  await executor({
    connectionId: 'conn1',
    capability: 'email.send',
    args: { rfc822: 'cmF3', nativeDraftRef: 'draft-stored-xyz' },
    idempotencyKey: 'ik-nd-send',
  });
  // Must use sendDraft with the stored ref, NOT a fresh sendMessage
  expect(draftSends).toEqual(['draft-stored-xyz']);
  expect(sends).toHaveLength(0);
});

// (d) dismissing (deleteDraft ref) calls deleteDraft best-effort
it('Task 4: deleteDraft is called on dismiss with a nativeDraftRef', async () => {
  const deleted: string[] = [];
  const byId = new Map([['conn1', makeGmailConn([COMPOSE, SEND])]]);
  const executor = buildEffectsExecutor(byId, 'acc1', Date.now() - 86400000 * 30, {
    createDraft: async () => ({}),
    sendMessage: async () => ({}),
    sendVelocityConsume: async () => ({ allowed: true }),
    deleteDraft: async (draftId) => { deleted.push(draftId); },
    sendDraft: async () => ({}),
  });
  await executor({
    connectionId: 'conn1',
    capability: 'email.send',
    args: { rfc822: 'cmF3', nativeDraftRef: 'draft-to-delete', dismiss: true },
    idempotencyKey: 'ik-dismiss',
  });
  expect(deleted).toEqual(['draft-to-delete']);
});

const COMPOSE = 'https://www.googleapis.com/auth/gmail.compose';
const SEND = 'https://www.googleapis.com/auth/gmail.send';

function makeGmailConn(scopes: string[]): Connection {
  return {
    id: 'conn1', accountId: 'acc1', provider: 'gmail', method: 'H', scopes,
    status: 'active', tokenRef: 'ref1', webhookState: {}, createdBy: null,
    createdAt: '2026-01-01T00:00:00Z', revokedAt: null,
  };
}

// Task 3: email.draft retired. email.send is the single email write capability.
// Task 4 will wire the native-draft path (nativeDraft:true). For now email.send
// at the executor level always calls sendMessage (the runner gates draft steps
// for human approval before the executor is ever invoked at Draft level).
it('email.send capability calls sendMessage (single email write capability, Task 3)', async () => {
  const sends: string[] = [];
  const byId = new Map([['conn1', makeGmailConn([COMPOSE, SEND])]]);
  const executor = buildEffectsExecutor(byId, 'acc1', Date.now() - 86400000 * 30, {
    createDraft: async () => { throw new Error('should not draft'); },
    sendMessage: async (rfc822: string) => { sends.push(rfc822); return { id: 's-dup' }; },
    sendVelocityConsume: async () => ({ allowed: true }),
  });
  await executor({ connectionId: 'conn1', capability: 'email.send', args: { rfc822: 'cmF3' }, idempotencyKey: 'ik1' });
  expect(sends).toEqual(['cmF3']);
});

it('email.send capability calls sendMessage after velocity check', async () => {
  const sends: string[] = [];
  const byId = new Map([['conn1', makeGmailConn([COMPOSE, SEND])]]);
  const executor = buildEffectsExecutor(byId, 'acc1', Date.now() - 86400000 * 30, {
    createDraft: async () => { throw new Error('should not draft'); },
    sendMessage: async (rfc822: string) => { sends.push(rfc822); return { id: 's1' }; },
    sendVelocityConsume: async () => ({ allowed: true }),
  });
  await executor({ connectionId: 'conn1', capability: 'email.send', args: { rfc822: 'cmF3' }, idempotencyKey: 'ik2' });
  expect(sends).toEqual(['cmF3']);
});

it('email.send blocked by velocity returns error', async () => {
  const byId = new Map([['conn1', makeGmailConn([COMPOSE, SEND])]]);
  const executor = buildEffectsExecutor(byId, 'acc1', Date.now(), {
    createDraft: async () => ({ id: '' }),
    sendMessage: async () => ({ id: '' }),
    sendVelocityConsume: async () => ({ allowed: false, reason: 'daily-cap' as const, retryAfterMs: 3600000 }),
  });
  await expect(
    executor({ connectionId: 'conn1', capability: 'email.send', args: { rfc822: 'cmF3' }, idempotencyKey: 'ik3' }),
  ).rejects.toThrow(/daily-cap/);
});

function makeCalendarConn(scopes: string[]): Connection {
  return {
    id: 'cal1', accountId: 'acc1', provider: 'google-calendar', method: 'H', scopes,
    status: 'active', tokenRef: 'ref1', webhookState: {}, createdBy: null,
    createdAt: '2026-01-01T00:00:00Z', revokedAt: null,
  };
}

it('calendar.event-create capability calls createEvent with calendarId + event (no velocity cap)', async () => {
  const events: Array<{ calendarId: string; event: Record<string, unknown> }> = [];
  const byId = new Map([['cal1', makeCalendarConn(['https://www.googleapis.com/auth/calendar.events'])]]);
  let velocityCalled = false;
  const executor = buildEffectsExecutor(byId, 'acc1', Date.now() - 86400000 * 30, {
    createDraft: async () => { throw new Error('should not draft'); },
    sendMessage: async () => { throw new Error('should not send'); },
    sendVelocityConsume: async () => { velocityCalled = true; return { allowed: true }; },
    createEvent: async (calendarId, event) => { events.push({ calendarId, event }); return { id: 'evt1' }; },
  });
  await executor({
    connectionId: 'cal1',
    capability: 'calendar.event-create',
    args: { calendarId: 'primary', event: { summary: 'Shoot' } },
    idempotencyKey: 'ik-cal',
  });
  expect(events).toEqual([{ calendarId: 'primary', event: { summary: 'Shoot' } }]);
  // Calendar creation is NOT a bulk-send rail — no velocity consume.
  expect(velocityCalled).toBe(false);
});

it('calendar.event-create defaults calendarId to primary when omitted', async () => {
  const events: Array<{ calendarId: string }> = [];
  const byId = new Map([['cal1', makeCalendarConn(['https://www.googleapis.com/auth/calendar.events'])]]);
  const executor = buildEffectsExecutor(byId, 'acc1', Date.now(), {
    createDraft: async () => ({ id: '' }),
    sendMessage: async () => ({ id: '' }),
    sendVelocityConsume: async () => ({ allowed: true }),
    createEvent: async (calendarId) => { events.push({ calendarId }); return { id: 'e' }; },
  });
  await executor({ connectionId: 'cal1', capability: 'calendar.event-create', args: { event: {} }, idempotencyKey: 'ik-cal2' });
  expect(events[0].calendarId).toBe('primary');
});

it('unknown capability throws', async () => {
  const byId = new Map([['conn1', makeGmailConn([COMPOSE, SEND])]]);
  const executor = buildEffectsExecutor(byId, 'acc1', Date.now(), {
    createDraft: async () => ({ id: '' }),
    sendMessage: async () => ({ id: '' }),
    sendVelocityConsume: async () => ({ allowed: true }),
  });
  await expect(
    executor({ connectionId: 'conn1', capability: 'sms.send', args: {}, idempotencyKey: 'ik4' }),
  ).rejects.toThrow(/no executor for capability/i);
});

it('missing connection throws', async () => {
  const byId = new Map<string, Connection>();
  const executor = buildEffectsExecutor(byId, 'acc1', Date.now(), {
    createDraft: async () => ({ id: '' }),
    sendMessage: async () => ({ id: '' }),
    sendVelocityConsume: async () => ({ allowed: true }),
  });
  await expect(
    executor({ connectionId: 'conn-missing', capability: 'email.send', args: { rfc822: '' }, idempotencyKey: 'ik5' }),
  ).rejects.toThrow(/not found/);
});

/**
 * FIX 1 (Spec 2) — ONE send_records row per send, not two.
 *
 * The production path calls the atomic send_velocity_consume RPC (which
 * inserts the send_records row) and then must NOT re-consume velocity via the
 * in-process SendVelocityLimiter. This test verifies that sendVelocityConsume
 * is called exactly once per email.send invocation, so the 100/day cap is not
 * silently halved to ~50/day.
 */
it('email.send calls sendVelocityConsume exactly once per send (no double-consume)', async () => {
  const velocityCalls: number[] = [];
  const sends: string[] = [];
  const byId = new Map([['conn1', makeGmailConn([COMPOSE, SEND])]]);
  const executor = buildEffectsExecutor(byId, 'acc1', Date.now() - 86400000 * 30, {
    createDraft: async () => ({ id: '' }),
    sendMessage: async (rfc822: string) => { sends.push(rfc822); return { id: 'sx' }; },
    sendVelocityConsume: async () => { velocityCalls.push(Date.now()); return { allowed: true }; },
  });
  await executor({ connectionId: 'conn1', capability: 'email.send', args: { rfc822: 'Y29udGVudA==' }, idempotencyKey: 'ik-dedup-test' });
  expect(velocityCalls).toHaveLength(1);
  expect(sends).toHaveLength(1);
});
