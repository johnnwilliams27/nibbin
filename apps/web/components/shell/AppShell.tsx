'use client';

import Link from 'next/link';
import { useEffect, useState, type ReactNode } from 'react';
import { Grovekeeper } from '../grovekeeper/Grovekeeper';
import { NotificationBell } from './NotificationBell';
import { HelpButton } from './HelpButton';
import styles from './shell.module.css';

/** Inline sprout logomark from packages/shared/brand/nibbin-mark.svg.
 *  Rendered at 28×28px; IDs suffixed to avoid clashes on the same page. */
function BrandMark() {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 72 72"
      width="28"
      height="28"
      role="img"
      aria-label="nibbin"
    >
      <defs>
        <linearGradient id="nm2Stem" x1="0" y1="0.1" x2="1" y2="0.2">
          <stop offset="0%" stopColor="#6E9136" />
          <stop offset="52%" stopColor="#4C6E24" />
          <stop offset="100%" stopColor="#34471A" />
        </linearGradient>
        <linearGradient id="nm2LeafL" x1="0.05" y1="0.05" x2="0.7" y2="1">
          <stop offset="0%" stopColor="#7CA23E" />
          <stop offset="100%" stopColor="#46651F" />
        </linearGradient>
        <linearGradient id="nm2LeafR" x1="0.1" y1="0" x2="0.7" y2="1">
          <stop offset="0%" stopColor="#A6D45F" />
          <stop offset="100%" stopColor="#5E8A2C" />
        </linearGradient>
        <filter id="nm2Shadow" x="-40%" y="-40%" width="180%" height="180%">
          <feGaussianBlur stdDeviation="1.3" />
        </filter>
      </defs>
      <ellipse cx="38.5" cy="66.5" rx="11" ry="2.6" fill="#23291A" opacity=".18" filter="url(#nm2Shadow)" />
      <path d="M32 66 C33 52 35 40 36 30 L40 30 C41.4 40 43.4 52 44.6 66 Z" fill="url(#nm2Stem)" stroke="#3C541C" strokeWidth="2.2" strokeLinejoin="round" />
      <path d="M34.4 64 C35 52 36.2 41 37 31" fill="none" stroke="#CFE79C" strokeWidth="1.6" strokeLinecap="round" opacity=".5" />
      <path d="M42.6 64 C42 52 40.9 41 39.7 31.5" fill="none" stroke="#26380F" strokeWidth="1.8" strokeLinecap="round" opacity=".32" />
      <path d="M37.4 31 C26 32 14 27 11 16.5 C22 14 33 20.5 37.4 31 Z" fill="url(#nm2LeafL)" stroke="#3C541C" strokeWidth="2.2" strokeLinejoin="round" />
      <path d="M35 29.5 C27 28 18 24 12.5 17.5" fill="none" stroke="#3C541C" strokeWidth="1.1" opacity=".38" />
      <path d="M34 27 C26.5 25.5 19 22 14 18" fill="none" stroke="#CFE79C" strokeWidth="1" opacity=".5" />
      <path d="M39 31 C49.5 28.5 57.5 20 59.5 10 C48.5 8.5 41 18 39 31 Z" fill="url(#nm2LeafR)" stroke="#3C541C" strokeWidth="2.2" strokeLinejoin="round" />
      <path d="M41 29.5 C48 26.5 54 21.5 58 12" fill="none" stroke="#46651F" strokeWidth="1.1" opacity=".38" />
      <path d="M41.5 27 C47.5 24 52.5 20 56 13" fill="none" stroke="#DCEEB4" strokeWidth="1" opacity=".55" />
    </svg>
  );
}

const NAV_COLLAPSED_KEY = 'nibbin:navCollapsed';

export type NavKey =
  | 'grove'
  | 'nibbins'
  | 'connections'
  | 'hatch'
  | 'diagnosis'
  | 'planner'
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
    planner: (
      <>
        <circle cx="6" cy="19" r="3" />
        <path d="M9 19h8.5a3.5 3.5 0 0 0 0-7h-11a3.5 3.5 0 0 1 0-7H15" />
        <circle cx="18" cy="5" r="3" />
      </>
    ),
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
  { key: 'planner', label: 'Planner', href: '/app/planner' },
  { key: 'memory', label: 'Memory', href: '/app/memory' },
  { key: 'shop', label: 'Agent Shop', href: '/app/shop' },
  { key: 'billing', label: 'Plan & credits', href: '/billing' },
  { key: 'settings', label: 'Settings', href: '/app/settings/profile' },
  { key: 'help', label: 'Help Center', href: '/app/help' },
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
  const [navCollapsed, setNavCollapsed] = useState(false);
  const close = () => setOpen(false);

  // Read persisted nav-collapsed state on mount (avoids SSR mismatch).
  useEffect(() => {
    try {
      setNavCollapsed(localStorage.getItem(NAV_COLLAPSED_KEY) === 'true');
    } catch {
      // localStorage unavailable (private browsing, etc.) — stay expanded.
    }
  }, []);

  // Auto-collapse the right-rail panel at the intermediate viewport width
  // (881–1180px) where content + 380px panel + 220px sidebar would pinch.
  useEffect(() => {
    if (!panel) return;
    const mq = window.matchMedia('(max-width: 1180px) and (min-width: 881px)');
    function handleChange(e: MediaQueryListEvent | MediaQueryList) {
      if (e.matches) setPanelCollapsed(true);
    }
    handleChange(mq);
    mq.addEventListener('change', handleChange);
    return () => mq.removeEventListener('change', handleChange);
  }, [panel]);

  function toggleNav() {
    setNavCollapsed((v) => {
      const next = !v;
      try {
        localStorage.setItem(NAV_COLLAPSED_KEY, String(next));
      } catch {
        // ignore
      }
      return next;
    });
  }

  return (
    <div className={styles.shell}>
      {open && <div className={styles.backdrop} onClick={close} aria-hidden="true" />}
      {panel && panelOpen && (
        <div className={styles.backdrop} onClick={() => setPanelOpen(false)} aria-hidden="true" />
      )}

      <aside
        className={`${styles.sidebar} ${open ? styles.sidebarOpen : ''} ${navCollapsed ? styles.sidebarCollapsed : ''}`}
      >
        <Link href="/app" className={styles.brand} onClick={close} title="Grove Home">
          {/* On mobile the drawer is always full-width — always show the wordmark.
              On desktop, respect the collapsed state (sprout when collapsed). */}
          {navCollapsed && !open ? (
            <BrandMark />
          ) : (
            <span className={styles.brandWord}>Nibbin</span>
          )}
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
                title={navCollapsed ? item.label : undefined}
                aria-label={navCollapsed ? item.label : undefined}
              >
                <NavIcon k={item.key} />
                <span className={styles.navLabel}>{item.label}</span>
              </span>
            ) : (
              <Link
                key={item.key}
                href={item.href}
                onClick={close}
                className={`${styles.navItem} ${item.key === active ? styles.navItemActive : ''}`}
                aria-current={item.key === active ? 'page' : undefined}
                title={navCollapsed ? item.label : undefined}
                aria-label={navCollapsed ? item.label : undefined}
              >
                <NavIcon k={item.key} />
                <span className={styles.navLabel}>{item.label}</span>
              </Link>
            ),
          )}
        </nav>

        {/* Collapse / expand toggle — desktop only (hidden on mobile via CSS) */}
        <button
          type="button"
          className={styles.navCollapseBtn}
          aria-label={navCollapsed ? 'Expand navigation' : 'Collapse navigation'}
          title={navCollapsed ? 'Expand navigation' : 'Collapse navigation'}
          onClick={toggleNav}
        >
          {/* Chevron SVG — points left (collapse); rotated 180° via CSS when collapsed */}
          <svg
            className={styles.navCollapseBtnIcon}
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
            <path d="M15 18l-6-6 6-6" />
          </svg>
        </button>
      </aside>

      <div
        className={`${styles.main} ${panel ? styles.mainWithPanel : ''} ${onboarding ? styles.mainOnboarding : ''} ${navCollapsed ? styles.mainNavCollapsed : ''}`}
      >
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
          <span className={styles.keeperGlyph} aria-hidden="true">
            <Grovekeeper size={26} />
          </span>
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
          {panelOpen ? '✕' : (
            <span className={styles.keeperGlyph} aria-hidden="true">
              <Grovekeeper size={32} />
            </span>
          )}
        </button>
      )}
    </div>
  );
}
