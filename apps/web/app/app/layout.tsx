/**
 * /app layout — mounts the KeeperDock ONCE so it persists across ALL /app/*
 * pages. App Router layouts are never remounted during same-segment navigation,
 * so KeeperChat's React state (the message log) survives route changes.
 *
 * Only renders the dock when onboarding is done (grove.step === 'done'):
 *   • During onboarding the grove page shows the focal OnboardingCanvas — a
 *     second Keeper rendered here would create a double-keeper.
 *   • All other /app/* pages only render when the account is past onboarding,
 *     so suppressing the dock during onboarding is safe everywhere.
 *
 * Double-fetch note: the grove home page (apps/web/app/app/page.tsx) also
 * calls loadGroveState to build the dashboard. This layout adds a second call
 * on that specific route. The three sub-queries inside loadGroveState hit
 * grove_state, users, and credit_balances — all lightweight indexed reads.
 * The overhead is acceptable; the layout fetch is independent and runs in
 * parallel with the page's own data load thanks to React's streaming model.
 * A shared cache (Next 15 fetch deduplication) does NOT apply to Supabase
 * client calls, so the double-read is real but negligible at this scale.
 *
 * Auth note: appSession() throws when the user is not signed in. Pages inside
 * /app already redirect unauthenticated users (middleware + page-level guard),
 * so reaching this layout unauthenticated is not an expected path. We let the
 * throw propagate; the nearest error boundary (Next's default) will handle it.
 */

import type { ReactNode } from 'react';
import { appSession } from '../../lib/auth/app-session';
import { loadGroveState } from '../../lib/grove/load';
import { KeeperDock } from './grove/KeeperDock';
import type { Celebration } from './grove/KeeperChat';

export const dynamic = 'force-dynamic';

export default async function AppLayout({ children }: { children: ReactNode }) {
  let dock: ReactNode = null;

  try {
    const { supabase, user, accountId } = await appSession();

    const [groveLoad, { count: activeConnectionCount }, { data: promoNotifData }] =
      await Promise.all([
        loadGroveState(supabase, accountId, user.id),
        supabase
          .from('connections')
          .select('id', { count: 'exact', head: true })
          .eq('account_id', accountId)
          .eq('status', 'active'),
        supabase
          .from('notifications')
          .select('id, kind, title, body, payload, created_at')
          .eq('account_id', accountId)
          .in('kind', ['evolution', 'graduation', 'demotion'])
          .gte(
            'created_at',
            new Date(Date.now() - 14 * 24 * 60 * 60 * 1000).toISOString(),
          )
          .order('created_at', { ascending: false })
          .limit(5),
      ]);

    const { state: grove, initialMessages, expression, credits } = groveLoad;
    const hasConnection = (activeConnectionCount ?? 0) > 0;

    const pendingCelebrations: Celebration[] = (
      (promoNotifData ?? []) as Array<{
        id: string;
        kind: string;
        title: string;
        body: string;
        payload: {
          species?: string;
          stage?: string;
          palette?: string | null;
          accessory?: string;
          marking?: string;
        } | null;
      }>
    )
      .filter(
        (r) =>
          r.payload?.species &&
          (r.kind === 'evolution' || r.kind === 'graduation' || r.kind === 'demotion'),
      )
      .map((r) => ({
        id: r.id,
        kind: r.kind as 'evolution' | 'graduation' | 'demotion',
        title: r.title,
        line: r.body,
        species: r.payload!.species as string,
        stage: r.payload!.stage as string,
        palette: (r.payload!.palette as string) ?? null,
        accessory: (r.payload!.accessory as string) ?? 'none',
        marking: (r.payload!.marking as string) ?? 'none',
      }));

    // Only render the dock when onboarding is complete.
    // During onboarding the grove page provides the focal Keeper itself.
    if (grove.step === 'done') {
      dock = (
        <KeeperDock
          initialMessages={initialMessages}
          initialExpression={expression}
          initialStep={grove.step}
          keeperName={grove.keeperName}
          credits={credits}
          initialProfile={grove.profile}
          hasConnection={hasConnection}
          pendingCelebrations={pendingCelebrations}
        />
      );
    }
  } catch {
    // Auth failure or unexpected DB error — render children without the dock.
    // The page-level auth guard will redirect/handle as appropriate.
    dock = null;
  }

  return (
    <>
      {children}
      {dock}
    </>
  );
}
