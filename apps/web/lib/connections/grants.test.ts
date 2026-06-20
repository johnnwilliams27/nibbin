import { expect, it } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import {
  createWriteGrant, grantWriteCapability, revokeWriteGrant,
  suspendGrantsForConnection, deriveCapabilityTier,
  type CreateWriteGrantInput, type WriteCapability,
} from './grants';
import { writeGrantSpecFor } from './callback-core';

// ── compile-time check ────────────────────────────────────────────────────────

it('CreateWriteGrantInput requires plainLanguageReason (compile-time check)', () => {
  const input: CreateWriteGrantInput = {
    accountId: 'a', nibbinId: 'n', connectionId: 'c',
    capability: 'email.draft',
    grantedBy: 'u',
    plainLanguageReason: 'Maya will create a Gmail draft for your review.',
  };
  expect(input.plainLanguageReason).toBeTruthy();
});

// ── createWriteGrant ──────────────────────────────────────────────────────────

it('createWriteGrant upserts a nibbin_write_grants row and does not throw on conflict', async () => {
  const upserted: Record<string, unknown>[] = [];
  const svc = {
    from: (table: string) => {
      expect(table).toBe('nibbin_write_grants');
      return {
        upsert: (row: Record<string, unknown>, opts: Record<string, unknown>) => {
          upserted.push(row);
          expect(opts).toMatchObject({ onConflict: 'nibbin_id,connection_id,capability' });
          return { error: null };
        },
      };
    },
  } as unknown as SupabaseClient;
  const input: CreateWriteGrantInput = {
    accountId: 'acc1', nibbinId: 'nib1', connectionId: 'con1',
    capability: 'email.draft', grantedBy: 'usr1',
    plainLanguageReason: 'Maya will create a Gmail draft for your review.',
  };
  await createWriteGrant(input, svc);
  expect(upserted).toHaveLength(1);
  expect(upserted[0]).toMatchObject({
    account_id: 'acc1', nibbin_id: 'nib1', connection_id: 'con1',
    capability: 'email.draft', granted_by: 'usr1',
    plain_language_reason: 'Maya will create a Gmail draft for your review.',
    revoked_at: null,
  });
});

it('createWriteGrant throws when the svc call errors', async () => {
  const svc = {
    from: () => ({
      upsert: () => ({ error: { message: 'db down' } }),
    }),
  } as unknown as SupabaseClient;
  await expect(
    createWriteGrant(
      { accountId: 'a', nibbinId: 'n', connectionId: 'c', capability: 'email.draft',
        grantedBy: 'u', plainLanguageReason: 'Maya will create a Gmail draft for your review.' },
      svc,
    ),
  ).rejects.toThrow('db down');
});

// ── grantWriteCapability ──────────────────────────────────────────────────────

it('grantWriteCapability delegates to createWriteGrant with correct params', async () => {
  const upserted: Record<string, unknown>[] = [];
  const svc = {
    from: () => ({
      upsert: (row: Record<string, unknown>) => { upserted.push(row); return { error: null }; },
    }),
  } as unknown as SupabaseClient;
  await grantWriteCapability('nib1', 'con1', 'acc1', 'usr1', 'email.draft', 'Maya will create a Gmail draft for your review.', svc);
  expect(upserted[0]).toMatchObject({ nibbin_id: 'nib1', connection_id: 'con1', capability: 'email.draft' });
});

// ── revokeWriteGrant ──────────────────────────────────────────────────────────

it('revokeWriteGrant sets revoked_at and scopes by nibbin + connection + capability', async () => {
  const updates: Record<string, unknown>[] = [];
  const svc = {
    from: () => ({
      update: (row: Record<string, unknown>) => {
        updates.push(row);
        return {
          eq: (_k: string, _v: string) => ({ eq: (_k2: string, _v2: string) => ({ eq: (_k3: string, _v3: string) => ({ is: () => ({ error: null }) }) }) }),
        };
      },
    }),
  } as unknown as SupabaseClient;
  await revokeWriteGrant('nib1', 'con1', 'email.draft', svc);
  expect(updates[0]).toHaveProperty('revoked_at');
});

// ── suspendGrantsForConnection ────────────────────────────────────────────────

it('suspendGrantsForConnection sets revoked_at on all active grants for a connection', async () => {
  const updates: Record<string, unknown>[] = [];
  const svc = {
    from: () => ({
      update: (row: Record<string, unknown>) => {
        updates.push(row);
        return { eq: () => ({ is: () => ({ error: null }) }) };
      },
    }),
  } as unknown as SupabaseClient;
  await suspendGrantsForConnection('con1', svc);
  expect(updates[0]).toHaveProperty('revoked_at');
});

// ── deriveCapabilityTier ──────────────────────────────────────────────────────

function makeSvcWithGrants(rows: { capability: string; revoked_at: string | null }[]) {
  return {
    from: () => ({
      select: () => ({
        eq: () => ({ eq: () => ({ is: () => ({ data: rows, error: null }) }) }),
      }),
    }),
  } as unknown as SupabaseClient;
}

it('deriveCapabilityTier → read_only when no active grants', async () => {
  const tier = await deriveCapabilityTier('n', 'c', 'student', makeSvcWithGrants([]));
  expect(tier).toBe('read_only');
});

it('deriveCapabilityTier → draft_only when only email.draft active', async () => {
  const tier = await deriveCapabilityTier('n', 'c', 'student',
    makeSvcWithGrants([{ capability: 'email.draft', revoked_at: null }]));
  expect(tier).toBe('draft_only');
});

it('deriveCapabilityTier → one_click_send when email.send active and not grad', async () => {
  const tier = await deriveCapabilityTier('n', 'c', 'senior',
    makeSvcWithGrants([
      { capability: 'email.draft', revoked_at: null },
      { capability: 'email.send', revoked_at: null },
    ]));
  expect(tier).toBe('one_click_send');
});

it('deriveCapabilityTier → autonomous_send when email.send active and stage = grad', async () => {
  const tier = await deriveCapabilityTier('n', 'c', 'grad',
    makeSvcWithGrants([
      { capability: 'email.draft', revoked_at: null },
      { capability: 'email.send', revoked_at: null },
    ]));
  expect(tier).toBe('autonomous_send');
});

it('deriveCapabilityTier ignores revoked rows', async () => {
  const tier = await deriveCapabilityTier('n', 'c', 'senior',
    makeSvcWithGrants([
      { capability: 'email.draft', revoked_at: null },
      { capability: 'email.send', revoked_at: '2026-06-17T00:00:00Z' },
    ]));
  expect(tier).toBe('draft_only');
});

// ── Calendar write (Connector Lever 1) ────────────────────────────────────────

it('deriveCapabilityTier → event_create when only calendar.event-create active', async () => {
  const tier = await deriveCapabilityTier('n', 'c', 'senior',
    makeSvcWithGrants([{ capability: 'calendar.event-create', revoked_at: null }]));
  expect(tier).toBe('event_create');
});

it('createWriteGrant can mint a calendar.event-create grant', async () => {
  const upserted: Record<string, unknown>[] = [];
  const svc = {
    from: () => ({ upsert: (row: Record<string, unknown>) => { upserted.push(row); return { error: null }; } }),
  } as unknown as SupabaseClient;
  const capability: WriteCapability = 'calendar.event-create';
  await createWriteGrant(
    { accountId: 'acc1', nibbinId: 'nib1', connectionId: 'cal1', capability, grantedBy: 'usr1',
      plainLanguageReason: 'Will create calendar events for your approval before anything is saved.' },
    svc,
  );
  expect(upserted[0]).toMatchObject({ capability: 'calendar.event-create', revoked_at: null });
});

it('writeGrantSpecFor mints a calendar.event-create spec with a plain-language reason', () => {
  const spec = writeGrantSpecFor('google-calendar');
  expect(spec).not.toBeNull();
  expect(spec!.capability).toBe('calendar.event-create');
  expect(spec!.reason.length).toBeGreaterThanOrEqual(12);
});

it('deriveCapabilityTier → event_create when BOTH email.draft and calendar.event-create active (calendar takes priority)', async () => {
  // Regression: the email-ladder branch must not swallow the calendar grant.
  const tier = await deriveCapabilityTier('n', 'c', 'senior',
    makeSvcWithGrants([
      { capability: 'email.draft', revoked_at: null },
      { capability: 'calendar.event-create', revoked_at: null },
    ]));
  expect(tier).toBe('event_create');
});
