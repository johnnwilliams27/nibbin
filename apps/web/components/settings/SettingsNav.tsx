import Link from 'next/link';
import type { ReactNode } from 'react';
import styles from './settings.module.css';

export type SettingsTab = 'profile' | 'security' | 'privacy' | 'account' | 'billing';

const TABS: { key: SettingsTab; label: string; href: string }[] = [
  { key: 'profile', label: 'Profile', href: '/app/settings/profile' },
  { key: 'security', label: 'Security', href: '/app/settings/security' },
  { key: 'privacy', label: 'Data & Privacy', href: '/app/settings/privacy' },
  { key: 'account', label: 'Account', href: '/app/settings/account' },
  { key: 'billing', label: 'Plan & credits', href: '/billing' },
];

/** Minimal line icons (Lucide-style) per settings tab — inherit currentColor. */
function TabIcon({ k }: { k: SettingsTab }) {
  const paths: Record<SettingsTab, ReactNode> = {
    profile: (
      <>
        <path d="M19 21v-2a4 4 0 0 0-4-4H9a4 4 0 0 0-4 4v2" />
        <circle cx="12" cy="7" r="4" />
      </>
    ),
    security: (
      <>
        <rect width="18" height="11" x="3" y="11" rx="2" />
        <path d="M7 11V7a5 5 0 0 1 10 0v4" />
      </>
    ),
    privacy: (
      <>
        <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10Z" />
        <path d="m9 12 2 2 4-4" />
      </>
    ),
    account: (
      <>
        <circle cx="12" cy="12" r="10" />
        <circle cx="12" cy="10" r="3" />
        <path d="M7 20.66a8 8 0 0 1 10 0" />
      </>
    ),
    billing: (
      <>
        <rect width="20" height="14" x="2" y="5" rx="2" />
        <path d="M2 10h20" />
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

/** Sub-navigation for the settings hub. Billing links out to the existing page. */
export function SettingsNav({ active }: { active: SettingsTab }) {
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
