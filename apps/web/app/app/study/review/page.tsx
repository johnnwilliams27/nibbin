'use client';

import { useEffect, useState, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { desktopBridge, type Exclusion } from '../../../../lib/desktop/bridge';
import type { ObserverEvent } from '@nibbin/redaction';
import { ShellGate } from '../../../../components/study/ShellGate';
import { Card, Button, EmptyState } from '../../../../components/ui';
import styles from '../../../../components/study/study.module.css';
import { ReviewDoneCta } from './ReviewDoneCta';
import { handleDone } from './review-cta-logic';

function groupByApp(events: ObserverEvent[]): Map<string, ObserverEvent[]> {
  const map = new Map<string, ObserverEvent[]>();
  for (const e of events) {
    const key = e.app.name || e.app.bundle_id;
    const list = map.get(key) ?? [];
    list.push(e);
    map.set(key, list);
  }
  return map;
}

function plural(n: number, word: string): string {
  return `${n} ${word}${n === 1 ? '' : 's'}`;
}

function ReviewContent() {
  const router = useRouter();
  const [events, setEvents] = useState<ObserverEvent[]>([]);
  const [deleted, setDeleted] = useState<Set<string>>(new Set());
  const [exclusionInput, setExclusionInput] = useState('');
  const [adding, setAdding] = useState(false);
  const [addError, setAddError] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [finalizing, setFinalizing] = useState(false);

  const onDone = useCallback(() => {
    setFinalizing(true);
    void handleDone(
      () => desktopBridge.finalizeReview(),
      (url) => router.push(url),
    );
  }, [router]);

  useEffect(() => {
    void desktopBridge.reviewData().then((data) => {
      setEvents(data);
      setLoaded(true);
    });
  }, []);

  const handleDelete = useCallback(async (id: string) => {
    setDeleted((prev) => new Set(prev).add(id));
    await desktopBridge.reviewDelete([id]);
  }, []);

  const handleAddExclusion = useCallback(async () => {
    const value = exclusionInput.trim();
    if (!value) return;
    setAdding(true);
    setAddError(null);
    try {
      const exclusion: Exclusion = value.includes('.') ? { host: value } : { appName: value };
      await desktopBridge.addExclusion(exclusion);
      setExclusionInput('');
    } catch {
      setAddError("Couldn't add that exclusion — give it another go.");
    } finally {
      setAdding(false);
    }
  }, [exclusionInput]);

  const visible = events.filter((e) => !deleted.has(e.id));
  const groups = groupByApp(visible);

  if (!loaded) {
    return (
      <div style={{ padding: '32px 0', color: 'var(--ink-soft)', fontSize: 14 }}>
        Loading review…
      </div>
    );
  }

  return (
    <>
      <header className={styles.header}>
        <p className={styles.eyebrow}>Field Study</p>
        <h1 className={styles.title}>Review</h1>
      </header>

      {visible.length === 0 ? (
        <EmptyState
          title="Nothing to review"
          body="Your Nibbin reviewed the captured moments and didn't flag anything that needs your attention."
        />
      ) : (
        Array.from(groups.entries()).map(([appName, appEvents]) => {
          const kept = appEvents.filter((e) => !deleted.has(e.id));
          if (kept.length === 0) return null;
          return (
            <Card key={appName} className={styles.statusCard}>
              <div className={styles.reviewGroupHeader}>
                <h2 className={styles.reviewGroupTitle}>{appName}</h2>
                <span className={styles.reviewGroupCount}>
                  {plural(kept.length, 'moment')} kept
                </span>
              </div>
              {kept.map((e) => (
                <div key={e.id} className={styles.eventRow}>
                  <div className={styles.eventMain}>
                    <p className={styles.eventLabel}>
                      {e.window.title_redacted || (e.ax ? e.ax.label_redacted : null) || e.kind}
                    </p>
                    <p className={styles.eventMeta}>
                      {e.url ? e.url.host : e.app.bundle_id} ·{' '}
                      {new Date(e.ts).toLocaleTimeString()}
                    </p>
                  </div>
                  <button
                    className={styles.deleteBtn}
                    onClick={() => void handleDelete(e.id)}
                    type="button"
                  >
                    Delete
                  </button>
                </div>
              ))}
            </Card>
          );
        })
      )}

      <Card className={styles.statusCard} style={{ marginTop: 24 }}>
        <h3 className={styles.exclusionUnitTitle}>Never record this again</h3>
        <p className={styles.exclusionUnitHint}>
          Enter an app name or website domain (e.g. "Signal" or "mail.example.com") — Field Study
          will skip it in future sessions.
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
            {adding ? 'Adding…' : 'Add exclusion'}
          </Button>
        </div>
        {addError && (
          <p style={{ color: 'var(--coral-deep)', fontSize: 13, marginTop: 6 }}>{addError}</p>
        )}
      </Card>

      {/* P3 Task 7 — consent gate: proposals derive ONLY from what the user kept */}
      <ReviewDoneCta finalizing={finalizing} onDone={onDone} />
    </>
  );
}

export default function StudyReviewPage() {
  return (
    <ShellGate>
      <ReviewContent />
    </ShellGate>
  );
}
