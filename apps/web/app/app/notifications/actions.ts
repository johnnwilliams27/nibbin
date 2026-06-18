'use server';

import { revalidatePath } from 'next/cache';
import { createClient } from '../../../lib/supabase/server';
import { ensureAccount } from '../../../lib/auth/bootstrap';
import { upsertOwnProfile } from '../../../lib/auth/profile';

export interface Leaf {
  id: string;
  kind: 'beat' | 'evolution' | 'graduation';
  title: string;
  body: string;
  ctaPath: string | null;
  ctaLabel: string | null;
  createdAt: string;
  read: boolean;
  creature: { species: string; stage: string; palette: string | null; accessory: string; marking: string } | null;
}

async function resolve() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return null;
  const accountId = await ensureAccount({
    getEmail: async () => user.email ?? null,
    ensureProfile: () => upsertOwnProfile(supabase, user),
    bootstrap: async (name) => {
      const { data, error } = await supabase.rpc('bootstrap_account', { account_name: name });
      if (error) throw error;
      return data as string;
    },
  });
  return { supabase, accountId };
}

/** Recent leaves + unread count for the bell. RLS-scoped to the caller. */
export async function listLeaves(limit = 12): Promise<{ items: Leaf[]; unread: number }> {
  const ctx = await resolve();
  if (!ctx) return { items: [], unread: 0 };
  const { supabase, accountId } = ctx;
  const { data } = await supabase
    .from('notifications')
    .select('id, kind, title, body, payload, created_at, read_at')
    .eq('account_id', accountId)
    .order('created_at', { ascending: false })
    .limit(limit);
  const rows = (data ?? []) as Array<{
    id: string; kind: Leaf['kind']; title: string; body: string;
    payload: {
      ctaPath?: string; ctaLabel?: string;
      species?: string; stage?: string; palette?: string | null; accessory?: string; marking?: string;
    } | null;
    created_at: string; read_at: string | null;
  }>;
  const items: Leaf[] = rows.map((r) => ({
    id: r.id, kind: r.kind, title: r.title, body: r.body,
    ctaPath: r.payload?.ctaPath ?? null, ctaLabel: r.payload?.ctaLabel ?? null,
    createdAt: r.created_at, read: r.read_at != null,
    creature: r.payload?.species
      ? {
          species: r.payload.species as string,
          stage: r.payload.stage as string,
          palette: (r.payload.palette as string) ?? null,
          accessory: (r.payload.accessory as string) ?? 'none',
          marking: (r.payload.marking as string) ?? 'none',
        }
      : null,
  }));
  const { count } = await supabase
    .from('notifications')
    .select('id', { count: 'exact', head: true })
    .eq('account_id', accountId)
    .is('read_at', null);
  return { items, unread: count ?? 0 };
}

export async function markRead(id: string): Promise<void> {
  const ctx = await resolve();
  if (!ctx) return;
  await ctx.supabase.rpc('mark_notification_read', { target_id: id });
  revalidatePath('/app/notifications');
}

/** No bulk RPC exists (client writes are RLS-revoked); mark each unread leaf via
 *  the security-definer RPC. Bounded — the list is capped. */
export async function markAllRead(): Promise<void> {
  const ctx = await resolve();
  if (!ctx) return;
  const { supabase, accountId } = ctx;
  const { data } = await supabase
    .from('notifications')
    .select('id')
    .eq('account_id', accountId)
    .is('read_at', null)
    .limit(200);
  for (const row of (data ?? []) as Array<{ id: string }>) {
    await supabase.rpc('mark_notification_read', { target_id: row.id });
  }
  revalidatePath('/app/notifications');
}
