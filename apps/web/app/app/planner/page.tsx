import type { Metadata } from 'next';
import { appSession } from '../../../lib/auth/app-session';
import { AppShell } from '../../../components/shell/AppShell';
import { PlanComposer } from './PlanComposer';
import styles from './planner.module.css';

export const metadata: Metadata = { title: 'Ask a Nibbin — Nibbin' };
export const dynamic = 'force-dynamic';

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
