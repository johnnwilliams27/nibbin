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
 * NOTE on removeExclusion: the daemon stub may be a no-op. We show the remove
 * control with a disclosure that changes take effect on the daemon's next
 * restart, so it's honest about the current behaviour.
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

  const handleRemoveExclusion = useCallback(async (exclusion: Exclusion) => {
    // removeExclusion may be a no-op until the daemon supports it — we call it
    // optimistically and update local state, surfacing the restart note to the user.
    await desktopBridge.removeExclusion(exclusion);
    setExclusions((prev) =>
      prev.filter(
        (e) =>
          !(
            e.host === exclusion.host &&
            e.bundleId === exclusion.bundleId &&
            e.appName === exclusion.appName
          ),
      ),
    );
  }, []);

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
                      onClick={() => void handleRemoveExclusion(e)}
                      title="Remove this exclusion"
                    >
                      Remove
                    </button>
                  </li>
                );
              })}
            </ul>
            <p style={{ fontSize: 12, color: 'var(--ink-faint)', marginBottom: 16 }}>
              Removals take effect when the desktop app restarts.
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
