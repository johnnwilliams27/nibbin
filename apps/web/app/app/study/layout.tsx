import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import type { ReactNode } from 'react';
import { appSession } from '../../../lib/auth/app-session';
import { AppShell } from '../../../components/shell/AppShell';
import { StudySubNav } from '../../../components/study/StudySubNav';

export const metadata: Metadata = { title: 'Field Study — Nibbin' };
export const dynamic = 'force-dynamic';

export default async function StudyLayout({ children }: { children: ReactNode }) {
  let email: string | null = null;
  try {
    const { user } = await appSession();
    email = user.email ?? null;
  } catch {
    redirect('/login');
  }

  return (
    <AppShell active="study" title="Field Study" email={email}>
      <StudySubNav />
      {children}
    </AppShell>
  );
}
