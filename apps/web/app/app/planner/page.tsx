import type { Metadata } from 'next';
import { appSession } from '../../../lib/auth/app-session';
import { AppShell } from '../../../components/shell/AppShell';
import { PlanComposer } from './PlanComposer';
import styles from './planner.module.css';

export const metadata: Metadata = { title: 'Ask a Nibbin — Nibbin' };
export const dynamic = 'force-dynamic';
// The planner Server Actions (startPlanRun / respondToPlanRun in ./actions.ts) run
// the ReAct loop INLINE in the request. A computer_use plan can launch serverless
// Chromium (@sparticuz) and its loop wall-clock ceiling is 50s
// (COMPUTER_USE_CEILINGS.maxWallClockMs). 60s is the Vercel HOBBY hard cap, so we
// pin here to deploy/run on ANY plan; the 50s loop ceiling leaves headroom for the
// (~2–5s) Chromium cold-start + teardown under this 60s function limit. On a Pro+
// plan raise this to 120/300 AND bump COMPUTER_USE_CEILINGS.maxWallClockMs together
// for richer runs. Server Actions inherit the hosting route segment's maxDuration,
// so it is set here (the page that renders the action-bearing components).
export const maxDuration = 60;

export default async function PlannerPage() {
  const { user } = await appSession();
  return (
    <AppShell title="Ask a Nibbin" email={user.email}>
      <div className={styles.header}>
        <p className={styles.eyebrow}>Planner</p>
        <h1 className={styles.title}>Ask a Nibbin to look into something</h1>
        <p className={styles.sub}>
          Describe what you'd like handled. A Nibbin will lay out a small plan first — you'll see exactly what it
          can use before anything runs, and nothing sends or leaves without your okay.
        </p>
      </div>
      <PlanComposer />
    </AppShell>
  );
}
