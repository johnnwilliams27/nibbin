import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { appSession } from '../../../lib/auth/app-session';
import { AppShell } from '../../../components/shell/AppShell';
import { BuildChooser } from './BuildChooser';
import styles from './build.module.css';

export const metadata: Metadata = { title: 'Agent Builder — Nibbin' };

// Per-request session read — never statically cached.
export const dynamic = 'force-dynamic';

export default async function BuildPage() {
  let session;
  try {
    session = await appSession();
  } catch {
    redirect('/login');
  }
  const { user } = session;

  return (
    <AppShell active="build" title="Agent Builder" email={user.email}>
      <div className={styles.inner}>
        <header className={styles.header}>
          <h1 className={styles.title}>What would you like done?</h1>
          <p className={styles.lede}>
            Describe the task, then choose whether a Nibbin should{' '}
            <strong>do it once</strong> or <strong>handle it for you regularly</strong>. Same
            description either way — you pick the mode.
          </p>
        </header>
        <BuildChooser />
      </div>
    </AppShell>
  );
}
