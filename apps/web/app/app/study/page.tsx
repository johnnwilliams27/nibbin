'use client';

import { useEffect, useState, useCallback, useRef } from 'react';
import { desktopBridge, type StudyStatus } from '../../../lib/desktop/bridge';
import { formatRemaining, extrapolateRemaining } from '../../../lib/study/countdown';
import { ShellGate } from '../../../components/study/ShellGate';
import { StudyStart } from '../../../components/study/StudyStart';
import { Card, Badge, Button } from '../../../components/ui';
import styles from '../../../components/study/study.module.css';

const INITIAL_STATUS: StudyStatus = {
  state: 'NOT_STARTED',
  remaining_ms: null,
  paused: null,
  pipeline_halted: null,
  daemon_health: null,
  capture_blocked: null,
  study: null,
};

type BadgeTone = 'moss' | 'honey' | 'coral' | 'neutral';

function stateTone(state: string): BadgeTone {
  if (state === 'ACTIVE') return 'moss';
  if (state === 'PAUSED') return 'honey';
  if (state === 'REVIEW') return 'honey';
  if (state === 'SYNTHESIZING' || state === 'RAW_DELETING') return 'honey';
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

/**
 * Returns true when the study is in a genuinely idle terminal state and the
 * start wizard should be shown. Only NOT_STARTED / COMPLETE / DELETED qualify
 * — DAEMON_OFFLINE is a transient connectivity blip, not an idle state, so it
 * must NOT show the wizard (that would flash or persistently show the wizard
 * mid-study when the daemon briefly disconnects).
 */
function isIdle(status: StudyStatus): boolean {
  return (
    status.state === 'NOT_STARTED' ||
    status.state === 'COMPLETE' ||
    status.state === 'DELETED'
  );
}

function InProgressContent() {
  const [status, setStatus] = useState<StudyStatus>(INITIAL_STATUS);
  const [busy, setBusy] = useState(false);
  const [mounted, setMounted] = useState(false);
  // `loaded` becomes true after the first real studyStatus() resolves so we
  // never show the wizard before we know the actual state (prevents the flash
  // where NOT_STARTED placeholder shows for a frame before the fetch resolves).
  const [loaded, setLoaded] = useState(false);

  // Countdown anchor: the daemon's last-reported remaining_ms plus the wall-clock
  // instant it arrived. A local 1s tick extrapolates from this so the number
  // counts down smoothly even between daemon pushes (and re-anchors on every
  // fresh status). `displayMs` is the live, extrapolated value shown to the user.
  const baseRef = useRef<{ ms: number | null; at: number }>({ ms: null, at: Date.now() });
  const [displayMs, setDisplayMs] = useState<number | null>(null);

  // Re-anchor whenever a new status (mount fetch or daemon push) arrives.
  const applyStatus = useCallback((s: StudyStatus) => {
    baseRef.current = { ms: s.remaining_ms, at: Date.now() };
    setDisplayMs(s.remaining_ms);
    setStatus(s);
  }, []);

  useEffect(() => {
    setMounted(true);
    void desktopBridge.studyStatus().then((s) => {
      applyStatus(s);
      setLoaded(true);
    });
  }, [applyStatus]);

  // Live status pushes from the daemon (emitted ~1×/sec as `study:status`).
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

  // Client-side countdown tick. Only runs while the study is actively watching:
  // a paused / review / synthesizing study must NOT visibly tick down. The tick
  // is display-only — it never re-invokes a native command (the daemon remains
  // the source of truth and re-anchors us on its next push).
  useEffect(() => {
    if (status.state !== 'ACTIVE') return;
    const id = setInterval(() => {
      const { ms, at } = baseRef.current;
      setDisplayMs(extrapolateRemaining(ms, at, Date.now()));
    }, 1000);
    return () => clearInterval(id);
  }, [status.state]);

  // Called by StudyStart after a successful start to re-read status and switch view
  const handleStarted = useCallback(() => {
    void desktopBridge.studyStatus().then(applyStatus);
  }, [applyStatus]);

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

  const handleStop = useCallback(async () => {
    setBusy(true);
    try {
      await desktopBridge.stopEarly();
    } finally {
      setBusy(false);
    }
  }, []);

  // Don't render until after first mount (ShellGate already guards the shell
  // check) and until the first studyStatus() has resolved (prevents the wizard
  // from flashing before we know the real state).
  if (!mounted || !loaded) return null;

  // --- Daemon offline blip: show a reconnecting note, not the start wizard ---
  if (status.state === 'DAEMON_OFFLINE') {
    return (
      <Card className={styles.statusCard}>
        <p style={{ fontSize: 14, color: 'var(--ink-soft)', margin: 0 }}>
          Reconnecting to the capture daemon…
        </p>
      </Card>
    );
  }

  // --- Idle: show the start wizard ---
  if (isIdle(status)) {
    return <StudyStart onStarted={handleStarted} />;
  }

  // --- Active / paused / review / etc: show in-progress UI ---
  const isActive = status.state === 'ACTIVE';
  const isPaused = status.state === 'PAUSED';
  const tone = stateTone(status.state);

  return (
    <>
      <header className={styles.header}>
        <p className={styles.eyebrow}>Field Study</p>
        <h1 className={styles.title}>In progress</h1>
      </header>

      <Card className={styles.statusCard}>
        <div className={styles.statusHeader}>
          <h2 className={styles.statusTitle}>{stateLabel(status.state)}</h2>
          <Badge tone={tone}>{stateLabel(status.state)}</Badge>
        </div>

        {displayMs !== null && displayMs > 0 && (
          <div>
            <p className={styles.countdown}>{formatRemaining(displayMs)}</p>
            <p className={styles.countdownLabel}>remaining</p>
          </div>
        )}

        {status.capture_blocked && (
          <div className={styles.healthNote} role="status">
            Taking a breather — {status.capture_blocked}
          </div>
        )}

        {(isActive || isPaused) && (
          <div className={styles.controls}>
            {isActive && (
              <Button variant="secondary" onClick={() => void handlePause()} disabled={busy}>
                Pause
              </Button>
            )}
            {isPaused && (
              <Button variant="primary" onClick={() => void handleResume()} disabled={busy}>
                Resume
              </Button>
            )}
            <Button variant="danger" onClick={() => void handleStop()} disabled={busy}>
              Stop early
            </Button>
          </div>
        )}
      </Card>
    </>
  );
}

export default function StudyPage() {
  return (
    <ShellGate>
      <InProgressContent />
    </ShellGate>
  );
}
