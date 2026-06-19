import type { SupabaseClient } from '@supabase/supabase-js';

export interface ChecklistStep {
  id: string;
  label: string;
  done: boolean;
  href: string;
  detail: string;
  auto: boolean;
}

export interface ChecklistState {
  steps: ChecklistStep[];
  completed: number;
  total: number;
}

function buildSteps(
  diagDone: boolean,
  connDone: boolean,
  adoptDone: boolean,
  installDone: boolean,
): ChecklistStep[] {
  return [
    {
      id: 'account',
      label: 'Create your account',
      done: true,
      href: '/app',
      detail: "You're in — welcome.",
      auto: true,
    },
    {
      id: 'install',
      label: 'Install the desktop app & run a Field Study',
      done: installDone,
      href: '/app/diagnosis',
      detail: 'Download Nibbin and let it watch a little of your work.',
      auto: false,
    },
    {
      id: 'diagnosis',
      label: 'Review your diagnosis',
      done: diagDone,
      href: '/app/diagnosis',
      detail: 'See the busywork Nibbin found.',
      auto: true,
    },
    {
      id: 'connection',
      label: 'Connect a tool',
      done: connDone,
      href: '/app/connections',
      detail: 'Link Gmail (or request access) so agents can help.',
      auto: true,
    },
    {
      id: 'adopt',
      label: 'Adopt your first nibbin',
      done: adoptDone,
      href: '/app/shop',
      detail: 'Hatch an agent and approve its first drafts.',
      auto: true,
    },
  ];
}

export async function getChecklistState(
  supabase: SupabaseClient,
  accountId: string,
): Promise<ChecklistState> {
  const eqAcct = (table: string, sel = '*') =>
    supabase.from(table).select(sel).eq('account_id', accountId);

  try {
    const [diag, conns, nibs, handoff] = await Promise.all([
      eqAcct('diagnoses', 'map').limit(1),
      eqAcct('connections', 'status').eq('status', 'active').limit(1),
      eqAcct('nibbins', 'kind,status').eq('kind', 'specialist').eq('status', 'active').limit(1),
      eqAcct('onboarding_handoff', 'status').eq('status', 'claimed').limit(1),
    ]);

    const diagDone = !!((diag.data as Array<{ map?: { workflows?: unknown[] } }>) || []).find(
      (d) => (d?.map?.workflows?.length ?? 0) > 0,
    );
    const connDone = ((conns.data as unknown[]) || []).length > 0;
    const adoptDone = ((nibs.data as unknown[]) || []).length > 0;
    const installDone = diagDone || ((handoff.data as unknown[]) || []).length > 0;

    const steps = buildSteps(diagDone, connDone, adoptDone, installDone);
    const completed = steps.filter((s) => s.done).length;
    return { steps, completed, total: steps.length };
  } catch {
    // Degrade gracefully on network-level Supabase failure: only account step is done.
    const steps = buildSteps(false, false, false, false);
    return { steps, completed: 1, total: steps.length };
  }
}
