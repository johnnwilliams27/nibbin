import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { appSession } from '../../../lib/auth/app-session';
import { AppShell } from '../../../components/shell/AppShell';
import { HatchWizard } from './HatchWizard';
import { HATCH_APPS, HATCH_CHORES } from './options';
import styles from './hatch.module.css';

export const metadata: Metadata = { title: 'Hatch Your Own — Nibbin' };

// Per-request session read — never statically cached.
export const dynamic = 'force-dynamic';

export default async function HatchPage() {
  let session;
  try {
    session = await appSession();
  } catch {
    redirect('/login');
  }
  const { user } = session;

  return (
    <AppShell active="hatch" title="Hatch Your Own" email={user.email}>
      <div className={styles.inner}>
        <header className={styles.header}>
          <h1 className={styles.title}>Build a Nibbin for one chore</h1>
          <p className={styles.lede}>
            Name the thing you&rsquo;re tired of doing and where it happens — we hatch a custom-named
            egg. You set its action level (Observe, Draft, or Send); Agent School grades how well it
            does the work.
          </p>
        </header>
        <HatchWizard chores={[...HATCH_CHORES]} apps={[...HATCH_APPS]} />
      </div>
    </AppShell>
  );
}
