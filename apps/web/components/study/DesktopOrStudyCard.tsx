'use client';

/**
 * DesktopOrStudyCard
 *
 * Occupies the slot previously held by the "Get the desktop app" download card.
 *
 * - SSR / first paint (mounted === false): renders the browser card so there
 *   is never a hydration mismatch.  The shell check can only run in the client
 *   (Tauri globals do not exist on the server), so we always start as browser.
 * - After mount in a plain browser: stays as the download card.
 * - After mount inside the Tauri desktop shell (isShell() === true): swaps to
 *   the compact live Field Study status card.
 *
 * No polling — a one-shot fetch on mount plus event-driven state updates via
 * desktopBridge.onStudyStateChange.
 */

import { useEffect, useState, useCallback, useRef } from 'react';
import Link from 'next/link';
import { isShell, desktopBridge, type StudyStatus } from '../../lib/desktop/bridge';
import { formatRemaining, extrapolateRemaining } from '../../lib/study/countdown';
import { Card, Badge } from '../ui';
import dash from '../../app/app/dashboard.module.css';
import styles from './desktopOrStudyCard.module.css';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

type BadgeTone = 'moss' | 'honey' | 'neutral';

function stateTone(state: string): BadgeTone {
  if (state === 'ACTIVE') return 'moss';
  if (state === 'PAUSED') return 'honey';
  return 'neutral';
}

function stateLabel(state: string): string {
  const labels: Record<string, string> = {
    ACTIVE: 'Watching',
    PAUSED: 'Paused',
    REVIEW: 'Ready to review',
    SYNTHESIZING: 'Synthesising',
    RAW_DELETING: 'Cleaning up',
    COMPLETE: 'Complete',
    DELETED: 'Deleted',
    NOT_STARTED: 'Not started',
    CONSENTED: 'Ready',
    DAEMON_OFFLINE: 'Offline',
  };
  return labels[state] ?? state;
}

const INACTIVE_STATES = new Set(['NOT_STARTED', 'COMPLETE', 'DELETED', 'DAEMON_OFFLINE']);
const INITIAL_STATUS: StudyStatus = {
  state: 'NOT_STARTED',
  remaining_ms: null,
  paused: null,
  pipeline_halted: null,
  daemon_health: null,
  capture_blocked: null,
  study: null,
};

// ---------------------------------------------------------------------------
// Download card (browser / non-shell variant)
// ---------------------------------------------------------------------------

function DownloadCard() {
  return (
    <Card id="download" className={dash.download}>
      <div className={dash.downloadCopy}>
        <p className={dash.heroEyebrow}>Get the desktop app</p>
        <h2 className={dash.downloadTitle}>Your grove runs in the desktop app</h2>
        <p className={dash.heroEmpty}>
          That&apos;s where your Nibbins connect to your accounts and do the work. Install it on
          the machine you work from.
        </p>
      </div>
      <div className={dash.downloadRow}>
        <a className={dash.dlBtn} href="/download/mac">
          <span className={dash.dlIcon} aria-hidden="true">
            <svg viewBox="0 0 16 16" width="16" height="16" fill="currentColor">
              <path d="M11.18 8.46c-.02-1.78 1.45-2.63 1.52-2.67-.83-1.21-2.12-1.38-2.58-1.4-1.1-.11-2.14.64-2.7.64-.55 0-1.41-.63-2.32-.61-1.2.02-2.3.69-2.91 1.76-1.24 2.15-.32 5.33.89 7.07.59.85 1.29 1.81 2.21 1.77.89-.04 1.22-.57 2.3-.57 1.07 0 1.37.57 2.31.55.95-.02 1.56-.87 2.14-1.72.67-.99.95-1.94.96-1.99-.02-.01-1.84-.71-1.86-2.8zM9.6 3.24c.49-.59.82-1.42.73-2.24-.71.03-1.56.47-2.06 1.06-.45.52-.85 1.36-.74 2.16.79.06 1.59-.4 2.07-.98z" />
            </svg>
          </span>
          Download for macOS
        </a>
        <a className={dash.dlBtn} href="/download/windows">
          <span className={dash.dlIcon} aria-hidden="true">
            <svg viewBox="0 0 16 16" width="15" height="15" fill="currentColor">
              <path d="M0 2.4l6.5-.9v6.3H0V2.4zm0 11.2l6.5.9V8.2H0v5.4zM7.3 1.4L16 0v7.8H7.3V1.4zm0 13.2L16 16V8.2H7.3v6.4z" />
            </svg>
          </span>
          Download for Windows
        </a>
      </div>
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Shell card: live Field Study status
// ---------------------------------------------------------------------------

function StudyCard() {
  const [status, setStatus] = useState<StudyStatus>(INITIAL_STATUS);
  const [busy, setBusy] = useState(false);

  // Countdown anchor + live extrapolated value (see /app/study/page.tsx for the
  // rationale — kept in sync here so the dashboard mini-card also ticks).
  const baseRef = useRef<{ ms: number | null; at: number }>({ ms: null, at: Date.now() });
  const [displayMs, setDisplayMs] = useState<number | null>(null);

  const applyStatus = useCallback((s: StudyStatus) => {
    baseRef.current = { ms: s.remaining_ms, at: Date.now() };
    setDisplayMs(s.remaining_ms);
    setStatus(s);
  }, []);

  // One-shot fetch on mount.
  useEffect(() => {
    void desktopBridge.studyStatus().then(applyStatus);
  }, [applyStatus]);

  // Live status pushes from the daemon (`study:status`, ~1×/sec).
  // Async-cleanup guard: if the component unmounts during the subscribe await,
  // immediately call the returned unsubscribe function to prevent a listener leak.
  useEffect(() => {
    let unsub: (() => void) | null = null;
    let cancelled = false;
    void desktopBridge.onStudyStateChange((s) => applyStatus(s)).then((fn) => {
      if (cancelled) {
        fn();
        return;
      }
      unsub = fn;
    });
    return () => {
      cancelled = true;
      unsub?.();
    };
  }, [applyStatus]);

  // Display-only countdown tick — runs only while ACTIVE (paused must not tick).
  useEffect(() => {
    if (status.state !== 'ACTIVE') return;
    const id = setInterval(() => {
      const { ms, at } = baseRef.current;
      setDisplayMs(extrapolateRemaining(ms, at, Date.now()));
    }, 1000);
    return () => clearInterval(id);
  }, [status.state]);

  const handlePause = useCallback(async () => {
    setBusy(true);
    try {
      await desktopBridge.pause();
    } finally {
      setBusy(false);
    }
  }, []);

  const handleResume = useCallback(async () => {
    setBusy(true);
    try {
      await desktopBridge.resume();
    } finally {
      setBusy(false);
    }
  }, []);

  const isActive = status.state === 'ACTIVE';
  const isPaused = status.state === 'PAUSED';
  const isInactive = INACTIVE_STATES.has(status.state);
  const tone = stateTone(status.state);

  // No active/paused study — prompt to start one.
  if (isInactive) {
    return (
      <Card className={styles.studyCard}>
        <div className={styles.studyHead}>
          <p className={styles.studyEyebrow}>Field study</p>
          <Badge tone="neutral">Not running</Badge>
        </div>
        <p className={styles.studyPrompt}>
          Start a field study to let your Nibbins watch you work and learn your patterns.
        </p>
        <Link href="/app/study" className={styles.studyLink}>
          Start a field study &rarr;
        </Link>
      </Card>
    );
  }

  // Active or paused study — show countdown + quick controls.
  return (
    <Card className={styles.studyCard}>
      <div className={styles.studyHead}>
        <p className={styles.studyEyebrow}>Field study</p>
        <Badge tone={tone}>{stateLabel(status.state)}</Badge>
      </div>

      {displayMs !== null && displayMs > 0 && (
        <p className={styles.studyCountdown}>
          {formatRemaining(displayMs)}{' '}
          <span className={styles.studyCountdownUnit}>remaining</span>
        </p>
      )}

      {(isActive || isPaused) && (
        <div className={styles.studyControls}>
          {isActive && (
            <button
              className={styles.studyBtn}
              onClick={() => void handlePause()}
              disabled={busy}
              type="button"
            >
              Pause
            </button>
          )}
          {isPaused && (
            <button
              className={`${styles.studyBtn} ${styles.studyBtnPrimary}`}
              onClick={() => void handleResume()}
              disabled={busy}
              type="button"
            >
              Resume
            </button>
          )}
          <Link href="/app/study" className={styles.studyLink}>
            Open study &rarr;
          </Link>
        </div>
      )}
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Public export: self-selects at runtime
// ---------------------------------------------------------------------------

/**
 * Renders the "Get the desktop app" download card in a browser, and the live
 * Field Study status card inside the Tauri desktop shell.
 *
 * SSR-safe: first paint always shows the browser (download) card because
 * isShell() is false on the server.  After hydration, if we are in the shell,
 * the component swaps to the Field Study card.
 */
export function DesktopOrStudyCard() {
  const [mounted, setMounted] = useState(false);
  const [shell, setShell] = useState(false);

  useEffect(() => {
    setShell(isShell());
    setMounted(true);
  }, []);

  // Pre-mount: show the browser card (safe default; avoids hydration mismatch).
  if (!mounted || !shell) {
    return <DownloadCard />;
  }

  return <StudyCard />;
}
