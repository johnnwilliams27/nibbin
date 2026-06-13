import Link from 'next/link';
import styles from './settings.module.css';

export type SettingsTab = 'profile' | 'security' | 'connections' | 'billing';

const TABS: { key: SettingsTab; label: string; href: string }[] = [
  { key: 'profile', label: 'Profile', href: '/app/settings/profile' },
  { key: 'security', label: 'Security', href: '/app/settings/security' },
  { key: 'connections', label: 'Connections', href: '/app/settings/connections' },
  { key: 'billing', label: 'Plan & credits', href: '/billing' },
];

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
          {tab.label}
        </Link>
      ))}
    </nav>
  );
}
