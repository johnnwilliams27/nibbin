import { expect, it } from 'vitest';
import { buildEffectsExecutor } from '../lib/runtime/engine';
import type { Connection } from '@nibbin/connectors';

const COMPOSE = 'https://www.googleapis.com/auth/gmail.compose';
const SEND = 'https://www.googleapis.com/auth/gmail.send';

function makeGmailConn(scopes: string[]): Connection {
  return {
    id: 'conn1', accountId: 'acc1', provider: 'gmail', method: 'H', scopes,
    status: 'active', tokenRef: 'ref1', webhookState: {}, createdBy: null,
    createdAt: '2026-01-01T00:00:00Z', revokedAt: null,
  };
}

it('email.draft capability calls createDraft', async () => {
  const drafts: string[] = [];
  const byId = new Map([['conn1', makeGmailConn([COMPOSE, SEND])]]);
  const executor = buildEffectsExecutor(byId, 'acc1', Date.now() - 86400000 * 30, {
    createDraft: async (rfc822: string) => { drafts.push(rfc822); return { id: 'd1' }; },
    sendMessage: async () => { throw new Error('should not send'); },
    sendVelocityConsume: async () => ({ allowed: true }),
  });
  await executor({ connectionId: 'conn1', capability: 'email.draft', args: { rfc822: 'cmF3' }, idempotencyKey: 'ik1' });
  expect(drafts).toEqual(['cmF3']);
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
    executor({ connectionId: 'conn-missing', capability: 'email.draft', args: { rfc822: '' }, idempotencyKey: 'ik5' }),
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
