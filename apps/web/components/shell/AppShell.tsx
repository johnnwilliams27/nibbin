'use client';

import Link from 'next/link';
import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { buildCreature } from '@nibbin/creatures';
import { NotificationBell } from './NotificationBell';
import { HelpButton } from './HelpButton';
import styles from './shell.module.css';

/** The Grovekeeper creature as a small inline glyph (mount-gated — the engine
 *  mints unique gradient ids per render, so SSR + hydration can't match). */
function KeeperGlyph({ size }: { size: number }) {
  const svg = useMemo(() => buildCreature({ species: 'Keeper', size }), [size]);
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  if (!mounted) return null;
  return <span className={styles.keeperGlyph} aria-hidden="true" dangerouslySetInnerHTML={{ __html: svg }} />;
}

export type NavKey =
  | 'grove'
  | 'nibbins'
  | 'connections'
  | 'hatch'
  | 'diagnosis'
  | 'memory'
  | 'shop'
  | 'notifications'
  | 'billing'
  | 'settings'
  | 'help';

/** Minimal line icons (Lucide-style) per nav item — inherit currentColor so they
 *  pick up the active/hover tint from `.navItem`. */
function NavIcon({ k }: { k: NavKey }) {
  const paths: Record<NavKey, ReactNode> = {
    connections: (
      <>
        <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71" />
        <path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71" />
      </>
    ),
    grove: (
      <>
        <path d="M7 20h10" />
        <path d="M10 20c5.5-2.5.8-6.4 3-10" />
        <path d="M9.5 9.4c1.1.8 1.8 2.2 2.3 3.7-2 .4-3.5.4-4.8-.3-1.2-.6-2.3-1.9-3-4.2 2.8-.5 4.4 0 5.5.8z" />
        <path d="M14.1 6a7 7 0 0 0-1.1 4c1.9-.1 3.3-.6 4.3-1.4 1-1 1.6-2.3 1.7-4.6-2.7.1-4 1-4.9 2z" />
      </>
    ),
    nibbins: (
      <>
        <circle cx="9" cy="7" r="4" />
        <path d="M3 21v-2a4 4 0 0 1 4-4h4a4 4 0 0 1 4 4v2" />
        <path d="M16 3.13a4 4 0 0 1 0 7.75" />
        <path d="M21 21v-2a4 4 0 0 0-3-3.87" />
      </>
    ),
    // an egg with a crack — "hatch your own"
    hatch: (
      <>
        <path d="M12 3c3.3 0 6 4 6 8a6 6 0 0 1-12 0c0-4 2.7-8 6-8Z" />
        <path d="m10.5 10 1.5 1.5-1 1.5 1.5 1" />
      </>
    ),
    diagnosis: <path d="M22 12h-4l-3 9L9 3l-3 9H2" />,
    memory: (
      <>
        <path d="M12 7v14" />
        <path d="M3 18a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1h5a4 4 0 0 1 4 4 4 4 0 0 1 4-4h5a1 1 0 0 1 1 1v13a1 1 0 0 1-1 1h-6a3 3 0 0 0-3 3 3 3 0 0 0-3-3z" />
      </>
    ),
    shop: (
      <>
        <path d="M6 2 3 6v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V6l-3-4z" />
        <path d="M3 6h18" />
        <path d="M16 10a4 4 0 0 1-8 0" />
      </>
    ),
    notifications: (
      <>
        <path d="M11 20A7 7 0 0 1 9.8 6.1C15.5 5 17 4.48 19 2c1 2 2 4.18 2 8 0 5.5-4.78 10-10 10Z" />
        <path d="M2 21c0-3 1.85-5.36 5.08-6" />
      </>
    ),
    billing: (
      <>
        <rect width="20" height="14" x="2" y="5" rx="2" />
        <path d="M2 10h20" />
      </>
    ),
    settings: (
      <>
        <path d="M20 7h-9" />
        <path d="M14 17H5" />
        <circle cx="17" cy="17" r="3" />
        <circle cx="7" cy="7" r="3" />
      </>
    ),
    help: (
      <>
        <circle cx="12" cy="12" r="10" />
        <path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3" />
        <path d="M12 17h.01" />
      </>
    ),
  };
  return (
    <svg
      className={styles.navIcon}
      viewBox="0 0 24 24"
      width="18"
      height="18"
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

const NAV: { key: NavKey; label: string; href: string }[] = [
  // Grove Home (/app) is the hub — the Keeper rides along as the docked panel, so
  // there's no separate full-screen grove route to navigate to.
  { key: 'grove', label: 'Grove Home', href: '/app' },
  { key: 'nibbins', label: 'Your Nibbins', href: '/app/nibbins' },
  { key: 'connections', label: 'Connections', href: '/app/connections' },
  { key: 'hatch', label: 'Hatch your own', href: '/app/hatch' },
  { key: 'diagnosis', label: 'Diagnosis', href: '/app/diagnosis' },
  { key: 'memory', label: 'Memory', href: '/app/memory' },
  { key: 'shop', label: 'Agent Shop', href: '/app/shop' },
  { key: 'billing', label: 'Plan & credits', href: '/billing' },
  { key: 'settings', label: 'Settings', href: '/app/settings/profile' },
  { key: 'help', label: 'Help & Getting Started', href: '/app/help' },
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
  const [panelCollapsed, setPanelCollapsed] = useState(false);
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
                <NavIcon k={item.key} />
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
                <NavIcon k={item.key} />
                {item.label}
              </Link>
            ),
          )}
        </nav>
      </aside>

      <div className={`${styles.main} ${panel ? styles.mainWithPanel : ''} ${onboarding ? styles.mainOnboarding : ''}`}>
        <header className={styles.topbar}>
          <button
            className={styles.hamburger}
            type="button"
            aria-label={open ? 'Close menu' : 'Open menu'}
            aria-expanded={open}
            onClick={() => setOpen((v) => !v)}
          >
            {open ? '✕' : '☰'}
          </button>
          <h1 className={styles.title}>{title}</h1>
          <div className={styles.account}>
            {!onboarding && <HelpButton />}
            {!onboarding && <NotificationBell />}
            {email ? <span className={styles.email}>{email}</span> : null}
            <form action="/auth/signout" method="post">
              <button className={styles.signout} type="submit">
                Sign out
              </button>
            </form>
          </div>
        </header>

        <div className={styles.mainBody}>
          <main className={`${styles.content} ${onboarding ? styles.contentFocal : ''}`}>{children}</main>

          {panel && (
            <aside
              className={`${styles.panel} ${panelOpen ? styles.panelOpen : ''} ${
                panelCollapsed ? styles.panelCollapsed : ''
              }`}
              aria-label="Keeper panel"
            >
              <button
                className={styles.panelCollapse}
                type="button"
                aria-label="Collapse Keeper panel"
                onClick={() => setPanelCollapsed(true)}
              >
                ›
              </button>
              {panel}
            </aside>
          )}
        </div>
      </div>

      {/* Desktop: reopen tab on the right edge when collapsed. */}
      {panel && panelCollapsed && (
        <button
          className={styles.panelExpand}
          type="button"
          aria-label="Open Keeper panel"
          onClick={() => setPanelCollapsed(false)}
        >
          <KeeperGlyph size={26} />
        </button>
      )}

      {/* Mobile: floating toggle for the bottom-sheet. */}
      {panel && (
        <button
          className={styles.panelToggle}
          type="button"
          aria-label={panelOpen ? 'Close Keeper' : 'Open Keeper'}
          aria-expanded={panelOpen}
          onClick={() => setPanelOpen((v) => !v)}
        >
          {panelOpen ? '✕' : <KeeperGlyph size={30} />}
        </button>
      )}
    </div>
  );
}
