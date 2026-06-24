'use client';

/**
 * DocUploadCard — self-contained drag-and-drop document upload component.
 *
 * INTEGRATION NOTE (P1 ↔ P2 merge):
 * This component is intentionally self-contained. Mount it by adding one line
 * to the Memory page (or P1's redesigned Sources tab empty-state):
 *
 *   import { DocUploadCard } from '../../../components/brain/DocUploadCard';
 *   // then in JSX:
 *   <DocUploadCard />
 *
 * Current mount point: apps/web/app/app/memory/page.tsx — below the <form>
 * element, above the closing </AppShell>. The component manages its own state
 * and requires no props for normal use.
 *
 * The `_testState` prop is for testing only — it bypasses internal state hooks
 * so renderToStaticMarkup can produce deterministic markup for each phase.
 *
 * State machine: idle | dragging | uploading | processing | done | error | timedout
 *
 * Accepted types: PDF, DOCX, TXT, JPEG, PNG, WEBP, HEIC (20 MB cap).
 * .doc files get a special "save as .docx" nudge.
 *
 * On done: links to /app/memory#proposals (F2 review surface anchor).
 */

import { useReducer, useRef, useCallback, useEffect } from 'react';
import styles from './DocUploadCard.module.css';

// ── Types ─────────────────────────────────────────────────────────────────

export type DocUploadPhase =
  | 'idle'
  | 'dragging'
  | 'uploading'
  | 'processing'
  | 'done'
  | 'error'
  | 'timedout';

export interface DocUploadState {
  phase: DocUploadPhase;
  sourceId?: string;
  proposalCount?: number;
  errorMessage?: string;
}

export type DocUploadAction =
  | { type: 'DRAG_ENTER' }
  | { type: 'DRAG_LEAVE' }
  | { type: 'FILE_INVALID'; errorMessage: string }
  | { type: 'UPLOAD_START' }
  | { type: 'UPLOAD_DONE'; sourceId: string }
  | { type: 'UPLOAD_ERROR'; errorMessage: string }
  | { type: 'POLL_DONE'; proposalCount: number }
  | { type: 'POLL_ERROR'; errorMessage: string }
  | { type: 'POLL_TIMEOUT' }
  | { type: 'RESET' };

export interface ValidationError {
  code: 'doc_not_supported' | 'unsupported_type' | 'file_too_large';
  message: string;
}

// ── Constants ─────────────────────────────────────────────────────────────

const MAX_SIZE_BYTES = 20 * 1024 * 1024; // 20 MB

const ACCEPTED_MIMES = new Set<string>([
  'application/pdf',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'text/plain',
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/heic',
]);

const DOC_MIME = 'application/msword'; // .doc — special nudge

/** Poll every 2s, timeout after 45 polls (90s). */
const POLL_INTERVAL_MS = 2_000;
const POLL_MAX_ATTEMPTS = 45;

// ── Pure reducer (exported for unit tests) ────────────────────────────────

export function docUploadReducer(
  state: DocUploadState,
  action: DocUploadAction,
): DocUploadState {
  switch (action.type) {
    case 'DRAG_ENTER':
      return { phase: 'dragging' };

    case 'DRAG_LEAVE':
      return { ...state, phase: 'idle' };

    case 'FILE_INVALID':
      return { phase: 'error', errorMessage: action.errorMessage };

    case 'UPLOAD_START':
      return { phase: 'uploading' };

    case 'UPLOAD_DONE':
      return { phase: 'processing', sourceId: action.sourceId };

    case 'UPLOAD_ERROR':
      return { phase: 'error', errorMessage: action.errorMessage };

    case 'POLL_DONE':
      return {
        ...state,
        phase: 'done',
        proposalCount: action.proposalCount,
      };

    case 'POLL_ERROR':
      return { phase: 'error', errorMessage: action.errorMessage };

    case 'POLL_TIMEOUT':
      return { ...state, phase: 'timedout' };

    case 'RESET':
      return { phase: 'idle' };

    default:
      return state;
  }
}

// ── Client-side validation (exported for unit tests) ──────────────────────

export function validateFile(file: File): ValidationError | null {
  // .doc → special nudge
  if (file.type === DOC_MIME) {
    return {
      code: 'doc_not_supported',
      message: 'Please save the file as .docx and try again.',
    };
  }

  // Unsupported type
  if (!ACCEPTED_MIMES.has(file.type)) {
    return {
      code: 'unsupported_type',
      message:
        'Nibbin can read PDFs, Word docs (.docx), plain text, and images. Try a different file.',
    };
  }

  // Size cap
  if (file.size > MAX_SIZE_BYTES) {
    const actualMB = Math.round(file.size / (1024 * 1024));
    return {
      code: 'file_too_large',
      message: `That file is ${actualMB} MB — the limit is 20 MB. Try a smaller file or export a portion.`,
    };
  }

  return null;
}

// ── Phase copy helpers ─────────────────────────────────────────────────────

function progressLabel(phase: DocUploadPhase): string {
  if (phase === 'uploading') return 'Uploading…';
  if (phase === 'processing') return 'Reading your doc…';
  return '';
}

// ── Main component ─────────────────────────────────────────────────────────

interface DocUploadCardProps {
  /**
   * FOR TESTING ONLY. Overrides internal state so renderToStaticMarkup can
   * produce deterministic markup without running effects. Do not use in
   * production — omit it entirely (it defaults to undefined).
   */
  _testState?: Partial<DocUploadState>;
}

export function DocUploadCard({ _testState }: DocUploadCardProps) {
  const [internalState, dispatch] = useReducer(docUploadReducer, { phase: 'idle' });
  const state: DocUploadState = _testState
    ? { ...internalState, ..._testState }
    : internalState;

  const fileInputRef = useRef<HTMLInputElement>(null);
  const pollCountRef = useRef(0);
  const pollTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // ── Polling ───────────────────────────────────────────────────────────

  const stopPolling = useCallback(() => {
    if (pollTimerRef.current !== null) {
      clearInterval(pollTimerRef.current);
      pollTimerRef.current = null;
    }
    pollCountRef.current = 0;
  }, []);

  const startPolling = useCallback(
    (sourceId: string) => {
      pollCountRef.current = 0;
      pollTimerRef.current = setInterval(async () => {
        pollCountRef.current += 1;

        if (pollCountRef.current > POLL_MAX_ATTEMPTS) {
          stopPolling();
          dispatch({ type: 'POLL_TIMEOUT' });
          return;
        }

        try {
          const res = await fetch(`/api/brain/sources/${sourceId}/status`);
          if (!res.ok) {
            stopPolling();
            dispatch({ type: 'POLL_ERROR', errorMessage: 'Could not check processing status.' });
            return;
          }
          const data = (await res.json()) as { status: string; proposalCount: number };

          if (data.status === 'done') {
            stopPolling();
            dispatch({ type: 'POLL_DONE', proposalCount: data.proposalCount ?? 0 });
          } else if (data.status === 'error') {
            stopPolling();
            dispatch({
              type: 'POLL_ERROR',
              errorMessage: 'This file could not be safely processed.',
            });
          }
          // 'processing' → keep polling
        } catch {
          stopPolling();
          dispatch({ type: 'POLL_ERROR', errorMessage: 'Could not check processing status.' });
        }
      }, POLL_INTERVAL_MS);
    },
    [stopPolling],
  );

  // Stop polling on unmount
  useEffect(() => {
    return () => stopPolling();
  }, [stopPolling]);

  // ── Upload ─────────────────────────────────────────────────────────────

  const handleFile = useCallback(
    async (file: File) => {
      const validationError = validateFile(file);
      if (validationError) {
        dispatch({ type: 'FILE_INVALID', errorMessage: validationError.message });
        return;
      }

      dispatch({ type: 'UPLOAD_START' });

      try {
        const formData = new FormData();
        formData.append('file', file);

        const res = await fetch('/api/brain/documents/upload', {
          method: 'POST',
          body: formData,
        });

        if (!res.ok) {
          let msg = 'Upload failed — try again in a moment.';
          try {
            const err = (await res.json()) as { message?: string };
            if (err.message) msg = err.message;
          } catch {
            // ignore parse failure
          }
          dispatch({ type: 'UPLOAD_ERROR', errorMessage: msg });
          return;
        }

        const data = (await res.json()) as { sourceId: string };
        dispatch({ type: 'UPLOAD_DONE', sourceId: data.sourceId });
        startPolling(data.sourceId);
      } catch {
        dispatch({ type: 'UPLOAD_ERROR', errorMessage: 'Upload failed — try again in a moment.' });
      }
    },
    [startPolling],
  );

  // ── Event handlers ─────────────────────────────────────────────────────

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    dispatch({ type: 'DRAG_ENTER' });
  }, []);

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    dispatch({ type: 'DRAG_LEAVE' });
  }, []);

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      dispatch({ type: 'DRAG_LEAVE' }); // leave dragging state regardless
      const file = e.dataTransfer?.files?.[0];
      if (file) void handleFile(file);
    },
    [handleFile],
  );

  const handleChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      if (file) void handleFile(file);
      // Reset input so the same file can be re-selected after an error
      if (fileInputRef.current) fileInputRef.current.value = '';
    },
    [handleFile],
  );

  const handleReset = useCallback(() => {
    stopPolling();
    dispatch({ type: 'RESET' });
  }, [stopPolling]);

  // ── Render helpers ─────────────────────────────────────────────────────

  const { phase, proposalCount, errorMessage, sourceId } = state;
  const isActive = phase === 'uploading' || phase === 'processing';
  const isDragging = phase === 'dragging';

  const dropZoneClass = [
    styles.dropZone,
    isDragging ? styles.dropZoneDragging : '',
    isActive ? styles.dropZoneActive : '',
  ]
    .filter(Boolean)
    .join(' ');

  // ── SSR-safe rendering: all phases rendered from state ─────────────────

  if (phase === 'done') {
    const n = proposalCount ?? 0;
    const noun = n === 1 ? 'thing' : 'things';
    return (
      <div className={styles.card} role="region" aria-label="Document upload">
        <div className={styles.done}>
          <span className={styles.doneIcon} aria-hidden="true">✓</span>
          <p className={styles.doneText}>
            Found {n} {noun} to check —{' '}
            <a
              href={`/app/memory#proposals${sourceId ? `?source=${sourceId}` : ''}`}
              className={styles.reviewLink}
            >
              review below
            </a>
            .
          </p>
          <button type="button" className={styles.resetBtn} onClick={handleReset}>
            Upload another
          </button>
        </div>
      </div>
    );
  }

  if (phase === 'timedout') {
    return (
      <div className={styles.card} role="region" aria-label="Document upload">
        <div className={styles.status}>
          <p className={styles.statusText}>
            This is taking longer than expected — check back in a moment.
          </p>
          <button type="button" className={styles.resetBtn} onClick={handleReset}>
            Try again
          </button>
        </div>
      </div>
    );
  }

  if (phase === 'error') {
    return (
      <div className={styles.card} role="region" aria-label="Document upload">
        <div className={styles.errorState} role="alert">
          <p className={styles.errorText}>{errorMessage ?? 'Something went wrong.'}</p>
          <button type="button" className={styles.resetBtn} onClick={handleReset}>
            Try again
          </button>
        </div>
      </div>
    );
  }

  // idle | dragging | uploading | processing
  return (
    <div
      className={styles.card}
      role="region"
      aria-label="Upload a document to your grove memory"
    >
      {/* §14.5 empty nudge copy */}
      <p className={styles.nudge}>
        Don&apos;t want to type it all out? Drop in a doc — Nibbin will read it and suggest what
        to remember.
      </p>

      {isActive ? (
        /* Progress state */
        <div className={styles.progressArea}>
          <span className={styles.spinner} role="status" aria-label="Processing" />
          <p className={styles.progressText}>{progressLabel(phase)}</p>
        </div>
      ) : (
        /* Drop zone (idle | dragging) */
        <div
          className={dropZoneClass}
          onDragOver={handleDragOver}
          onDragLeave={handleDragLeave}
          onDrop={handleDrop}
          aria-label="Drop a file here to upload"
        >
          <label className={styles.fileLabel} htmlFor="doc-upload-input">
            <span className={styles.fileIcon} aria-hidden="true">
              {isDragging ? '⬇' : '📄'}
            </span>
            <span className={styles.fileLabelText}>
              {isDragging ? 'Drop to upload' : 'Choose file'}
            </span>
            <input
              ref={fileInputRef}
              id="doc-upload-input"
              type="file"
              accept=".pdf,.docx,.txt,.jpg,.jpeg,.png,.webp,.heic"
              className={styles.fileInput}
              onChange={handleChange}
              aria-label="Choose a document to upload"
            />
          </label>
          <p className={styles.hint}>
            PDF, Word (.docx), plain text, or image · max 20 MB
          </p>
        </div>
      )}
    </div>
  );
}
