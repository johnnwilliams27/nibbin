/**
 * The notification leaf pile (§4.5 in-product surface). Every drip beat and
 * every earned evolution/graduation lands here as a leaf; reads run under
 * the user's own RLS session, mark-read goes through the
 * mark_notification_read RPC (the single client write path).
 */
import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { buildCreature, type Accessory, type Marking, type SpeciesName, type Stage } from '@nibbin/creatures';
import { createClient } from '../../../lib/supabase/server';
import { ensureAccount } from '../../../lib/auth/bootstrap';
import { upsertOwnProfile } from '../../../lib/auth/profile';
import { AppShell } from '../../../components/shell/AppShell';
import { EmptyState } from '../../../components/ui';
import { markRead } from './actions';
import styles from './notifications.module.css';

export const metadata: Metadata = { title: 'From the grove — Nibbin' };
export const dynamic = 'force-dynamic';

interface LeafRow {
  id: string;
  kind: 'beat' | 'evolution' | 'graduation' | 'nudge' | 'demotion';
  title: string;
  body: string;
  payload: {
    ctaPath?: string;
    ctaLabel?: string;
    species?: string;
    stage?: string;
    palette?: string | null;
    accessory?: string;
    marking?: string;
  } | null;
  created_at: string;
  read_at: string | null;
}

/** Thin FormData adapter: the archive's <form> posts the id; delegate to the
 *  shared markRead(id) server action (single mark-read path). */
async function markReadForm(formData: FormData): Promise<void> {
  'use server';
  await markRead(String(formData.get('id')));
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
    .select('id, kind, title, body, payload, created_at, read_at')
    .eq('account_id', accountId)
    .order('created_at', { ascending: false })
    .limit(50);
  const leaves = (data ?? []) as LeafRow[];

  return (
    <AppShell active="notifications" title="Leaves" email={user.email}>
      <div className={styles.shell}>
        <h1 className={styles.heading}>Your leaves</h1>
        {leaves.length === 0 ? (
          <EmptyState
            title="Your pile is empty"
            body="When your grove has something for you — a Field Note, a training session, someone close to graduating — a leaf lands here."
          />
        ) : (
          leaves.map((leaf) => (
            <article key={leaf.id} className={`${styles.leaf} ${leaf.read_at ? '' : styles.leafUnread}`}>
              <div className={styles.leafRow}>
                {leaf.payload?.species && (
                  <span
                    className={styles.leafCreature}
                    aria-hidden="true"
                    dangerouslySetInnerHTML={{
                      __html: buildCreature({
                        species: leaf.payload.species as SpeciesName,
                        stage: (leaf.payload.stage ?? 'student') as Stage,
                        color: leaf.payload.palette ?? undefined,
                        acc: (leaf.payload.accessory ?? 'none') as Accessory,
                        mark: (leaf.payload.marking ?? 'none') as Marking,
                        size: 60,
                      }),
                    }}
                  />
                )}
                <div className={styles.leafText}>
                  <h2 className={styles.leafTitle}>{leaf.title}</h2>
                  <p className={styles.leafBody}>{leaf.body}</p>
                  {leaf.payload?.ctaPath && leaf.payload?.ctaLabel && (
                    <a className={styles.leafCta} href={leaf.payload.ctaPath}>
                      {leaf.payload.ctaLabel}
                    </a>
                  )}
                </div>
              </div>
              {leaf.read_at ? (
                <span className={styles.leafMeta}>Read</span>
              ) : (
                <form action={markReadForm}>
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
    </AppShell>
  );
}
