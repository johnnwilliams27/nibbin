'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import type { ReactNode } from 'react';
import styles from '../settings/settings.module.css';

type StudyTab = 'progress' | 'review' | 'notes' | 'preferences';

const TABS: { key: StudyTab; label: string; href: string }[] = [
  { key: 'progress', label: 'In progress', href: '/app/study' },
  { key: 'review', label: 'Review', href: '/app/study/review' },
  { key: 'notes', label: 'Field notes', href: '/app/study/notes' },
  { key: 'preferences', label: 'Preferences', href: '/app/study/preferences' },
];

function TabIcon({ k }: { k: StudyTab }) {
  const paths: Record<StudyTab, ReactNode> = {
    progress: (
      <>
        <path d="M2 12s3-7 10-7 10 7 10 7-3 7-10 7-10-7-10-7Z" />
        <circle cx="12" cy="12" r="3" />
      </>
    ),
    review: (
      <>
        <path d="M9 11l3 3L22 4" />
        <path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11" />
      </>
    ),
    notes: (
      <>
        <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
        <path d="M14 2v6h6" />
        <path d="M16 13H8" />
        <path d="M16 17H8" />
        <path d="M10 9H8" />
      </>
    ),
    preferences: (
      <>
        <path d="M20 7h-9" />
        <path d="M14 17H5" />
        <circle cx="17" cy="17" r="3" />
        <circle cx="7" cy="7" r="3" />
      </>
    ),
  };
  return (
    <svg
      className={styles.tabIcon}
      viewBox="0 0 24 24"
      width="16"
      height="16"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.8}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {paths[k]}
    </svg>
  );
}

export function StudySubNav() {
  const pathname = usePathname();

  function activeKey(): StudyTab {
    if (pathname === '/app/study') return 'progress';
    if (pathname.startsWith('/app/study/review')) return 'review';
    if (pathname.startsWith('/app/study/notes')) return 'notes';
    if (pathname.startsWith('/app/study/preferences')) return 'preferences';
    return 'progress';
  }
  const active = activeKey();

  return (
    <nav className={styles.tabs}>
      {TABS.map((tab) => (
        <Link
          key={tab.key}
          href={tab.href}
          className={`${styles.tab} ${tab.key === active ? styles.tabActive : ''}`}
          aria-current={tab.key === active ? 'page' : undefined}
        >
          <TabIcon k={tab.key} />
          {tab.label}
        </Link>
      ))}
    </nav>
  );
}
