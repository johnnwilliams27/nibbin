'use client';

/**
 * StudyStart — web replication of the native consent wizard (apps/desktop/src/ui/views/consent.ts).
 *
 * Privacy-claim copy is VERBATIM from consent.ts (lines 52-80) and tracks
 * docs/INVARIANTS.md exactly. Do not paraphrase — stronger / weaker phrasing
 * is a claims-auditor defect.
 *
 * Flow (mirrors consent.ts lines 91-110):
 *   1. generate id with crypto.randomUUID()
 *   2. createStudy(id, kind, label|null, 'lite')
 *   3. consent()
 *   4. start()
 *   5. refresh studyStatus() → call onStarted() to switch page to in-progress view
 *
 * Controls are inert when not in the Tauri shell (ShellGate covers that path
 * at the route level — this component does not need to re-guard it).
 */

import { useState, useCallback } from 'react';
import { desktopBridge } from '../../lib/desktop/bridge';
import { Card, Badge, Button } from '../ui';
import styles from './study.module.css';

type StudyKind = 'full_study' | 'quick_scan';

export interface StudyStartProps {
  /** Called after a successful start so the parent can re-render to in-progress view. */
  onStarted: () => void;
}

export function StudyStart({ onStarted }: StudyStartProps) {
  const [kind, setKind] = useState<StudyKind>('full_study');
  const [taskLabel, setTaskLabel] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // -------------------------------------------------------------------------
  // Kind-dependent copy — verbatim from consent.ts lines 16-46
  // -------------------------------------------------------------------------

  // "When it ends" differs by kind (consent.ts lines 16-19, verbatim both branches)
  const whenItEnds =
    kind === 'quick_scan'
      ? 'This scan stops the moment you tell it to — or after a few hours if you forget. Raw data auto-deletes after your map is built.'
      : 'The field study ends. Really. Capture stops itself on day 14 — the off switch lives in the background process, not in this window. Raw data auto-deletes after your map is built, and you can watch it verify.';

  // Depth is locked to Lite — "What gets captured" Lite variant (consent.ts line 31)
  const whatGetsCaptured =
    'Which apps and windows you use, the shape of what you click and type (counts and timing — never the keys themselves), and redacted text descriptions like "Invoice {NUM} — {PERSON}". No screenshots.';

  // Heading + intro differ by kind (consent.ts lines 34-46, verbatim)
  const isQuickScan = kind === 'quick_scan';
  const heading = isQuickScan
    ? 'A quick scan of one task — on your terms'
    : 'Two weeks of watching how you work — on your terms';

  const introLine1 = isQuickScan
    ? 'Nibbin will watch just this one task so it can map the workflow — nothing else. '
    : 'The field study watches how you work so your diagnosis can show where the busywork hides. ';
  const introLine2 = 'Here is the whole deal, before anything records:';

  // Confirm button label (consent.ts lines 84-86, verbatim pattern)
  const confirmLabel = isQuickScan
    ? 'I understand — start my scan (Lite)'
    : 'I understand — start my field study (Lite)';

  // -------------------------------------------------------------------------
  // Start sequence
  // -------------------------------------------------------------------------

  const handleConfirm = useCallback(async () => {
    setBusy(true);
    setError(null);
    try {
      const id = crypto.randomUUID();
      const label = isQuickScan && taskLabel.trim() ? taskLabel.trim() : null;
      // Mirror consent.ts lines 91-110: create → consent → start → refresh
      await desktopBridge.createStudy(id, kind, label, 'lite');
      await desktopBridge.consent();
      await desktopBridge.start();
      // Re-fetch status (daemon processes 'start' asynchronously before the
      // study row is fully populated — same comment as consent.ts line 95-96)
      await desktopBridge.studyStatus();
      onStarted();
    } catch {
      // Degrade silently per bridge pattern; surface a soft message so the
      // user knows something went wrong without an unhandled exception.
      setError('Could not start — make sure the Nibbin desktop app is running and try again.');
    } finally {
      setBusy(false);
    }
  }, [kind, taskLabel, isQuickScan, onStarted]);

  const handleNotNow = useCallback(() => {
    // "Not now" mirrors the consent.ts secondary button: just navigates away.
    // In the web shell, going back to Grove is the natural destination.
    window.history.back();
  }, []);

  // -------------------------------------------------------------------------
  // Render
  // -------------------------------------------------------------------------

  return (
    <>
      <header className={styles.header}>
        <p className={styles.eyebrow}>{isQuickScan ? 'Quick scan' : 'Field study'}</p>
        <h1 className={styles.title}>{heading}</h1>
        <p className={styles.claimsIntro}>
          {introLine1}
          {introLine2}
        </p>
      </header>

      {/* Kind picker */}
      <div className={styles.kindRow}>
        <button
          type="button"
          className={[styles.kindBtn, kind === 'full_study' ? styles.kindBtnSelected : ''].join(' ')}
          onClick={() => setKind('full_study')}
          aria-pressed={kind === 'full_study'}
        >
          <span className={styles.kindBtnLabel}>Full field study</span>
          <span className={styles.kindBtnHint}>Two weeks — maps your full workflow picture.</span>
        </button>
        <button
          type="button"
          className={[styles.kindBtn, kind === 'quick_scan' ? styles.kindBtnSelected : ''].join(' ')}
          onClick={() => setKind('quick_scan')}
          aria-pressed={kind === 'quick_scan'}
        >
          <span className={styles.kindBtnLabel}>Quick scan</span>
          <span className={styles.kindBtnHint}>One task, right now — stops when you say so.</span>
        </button>
      </div>

      {/* Task label — only shown for quick scan */}
      {isQuickScan && (
        <div className={styles.taskLabelRow}>
          <input
            type="text"
            className={styles.taskLabelField}
            placeholder="e.g. Sending this month's invoices"
            value={taskLabel}
            onChange={(e) => setTaskLabel(e.target.value)}
            maxLength={140}
            aria-label="Task label"
          />
          <p className={styles.taskLabelHint}>Optional — helps label the scan in your history.</p>
        </div>
      )}

      {/* Depth — locked to Lite */}
      <div className={styles.depthRow}>
        <span className={styles.depthLabel}>Depth:</span>
        <Badge tone="moss">Lite</Badge>
        <span className={styles.depthLabel}>— Detailed not yet available</span>
      </div>

      {/* Privacy claims card — verbatim copy from consent.ts lines 52-80 */}
      <Card className={styles.startCard}>
        <ul className={styles.claimsList}>
          <li className={styles.claimItem}>
            <strong>What gets captured</strong>
            {whatGetsCaptured}
          </li>
          <li className={styles.claimItem}>
            <strong>What never gets captured</strong>
            {'Passwords can\'t be captured — secure fields are blocked by the operating system flag itself. Banking, health, and personal sites are never recorded. No audio. No camera.'}
          </li>
          <li className={styles.claimItem}>
            <strong>Where it lives</strong>
            {'Everything sits in an encrypted store on this machine. Names, emails, and numbers are replaced with placeholders before anything is saved. Pixels never leave your device.'}
          </li>
          <li className={styles.claimItem}>
            <strong>What leaves your device</strong>
            {'One thing, once, only if you choose to send it: a packet of redacted text descriptions of your workflows. Pixels never. You\'ll see it before it goes.'}
          </li>
          <li className={styles.claimItem}>
            <strong>When it ends</strong>
            {whenItEnds}
          </li>
          <li className={styles.claimItem}>
            <strong>Your controls</strong>
            {'Pause everything with one hotkey (⌘⇧.). Review each day and delete anything. Add "never record this" exclusions. Delete everything, at any moment, from any screen.'}
          </li>
        </ul>
        {/* Closing muted line — verbatim from consent.ts lines 78-80 */}
        <p className={styles.claimMuted}>
          Reviewing is a right, not a chore — days you skip still count, on the same rules above.
        </p>

        <div className={styles.startActions}>
          <Button
            variant="primary"
            onClick={() => void handleConfirm()}
            disabled={busy}
          >
            {busy ? 'Starting…' : confirmLabel}
          </Button>
          <Button
            variant="secondary"
            onClick={handleNotNow}
            disabled={busy}
          >
            Not now
          </Button>
        </div>
        {error !== null && <p className={styles.startError}>{error}</p>}
      </Card>
    </>
  );
}
