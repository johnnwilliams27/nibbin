'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useRef, useState } from 'react';
import { buildCreature, type SpeciesName, type Stage, type Accessory, type Marking } from '@nibbin/creatures';
import { listLeaves, markRead, markAllRead, type Leaf } from '../../app/app/notifications/actions';
import styles from './notification-center.module.css';

function relTime(iso: string): string {
  const d = Date.now() - new Date(iso).getTime();
  const m = Math.floor(d / 60000);
  if (m < 1) return 'just now';
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}

export function NotificationBell() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState<Leaf[]>([]);
  const [unread, setUnread] = useState(0);
  const wrapRef = useRef<HTMLDivElement>(null);

  const refresh = useCallback(() => {
    void listLeaves().then((r) => { setItems(r.items); setUnread(r.unread); });
  }, []);

  useEffect(() => { refresh(); }, [refresh]);

  // Close on outside-click + Esc.
  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => { if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) setOpen(false); };
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('mousedown', onDoc);
    document.addEventListener('keydown', onKey);
    return () => { document.removeEventListener('mousedown', onDoc); document.removeEventListener('keydown', onKey); };
  }, [open]);

  function toggle() {
    setOpen((v) => { if (!v) refresh(); return !v; });
  }

  function activate(leaf: Leaf) {
    if (!leaf.read) {
      setItems((xs) => xs.map((x) => (x.id === leaf.id ? { ...x, read: true } : x)));
      setUnread((n) => Math.max(0, n - 1));
      void markRead(leaf.id);
    }
    if (leaf.ctaPath) { setOpen(false); router.push(leaf.ctaPath); }
  }

  function clearAll() {
    setItems((xs) => xs.map((x) => ({ ...x, read: true })));
    setUnread(0);
    void markAllRead();
  }

  return (
    <div className={styles.wrap} ref={wrapRef}>
      <button
        type="button"
        className={styles.bell}
        aria-label={unread > 0 ? `Leaves, ${unread} unread` : 'Leaves'}
        aria-haspopup="true"
        aria-expanded={open}
        onClick={toggle}
      >
        <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="M11 20A7 7 0 0 1 9.8 6.1C15.5 5 17 4.48 19 2c1 2 2 4.18 2 8 0 5.5-4.78 10-10 10Z" />
          <path d="M2 21c0-3 1.85-5.36 5.08-6" />
        </svg>
        {unread > 0 && <span className={styles.badge}>{unread > 9 ? '9+' : unread}</span>}
      </button>

      {open && (
        <div className={styles.panel} role="menu" aria-label="Leaves">
          <div className={styles.head}>
            <span className={styles.eyebrow}>From the grove</span>
            <button type="button" className={styles.headAction} onClick={clearAll} disabled={unread === 0}>
              Mark all read
            </button>
          </div>
          <div className={styles.list}>
            {items.length === 0 ? (
              <p className={styles.empty}>
                Nothing here yet. When your grove has something for you — Field Notes, a training session,
                someone close to graduating — a leaf lands here.
              </p>
            ) : (
              items.map((leaf) => (
                <button key={leaf.id} type="button" role="menuitem"
                  className={`${styles.leaf} ${leaf.read ? '' : styles.leafUnread}`} onClick={() => activate(leaf)}>
                  <span className={styles.leafRow}>
                    {leaf.creature && (
                      <span
                        className={styles.leafCreature}
                        aria-hidden="true"
                        dangerouslySetInnerHTML={{
                          __html: buildCreature({
                            species: leaf.creature.species as SpeciesName,
                            stage: leaf.creature.stage as Stage,
                            color: leaf.creature.palette ?? undefined,
                            acc: leaf.creature.accessory as Accessory,
                            mark: leaf.creature.marking as Marking,
                            size: 40,
                          }),
                        }}
                      />
                    )}
                    <span className={styles.leafText}>
                      <span className={styles.leafTitle}>{leaf.title}</span>
                      <span className={styles.leafBody}>{leaf.body}</span>
                      <span className={styles.leafTime}>{relTime(leaf.createdAt)}</span>
                    </span>
                  </span>
                </button>
              ))
            )}
          </div>
          <div className={styles.foot}>
            <Link href="/app/notifications" className={styles.footLink} onClick={() => setOpen(false)}>
              See all leaves
            </Link>
          </div>
        </div>
      )}
    </div>
  );
}
