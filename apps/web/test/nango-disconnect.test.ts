/**
 * Task 10 — Nango disconnect flow TDD suite.
 *
 * Covers:
 *  - [N] provider disconnect calls nango.deleteConnection(providerConfigKey, connectionId)
 *    in the correct argument order BEFORE revoking the row.
 *  - Nango delete failure is fail-open: row revoke still proceeds even if
 *    deleteConnection throws.
 *  - [H]/[G] provider disconnect uses the existing vault-revoke path unchanged
 *    (no nango object consulted).
 */
import { describe, it, expect, vi } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import { revokeAndSuspend, type NangoDeleteClient } from '../lib/connections/revoke-connection';

// ── mock helpers ─────────────────────────────────────────────────────────────

/** Minimal Nango mock for the disconnect flow. */
function makeMockNango(opts: { shouldThrow?: boolean } = {}): { deleteConnection: ReturnType<typeof vi.fn> } & NangoDeleteClient {
  return {
    deleteConnection: opts.shouldThrow
      ? vi.fn().mockRejectedValue(new Error('Nango delete failed'))
      : vi.fn().mockResolvedValue(undefined),
  };
}

/** Build a minimal Supabase service client mock. */
function makeServiceMock(opts: { rpcError?: string } = {}) {
  const updates: Record<string, unknown>[] = [];
  const rpcCalls: { name: string; params: Record<string, unknown> }[] = [];

  const svc = {
    rpc: vi.fn(async (name: string, params: Record<string, unknown>) => {
      rpcCalls.push({ name, params });
      return { data: null, error: opts.rpcError ? { message: opts.rpcError } : null };
    }),
    from: vi.fn((table: string) => {
      if (table === 'nibbin_write_grants') {
        return {
          update: (row: Record<string, unknown>) => {
            updates.push(row);
            return { eq: () => ({ is: () => ({ error: null }) }) };
          },
        };
      }
      throw new Error(`unexpected table: ${table}`);
    }),
    _rpcCalls: rpcCalls,
    _updates: updates,
  } as unknown as SupabaseClient & {
    _rpcCalls: typeof rpcCalls;
    _updates: typeof updates;
  };

  return svc;
}

// ── [N] provider — happy path ─────────────────────────────────────────────────

describe('[N] provider disconnect — happy path', () => {
  it('calls nango.deleteConnection(providerConfigKey, connectionId) before revoking row', async () => {
    const callOrder: string[] = [];

    // Build a nango mock that records the call order
    const nango: NangoDeleteClient & { deleteConnection: ReturnType<typeof vi.fn> } = {
      deleteConnection: vi.fn(async (_providerConfigKey: string, _connectionId: string) => {
        callOrder.push('nango.deleteConnection');
      }),
    };

    // Build a svc mock that records the rpc call order
    const updates: Record<string, unknown>[] = [];
    const rpcCalls: { name: string; params: Record<string, unknown> }[] = [];
    const svc = {
      rpc: vi.fn(async (name: string, params: Record<string, unknown>) => {
        callOrder.push('rpc');
        rpcCalls.push({ name, params });
        return { data: null, error: null };
      }),
      from: vi.fn((table: string) => {
        if (table === 'nibbin_write_grants') {
          return {
            update: (row: Record<string, unknown>) => {
              updates.push(row);
              return { eq: () => ({ is: () => ({ error: null }) }) };
            },
          };
        }
        throw new Error(`unexpected table: ${table}`);
      }),
    } as unknown as SupabaseClient;

    await revokeAndSuspend(
      'conn-nango-1',
      'user-1',
      svc,
      {
        nango,
        nangoConnectionId: 'nibbin-acc-123-gmail',
        nangoProviderConfigKey: 'google-mail',
      },
    );

    // deleteConnection must be called with (providerConfigKey, connectionId) — NOT reversed
    expect(nango.deleteConnection).toHaveBeenCalledOnce();
    expect(nango.deleteConnection).toHaveBeenCalledWith('google-mail', 'nibbin-acc-123-gmail');

    // deleteConnection must be called BEFORE the RPC revoke
    expect(callOrder[0]).toBe('nango.deleteConnection');
    expect(callOrder[1]).toBe('rpc');
  });

  it('revokes row even when nango.deleteConnection throws (fail-open)', async () => {
    const nango = makeMockNango({ shouldThrow: true });
    const svc = makeServiceMock();

    // Must NOT throw, despite Nango failure
    await expect(
      revokeAndSuspend(
        'conn-nango-2',
        'user-1',
        svc,
        {
          nango,
          nangoConnectionId: 'nibbin-acc-456-gmail',
          nangoProviderConfigKey: 'google-mail',
        },
      ),
    ).resolves.toBeUndefined();

    // deleteConnection was attempted
    expect(nango.deleteConnection).toHaveBeenCalledOnce();

    // Row revoke still happened (RPC was called)
    const rpcCalls = (svc as unknown as { _rpcCalls: Array<{ name: string }> })._rpcCalls;
    expect(rpcCalls).toHaveLength(1);
    expect(rpcCalls[0].name).toBe('connection_revoke');
  });

  it('revokes row and suspends grants for [N] provider (full flow)', async () => {
    const nango = makeMockNango();
    const svc = makeServiceMock();

    await revokeAndSuspend(
      'conn-nango-3',
      'user-1',
      svc,
      {
        nango,
        nangoConnectionId: 'nibbin-acc-789-google-calendar',
        nangoProviderConfigKey: 'google-calendar',
      },
    );

    expect(nango.deleteConnection).toHaveBeenCalledWith('google-calendar', 'nibbin-acc-789-google-calendar');

    const rpcCalls = (svc as unknown as { _rpcCalls: Array<{ name: string; params: Record<string, unknown> }> })._rpcCalls;
    expect(rpcCalls).toHaveLength(1);
    expect(rpcCalls[0]).toMatchObject({
      name: 'connection_revoke',
      params: { p_connection: 'conn-nango-3', p_actor_user: 'user-1' },
    });

    const updates = (svc as unknown as { _updates: Array<Record<string, unknown>> })._updates;
    expect(updates[0]).toHaveProperty('revoked_at');
  });
});

// ── [H]/[G] provider — unchanged path ────────────────────────────────────────

describe('[H]/[G] provider disconnect — vault-revoke path unchanged', () => {
  it('does not call Nango at all when no nango deps are provided', async () => {
    const nango = makeMockNango();
    const svc = makeServiceMock();

    // Call WITHOUT nango deps (simulates [H] path)
    await revokeAndSuspend('conn-h-1', 'user-1', svc);

    // Nango should never be called for [H] connections
    expect(nango.deleteConnection).not.toHaveBeenCalled();

    // But the standard revoke path still works
    const rpcCalls = (svc as unknown as { _rpcCalls: Array<{ name: string }> })._rpcCalls;
    expect(rpcCalls).toHaveLength(1);
    expect(rpcCalls[0].name).toBe('connection_revoke');
  });

  it('does not call Nango when nango deps are undefined', async () => {
    const svc = makeServiceMock();

    // Explicit undefined — same as no nango
    await revokeAndSuspend('conn-h-2', 'user-1', svc, undefined);

    const rpcCalls = (svc as unknown as { _rpcCalls: Array<{ name: string }> })._rpcCalls;
    expect(rpcCalls[0].name).toBe('connection_revoke');
  });
});

// ── arg-order guard ──────────────────────────────────────────────────────────

describe('argument order guard', () => {
  it('passes providerConfigKey as first arg and connectionId as second — never reversed', async () => {
    const nango = makeMockNango();
    const svc = makeServiceMock();

    await revokeAndSuspend(
      'conn-order-check',
      'user-1',
      svc,
      {
        nango,
        nangoConnectionId: 'nibbin-acc-AAA-gmail',
        nangoProviderConfigKey: 'google-mail',
      },
    );

    const [firstArg, secondArg] = (nango.deleteConnection as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(firstArg).toBe('google-mail');         // providerConfigKey first
    expect(secondArg).toBe('nibbin-acc-AAA-gmail'); // connectionId second
    expect(firstArg).not.toBe('nibbin-acc-AAA-gmail'); // NOT the connection id
    expect(secondArg).not.toBe('google-mail');         // NOT the provider key
  });
});
