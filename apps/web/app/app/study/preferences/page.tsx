'use client';

import { useEffect, useState, useCallback } from 'react';
import Link from 'next/link';
import { desktopBridge, type Exclusion } from '../../../../lib/desktop/bridge';
import { ShellGate } from '../../../../components/study/ShellGate';
import { Card, Button, EmptyState } from '../../../../components/ui';
import styles from '../../../../components/study/study.module.css';

function exclusionLabel(e: Exclusion): string {
  return e.appName ?? e.host ?? e.bundleId ?? '(unknown)';
}

function exclusionSub(e: Exclusion): string | null {
  if (e.appName && e.bundleId) return e.bundleId;
  if (e.host) return 'website';
  return null;
}

/**
 * Preferences route.
 *
 * NOTE on removeExclusion: the daemon does NOT yet implement RemoveExclusion —
 * the control command is silently ignored (logged as "unknown cmd"). The remove
 * button is therefore disabled with an honest disclosure so users aren't misled
 * into thinking a removal was recorded. When the daemon gains RemoveExclusion
 * support, remove the `disabled` prop and the disclosure note below.
 *
 * No "go to nibbin.com for account settings" — links go to in-app /app/settings.
 */
function PreferencesContent() {
  const [exclusions, setExclusions] = useState<Exclusion[]>([]);
  const [exclusionInput, setExclusionInput] = useState('');
  const [adding, setAdding] = useState(false);
  const [addError, setAddError] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    void desktopBridge.exclusions().then((data) => {
      setExclusions(data);
      setLoaded(true);
    });
  }, []);

  const handleAddExclusion = useCallback(async () => {
    const value = exclusionInput.trim();
    if (!value) return;
    setAdding(true);
    setAddError(null);
    try {
      const exclusion: Exclusion = value.includes('.') ? { host: value } : { appName: value };
      await desktopBridge.addExclusion(exclusion);
      setExclusions((prev) => [...prev, exclusion]);
      setExclusionInput('');
    } catch {
      setAddError("Couldn't add that exclusion — give it another go.");
    } finally {
      setAdding(false);
    }
  }, [exclusionInput]);

  // handleRemoveExclusion is intentionally omitted: the daemon does not yet
  // implement RemoveExclusion. The remove button is disabled with an honest
  // disclosure. Re-add this handler (and enable the button) once the daemon
  // gains RemoveExclusion support.

  const handleDeleteEverything = useCallback(async () => {
    setDeleting(true);
    try {
      await desktopBridge.deleteEverything();
    } finally {
      setDeleting(false);
      setConfirmDelete(false);
    }
  }, []);

  return (
    <>
      <header className={styles.header}>
        <p className={styles.eyebrow}>Field Study</p>
        <h1 className={styles.title}>Preferences</h1>
      </header>

      <Card className={styles.statusCard}>
        <h2 className={styles.statusTitle}>Never record</h2>
        <p style={{ fontSize: 14, color: 'var(--ink-soft)', margin: '6px 0 16px' }}>
          Apps and websites listed here are skipped during capture. Add anything you want kept
          private.
        </p>

        {loaded && exclusions.length > 0 && (
          <>
            <ul className={styles.exclusionList}>
              {exclusions.map((e, i) => {
                const sub = exclusionSub(e);
                return (
                  <li key={i} className={styles.exclusionItem}>
                    <div>
                      <p className={styles.exclusionName}>{exclusionLabel(e)}</p>
                      {sub && <p className={styles.exclusionSub}>{sub}</p>}
                    </div>
                    <button
                      className={styles.removeBtn}
                      type="button"
                      disabled
                      title="Removing exclusions isn't available yet — coming in an update"
                      aria-disabled="true"
                    >
                      Remove
                    </button>
                  </li>
                );
              })}
            </ul>
            <p style={{ fontSize: 12, color: 'var(--ink-faint)', marginBottom: 16 }}>
              Removing exclusions isn&apos;t available yet — coming in an update.
            </p>
          </>
        )}

        {loaded && exclusions.length === 0 && (
          <EmptyState
            title="No exclusions yet"
            body="Add apps or sites below and Field Study will skip them in future sessions."
          />
        )}

        <div className={styles.exclusionUnit}>
          <p className={styles.exclusionUnitHint}>
            Enter an app name or website domain to exclude from future sessions.
          </p>
          <div className={styles.exclusionRow}>
            <input
              className={styles.exclusionInput}
              type="text"
              value={exclusionInput}
              onChange={(e) => setExclusionInput(e.target.value)}
              placeholder="App name or domain"
              aria-label="App name or domain to exclude"
              onKeyDown={(e) => {
                if (e.key === 'Enter') void handleAddExclusion();
              }}
            />
            <Button
              variant="secondary"
              onClick={() => void handleAddExclusion()}
              disabled={adding || !exclusionInput.trim()}
            >
              {adding ? 'Adding…' : 'Add'}
            </Button>
          </div>
          {addError && (
            <p style={{ color: 'var(--coral-deep)', fontSize: 13, marginTop: 6 }}>{addError}</p>
          )}
        </div>
      </Card>

      <p className={styles.settingsLink}>
        For account settings and data preferences, visit{' '}
        <Link href="/app/settings/privacy">Data &amp; Privacy</Link>.
      </p>

      <div className={styles.dangerZone}>
        <h2 className={styles.dangerTitle}>Danger zone</h2>
        <p className={styles.dangerHint}>
          Deleting everything purges all captured data from this study. This cannot be undone —
          your nibbins won&apos;t be able to learn from it.
        </p>

        {!confirmDelete ? (
          <Button variant="danger" onClick={() => setConfirmDelete(true)}>
            Delete everything
          </Button>
        ) : (
          <div className={styles.confirmRow}>
            <p style={{ fontSize: 14, color: 'var(--coral-deep)', margin: 0 }}>
              This will permanently delete all captured data. Are you sure?
            </p>
            <Button
              variant="danger"
              onClick={() => void handleDeleteEverything()}
              disabled={deleting}
            >
              {deleting ? 'Deleting…' : 'Yes, delete everything'}
            </Button>
            <Button
              variant="ghost"
              onClick={() => setConfirmDelete(false)}
              disabled={deleting}
            >
              Cancel
            </Button>
          </div>
        )}
      </div>
    </>
  );
}

export default function StudyPreferencesPage() {
  return (
    <ShellGate>
      <PreferencesContent />
    </ShellGate>
  );
}
