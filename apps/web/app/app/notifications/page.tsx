/**
 * The notification leaf pile (§4.5 in-product surface). Every drip beat and
 * every earned evolution/graduation lands here as a leaf; reads run under
 * the user's own RLS session, mark-read goes through the
 * mark_notification_read RPC (the single client write path).
 */
import type { Metadata } from 'next';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import { createClient } from '../../../lib/supabase/server';
import { ensureAccount } from '../../../lib/auth/bootstrap';
import { upsertOwnProfile } from '../../../lib/auth/profile';
import styles from './notifications.module.css';

export const metadata: Metadata = { title: 'From the grove — Nibbin' };
export const dynamic = 'force-dynamic';

interface LeafRow {
  id: string;
  kind: 'beat' | 'evolution' | 'graduation';
  title: string;
  body: string;
  created_at: string;
  read_at: string | null;
}

async function markRead(formData: FormData): Promise<void> {
  'use server';
  const id = formData.get('id');
  if (typeof id !== 'string' || !id) return;
  const supabase = await createClient();
  await supabase.rpc('mark_notification_read', { target_id: id });
  revalidatePath('/app/notifications');
}

export default async function NotificationsPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect('/login');

  let accountId: string;
  try {
    accountId = await ensureAccount({
      getEmail: async () => user.email ?? null,
      ensureProfile: () => upsertOwnProfile(supabase, user),
      bootstrap: async (name) => {
        const { data, error } = await supabase.rpc('bootstrap_account', { account_name: name });
        if (error) throw error;
        return data as string;
      },
    });
  } catch {
    redirect('/app');
  }

  const { data } = await supabase
    .from('notifications')
    .select('id, kind, title, body, created_at, read_at')
    .eq('account_id', accountId)
    .order('created_at', { ascending: false })
    .limit(50);
  const leaves = (data ?? []) as LeafRow[];

  return (
    <main className={styles.page}>
      <div className={styles.shell}>
        <Link className={styles.back} href="/app">
          Back to your grove
        </Link>
        <p className={styles.eyebrow}>From the grove</p>
        <h1 className={styles.heading}>Your leaves</h1>
        {leaves.length === 0 ? (
          <div className={styles.empty}>
            Nothing here yet. When your grove has something for you — Field Notes, a training
            session, someone close to graduating — a leaf lands on this pile.
          </div>
        ) : (
          leaves.map((leaf) => (
            <article key={leaf.id} className={`${styles.leaf} ${leaf.read_at ? '' : styles.leafUnread}`}>
              <h2 className={styles.leafTitle}>{leaf.title}</h2>
              <p className={styles.leafBody}>{leaf.body}</p>
              {leaf.read_at ? (
                <span className={styles.leafMeta}>Read</span>
              ) : (
                <form action={markRead}>
                  <input type="hidden" name="id" value={leaf.id} />
                  <button className={styles.markRead} type="submit">
                    Mark read
                  </button>
                </form>
              )}
            </article>
          ))
        )}
      </div>
    </main>
  );
}
