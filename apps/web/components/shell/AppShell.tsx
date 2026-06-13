'use client';

import Link from 'next/link';
import { useState, type ReactNode } from 'react';
import styles from './shell.module.css';

export type NavKey = 'grove' | 'memory' | 'shop' | 'notifications' | 'billing' | 'settings';

const NAV: { key: NavKey; label: string; href: string }[] = [
  { key: 'grove', label: 'Grove', href: '/app/grove' },
  { key: 'memory', label: 'Memory', href: '/app/memory' },
  { key: 'shop', label: 'Agent Shop', href: '/app/shop' },
  { key: 'notifications', label: 'Leaves', href: '/app/notifications' },
  { key: 'billing', label: 'Plan & credits', href: '/billing' },
  { key: 'settings', label: 'Settings', href: '/app/settings/profile' },
];

export interface AppShellProps {
  active?: NavKey;
  title: string;
  email?: string | null;
  children: ReactNode;
}

/**
 * Persistent authenticated shell: fixed sidebar + sticky topbar, with a mobile
 * hamburger overlay. Pages stay server components and pass their content as
 * children. The grove ceremony renders without this shell by design.
 */
export function AppShell({ active, title, email, children }: AppShellProps) {
  const [open, setOpen] = useState(false);
  const close = () => setOpen(false);

  return (
    <div className={styles.shell}>
      {open && <div className={styles.backdrop} onClick={close} aria-hidden="true" />}

      <aside className={`${styles.sidebar} ${open ? styles.sidebarOpen : ''}`}>
        <Link href="/app" className={styles.brand} onClick={close}>
          Nibbin
        </Link>
        <nav className={styles.nav}>
          {NAV.map((item) => (
            <Link
              key={item.key}
              href={item.href}
              onClick={close}
              className={`${styles.navItem} ${item.key === active ? styles.navItemActive : ''}`}
              aria-current={item.key === active ? 'page' : undefined}
            >
              {item.label}
            </Link>
          ))}
        </nav>
      </aside>

      <div className={styles.main}>
        <header className={styles.topbar}>
          <button
            className={styles.hamburger}
            type="button"
            aria-label={open ? 'Close menu' : 'Open menu'}
            aria-expanded={open}
            onClick={() => setOpen((v) => !v)}
          >
            ☰
          </button>
          <h1 className={styles.title}>{title}</h1>
          <div className={styles.account}>
            {email ? <span className={styles.email}>{email}</span> : null}
            <form action="/auth/signout" method="post">
              <button className={styles.signout} type="submit">
                Sign out
              </button>
            </form>
          </div>
        </header>

        <main className={styles.content}>{children}</main>
      </div>
    </div>
  );
}
