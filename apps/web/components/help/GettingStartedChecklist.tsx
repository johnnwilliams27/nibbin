'use client';
import Link from 'next/link';
import type { ChecklistState } from '../../lib/help/checklist';
import { Card } from '../ui';
import styles from './help.module.css';

export function GettingStartedChecklist({ state }: { state: ChecklistState }) {
  const pct = Math.round((state.completed / state.total) * 100);
  return (
    <Card className={styles.checklist}>
      <div className={styles.checklistHead}>
        <h2 className={styles.checklistTitle}>Getting started</h2>
        <span className={styles.progress}>{state.completed} of {state.total} done</span>
      </div>
      <div className={styles.bar}>
        <span className={styles.barFill} style={{ width: `${pct}%` }} />
      </div>
      <ul className={styles.steps}>
        {state.steps.map((s) => (
          <li key={s.id} className={s.done ? styles.stepDone : styles.step}>
            <span className={styles.mark} aria-hidden="true">{s.done ? '✓' : ''}</span>
            <div className={styles.stepBody}>
              <div className={styles.stepLabel}>{s.label}</div>
              <p className={styles.stepDetail}>{s.detail}</p>
              {s.auto && s.done && (
                <span className={styles.autoHint}>auto-detected</span>
              )}
            </div>
            {!s.done && (
              <Link href={s.href} className={styles.stepGo}>
                Go
              </Link>
            )}
          </li>
        ))}
      </ul>
    </Card>
  );
}
