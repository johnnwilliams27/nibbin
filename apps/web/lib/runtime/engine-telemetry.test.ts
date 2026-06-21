/**
 * Fleet-learning telemetry emitted from the runtime engine layer:
 *  - connector_blocked on velocity-cap (email.send path)
 *  - connector_blocked on ConnectorRequestError (auth / connection-state) from effects
 *
 * Uses the EffectsExecutorTestDeps injection seam so no real connector clients
 * or Supabase connections are needed. The event sink is a MemoryEventSink so
 * we can assert exactly what was emitted without any I/O.
 */
import { describe, expect, it } from 'vitest';
import { MemoryEventSink } from '@nibbin/runtime';
import { ConnectorRequestError } from '@nibbin/connectors';
import { buildEffectsExecutor } from './engine';
import type { Connection } from '@nibbin/connectors';

function makeConnection(overrides: Partial<Connection> = {}): Connection {
  return {
    id: 'conn-1',
    accountId: 'acct-1',
    provider: 'gmail',
    method: 'G',
    scopes: ['https://www.googleapis.com/auth/gmail.compose'],
    status: 'active',
    tokenRef: 'tok-1',
    webhookState: {},
    createdBy: null,
    createdAt: new Date().toISOString(),
    revokedAt: null,
    ...overrides,
  };
}

describe('buildEffectsExecutor — fleet-learning telemetry', () => {
  it('emits connector_blocked with reason=velocity_cap when send is blocked', async () => {
    const conn = makeConnection();
    const byId = new Map([['conn-1', conn]]);
    const sink = new MemoryEventSink();

    const executor = buildEffectsExecutor(
      byId,
      'acct-1',
      0,
      {
        createDraft: async () => ({}),
        sendMessage: async () => ({}),
        sendVelocityConsume: async () => ({ allowed: false, reason: 'daily-cap', retryAfterMs: 3600000 }),
      },
      sink,
    );

    await expect(
      executor({ connectionId: 'conn-1', capability: 'email.send', args: { rfc822: '' }, idempotencyKey: 'k1' }),
    ).rejects.toThrow(/velocity cap/);

    expect(sink.events).toHaveLength(1);
    expect(sink.events[0].name).toBe('connector_blocked');
    expect(sink.events[0].props?.connector).toBe('gmail');
    expect(sink.events[0].props?.reason).toBe('velocity_cap');
    expect(sink.events[0].accountId).toBe('acct-1');
  });

  it('emits connector_blocked with reason=auth_failed on ConnectorRequestError(auth) from email.send', async () => {
    const conn = makeConnection();
    const byId = new Map([['conn-1', conn]]);
    const sink = new MemoryEventSink();

    const executor = buildEffectsExecutor(
      byId,
      'acct-1',
      0,
      {
        createDraft: async () => ({}),
        sendMessage: async () => {
          throw new ConnectorRequestError('gmail', 401, 'auth');
        },
        sendVelocityConsume: async () => ({ allowed: true }),
      },
      sink,
    );

    await expect(
      executor({ connectionId: 'conn-1', capability: 'email.send', args: { rfc822: '' }, idempotencyKey: 'k2' }),
    ).rejects.toBeInstanceOf(ConnectorRequestError);

    expect(sink.events).toHaveLength(1);
    expect(sink.events[0].name).toBe('connector_blocked');
    expect(sink.events[0].props?.connector).toBe('gmail');
    expect(sink.events[0].props?.reason).toBe('auth_failed');
  });

  it('does NOT emit for non-auth ConnectorRequestError kinds (e.g. rate-limit) from email.send', async () => {
    const conn = makeConnection();
    const byId = new Map([['conn-1', conn]]);
    const sink = new MemoryEventSink();

    const executor = buildEffectsExecutor(
      byId,
      'acct-1',
      0,
      {
        createDraft: async () => ({}),
        sendMessage: async () => {
          throw new ConnectorRequestError('gmail', 429, 'rate-limit');
        },
        sendVelocityConsume: async () => ({ allowed: true }),
      },
      sink,
    );

    await expect(
      executor({ connectionId: 'conn-1', capability: 'email.send', args: { rfc822: '' }, idempotencyKey: 'k3' }),
    ).rejects.toBeInstanceOf(ConnectorRequestError);

    // rate-limit is not one of the three connector_blocked reasons — no event.
    expect(sink.events).toHaveLength(0);
  });

  it('telemetry failure never prevents the underlying error from propagating', async () => {
    const conn = makeConnection();
    const byId = new Map([['conn-1', conn]]);

    // A sink that always throws — telemetry must not mask the original error.
    const brokenSink = {
      emit: async () => { throw new Error('sink exploded'); },
    };

    const executor = buildEffectsExecutor(
      byId,
      'acct-1',
      0,
      {
        createDraft: async () => ({}),
        sendMessage: async () => ({}),
        sendVelocityConsume: async () => ({ allowed: false, reason: 'daily-cap', retryAfterMs: 0 }),
      },
      brokenSink,
    );

    // The run error (velocity cap) must still propagate even though the sink exploded.
    await expect(
      executor({ connectionId: 'conn-1', capability: 'email.send', args: { rfc822: '' }, idempotencyKey: 'k4' }),
    ).rejects.toThrow(/velocity cap/);
  });
});
