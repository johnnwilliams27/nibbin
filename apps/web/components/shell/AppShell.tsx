'use client';

import Link from 'next/link';
import { useState, type ReactNode } from 'react';
import styles from './shell.module.css';

export type NavKey = 'grove' | 'diagnosis' | 'memory' | 'shop' | 'notifications' | 'billing' | 'settings';

const NAV: { key: NavKey; label: string; href: string }[] = [
  { key: 'grove', label: 'Grove', href: '/app/grove' },
  { key: 'diagnosis', label: 'Diagnosis', href: '/app/diagnosis' },
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
  /** Optional right-rail panel. Desktop: fixed ~380px column. Mobile: toggleable bottom sheet. */
  panel?: ReactNode;
  /**
   * Onboarding mode: renders full shell chrome (brand + topbar + Sign out) but
   * nav items are non-interactive and de-emphasized — visible finish-line
   * affordance without allowing navigation during required onboarding steps.
   */
  onboarding?: boolean;
}

/**
 * Persistent authenticated shell: fixed sidebar + sticky topbar, with a mobile
 * hamburger overlay. Pages stay server components and pass their content as
 * children. The grove ceremony renders without this shell by design.
 *
 * When `panel` is provided a right-rail aside is rendered. On desktop it forms
 * a two-column layout (content | panel). On mobile it slides up as a bottom
 * sheet triggered by a floating toggle button.
 */
export function AppShell({ active, title, email, children, panel, onboarding }: AppShellProps) {
  const [open, setOpen] = useState(false);
  const [panelOpen, setPanelOpen] = useState(false);
  const close = () => setOpen(false);

  return (
    <div className={styles.shell}>
      {open && <div className={styles.backdrop} onClick={close} aria-hidden="true" />}
      {panel && panelOpen && (
        <div className={styles.backdrop} onClick={() => setPanelOpen(false)} aria-hidden="true" />
      )}

      <aside className={`${styles.sidebar} ${open ? styles.sidebarOpen : ''}`}>
        <Link href="/app" className={styles.brand} onClick={close}>
          Nibbin
        </Link>
        <nav className={styles.nav}>
          {NAV.map((item) =>
            onboarding ? (
              /* Onboarding mode: nav is visible but quiet and locked.
                 Rendered as <span> (not <Link>) so it cannot be navigated to. */
              <span
                key={item.key}
                className={`${styles.navItem} ${styles.navItemQuiet}`}
                aria-disabled="true"
                tabIndex={-1}
              >
                {item.label}
              </span>
            ) : (
              <Link
                key={item.key}
                href={item.href}
                onClick={close}
                className={`${styles.navItem} ${item.key === active ? styles.navItemActive : ''}`}
                aria-current={item.key === active ? 'page' : undefined}
              >
                {item.label}
              </Link>
            ),
          )}
        </nav>
      </aside>

      <div className={`${styles.main} ${panel ? styles.mainWithPanel : ''}`}>
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

        <div className={styles.mainBody}>
          <main className={styles.content}>{children}</main>

          {panel && (
            <aside
              className={`${styles.panel} ${panelOpen ? styles.panelOpen : ''}`}
              aria-label="Keeper panel"
            >
              {panel}
            </aside>
          )}
        </div>
      </div>

      {panel && (
        <button
          className={styles.panelToggle}
          type="button"
          aria-label={panelOpen ? 'Close Keeper' : 'Open Keeper'}
          aria-expanded={panelOpen}
          onClick={() => setPanelOpen((v) => !v)}
        >
          {panelOpen ? '✕' : '🌱'}
        </button>
      )}
    </div>
  );
}
