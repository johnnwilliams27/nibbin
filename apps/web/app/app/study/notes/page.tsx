'use client';

import { useEffect, useState } from 'react';
import { desktopBridge, type FieldNote } from '../../../../lib/desktop/bridge';
import { ShellGate } from '../../../../components/study/ShellGate';
import { Card, EmptyState } from '../../../../components/ui';
import styles from '../../../../components/study/study.module.css';

/**
 * Field notes route.
 *
 * The daemon emits derived per-app notes (throttled ~3 min) by aggregating the
 * last 24 hours of already-redacted events locally. fieldNotes() reads
 * field_notes.json from the store root. EmptyState renders until the first
 * batch arrives (typically within 3 minutes of a study starting).
 */
function NotesContent() {
  const [notes, setNotes] = useState<FieldNote[]>([]);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    void desktopBridge.fieldNotes().then((data) => {
      setNotes(data);
      setLoaded(true);
    });
  }, []);

  if (!loaded) {
    return (
      <div style={{ padding: '32px 0', color: 'var(--ink-soft)', fontSize: 14 }}>
        Loading notes…
      </div>
    );
  }

  return (
    <>
      <header className={styles.header}>
        <p className={styles.eyebrow}>Field Study</p>
        <h1 className={styles.title}>Field notes</h1>
      </header>

      {notes.length === 0 ? (
        <EmptyState
          title="No notes yet"
          body="Field notes surface automatically as your study runs. They'll appear here when your Nibbin has something worth calling out."
        />
      ) : (
        notes.map((note) => (
          <Card key={note.id} className={styles.noteCard}>
            <p className={styles.noteTs}>{new Date(note.ts).toLocaleString()}</p>
            <p className={styles.noteContent}>{note.content}</p>
          </Card>
        ))
      )}
    </>
  );
}

export default function StudyNotesPage() {
  return (
    <ShellGate>
      <NotesContent />
    </ShellGate>
  );
}
