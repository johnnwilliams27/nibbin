import { describe, it, expect } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import { PgSendRecordStore } from './pg-send-velocity-store';
import type { ConnectorDescriptor } from '@nibbin/connectors';

// ── test fixture ──────────────────────────────────────────────────────────────

/** Minimal descriptor with velocity caps declared. */
const DESCRIPTOR: ConnectorDescriptor = {
  id: 'test-connector',
  label: 'Test',
  tier: 1,
  method: 'H',
  scopes: { read: ['read:all'], write: [] },
  webhooks: { supported: false },
  rateLimit: { requests: 100, perSeconds: 1 },
  scanModules: [],
  capabilities: ['msg.send'],
  egressAllowlist: ['api.example.com'],
  send: {
    velocity: {
      perAccountPerHour: 10,
      perAccountPerDay: 50,
      newAccountCooldownHours: 24,
      newAccountPerDay: 5,
    },
  },
  availability: 'live',
};

const DESCRIPTOR_NO_CAPS: ConnectorDescriptor = {
  ...DESCRIPTOR,
  id: 'read-only',
  capabilities: ['data.read'],
  send: undefined,
};

const MATURE_ACCOUNT_MS = Date.now() - 30 * 24 * 3_600_000; // 30 days old
const NEW_ACCOUNT_MS = Date.now() - 1_800_000; // 30 min old

// ── RPC mock helpers ──────────────────────────────────────────────────────────

function makeRpcSvc(row: { allowed: boolean; used_hour: number; used_day: number } | null, throwError?: Error) {
  return {
    rpc: async (_name: string, _args: unknown) => {
      if (throwError) throw throwError;
      if (row === null) return { data: null, error: { message: 'db error' } };
      return { data: [row], error: null };
    },
  } as unknown as SupabaseClient;
}

// ── checkAndConsume tests ─────────────────────────────────────────────────────

describe('PgSendRecordStore.checkAndConsume', () => {
  it('allows a send when RPC returns allowed=true', async () => {
    const store = new PgSendRecordStore(makeRpcSvc({ allowed: true, used_hour: 1, used_day: 1 }));
    const result = await store.checkAndConsume('acc1', DESCRIPTOR, MATURE_ACCOUNT_MS);
    expect(result.allowed).toBe(true);
  });

  it('denies when RPC returns allowed=false with high hourly usage → hourly-cap', async () => {
    const caps = DESCRIPTOR.send!.velocity;
    // used_hour >= perAccountPerHour triggers hourly-cap reason
    const store = new PgSendRecordStore(makeRpcSvc({
      allowed: false,
      used_hour: caps.perAccountPerHour,
      used_day: caps.perAccountPerHour,
    }));
    const result = await store.checkAndConsume('acc1', DESCRIPTOR, MATURE_ACCOUNT_MS);
    expect(result.allowed).toBe(false);
    if (!result.allowed) {
      expect(result.reason).toBe('hourly-cap');
      expect(result.retryAfterMs).toBeGreaterThan(0);
    }
  });

  it('denies with daily-cap reason when daily limit hit (mature account)', async () => {
    const caps = DESCRIPTOR.send!.velocity;
    const store = new PgSendRecordStore(makeRpcSvc({
      allowed: false,
      used_hour: caps.perAccountPerHour - 1, // not hourly-capped
      used_day: caps.perAccountPerDay,
    }));
    const result = await store.checkAndConsume('acc1', DESCRIPTOR, MATURE_ACCOUNT_MS);
    expect(result.allowed).toBe(false);
    if (!result.allowed) {
      expect(result.reason).toBe('daily-cap');
    }
  });

  it('denies with new-account-cap reason for new accounts hitting stricter budget', async () => {
    // new account with newAccountPerDay < perAccountPerDay — use that budget
    const store = new PgSendRecordStore(makeRpcSvc({
      allowed: false,
      used_hour: 0, // not hourly-capped
      used_day: DESCRIPTOR.send!.velocity.newAccountPerDay,
    }));
    const result = await store.checkAndConsume('acc1', DESCRIPTOR, NEW_ACCOUNT_MS);
    expect(result.allowed).toBe(false);
    if (!result.allowed) {
      expect(result.reason).toBe('new-account-cap');
    }
  });

  it('is fail-closed: RPC error → allowed:false', async () => {
    const store = new PgSendRecordStore(makeRpcSvc(null)); // null triggers db error
    const result = await store.checkAndConsume('acc1', DESCRIPTOR, MATURE_ACCOUNT_MS);
    expect(result.allowed).toBe(false);
  });

  it('is fail-closed: thrown exception → allowed:false', async () => {
    const store = new PgSendRecordStore(makeRpcSvc({ allowed: true, used_hour: 0, used_day: 0 }, new Error('network')));
    const result = await store.checkAndConsume('acc1', DESCRIPTOR, MATURE_ACCOUNT_MS);
    expect(result.allowed).toBe(false);
  });

  it('denies immediately (no RPC call) for connector without velocity caps', async () => {
    let rpcCalled = false;
    const svc = {
      rpc: async () => { rpcCalled = true; return { data: null, error: null }; },
    } as unknown as SupabaseClient;
    const store = new PgSendRecordStore(svc);
    const result = await store.checkAndConsume('acc1', DESCRIPTOR_NO_CAPS, MATURE_ACCOUNT_MS);
    expect(result.allowed).toBe(false);
    expect(rpcCalled).toBe(false);
  });

  it('passes newAccountPerDay as p_daily_cap for new accounts', async () => {
    let capturedArgs: Record<string, unknown> = {};
    const svc = {
      rpc: async (_name: string, args: unknown) => {
        capturedArgs = args as Record<string, unknown>;
        return { data: [{ allowed: true, used_hour: 1, used_day: 1 }], error: null };
      },
    } as unknown as SupabaseClient;
    const store = new PgSendRecordStore(svc);
    await store.checkAndConsume('acc1', DESCRIPTOR, NEW_ACCOUNT_MS);
    // New account should use the stricter cap
    expect(capturedArgs['p_daily_cap']).toBe(DESCRIPTOR.send!.velocity.newAccountPerDay);
  });

  it('passes perAccountPerDay as p_daily_cap for mature accounts', async () => {
    let capturedArgs: Record<string, unknown> = {};
    const svc = {
      rpc: async (_name: string, args: unknown) => {
        capturedArgs = args as Record<string, unknown>;
        return { data: [{ allowed: true, used_hour: 1, used_day: 1 }], error: null };
      },
    } as unknown as SupabaseClient;
    const store = new PgSendRecordStore(svc);
    await store.checkAndConsume('acc1', DESCRIPTOR, MATURE_ACCOUNT_MS);
    expect(capturedArgs['p_daily_cap']).toBe(DESCRIPTOR.send!.velocity.perAccountPerDay);
  });

  it('passes p_connector_id = descriptor.id, not provider string', async () => {
    let capturedArgs: Record<string, unknown> = {};
    const svc = {
      rpc: async (_name: string, args: unknown) => {
        capturedArgs = args as Record<string, unknown>;
        return { data: [{ allowed: true, used_hour: 1, used_day: 1 }], error: null };
      },
    } as unknown as SupabaseClient;
    const store = new PgSendRecordStore(svc);
    await store.checkAndConsume('acc-xyz', DESCRIPTOR, MATURE_ACCOUNT_MS);
    expect(capturedArgs['p_connector_id']).toBe(DESCRIPTOR.id);
    expect(capturedArgs['p_account_id']).toBe('acc-xyz');
  });
});
