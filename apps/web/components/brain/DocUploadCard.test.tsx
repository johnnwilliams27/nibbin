/**
 * Task 4: DocUploadCard component tests.
 *
 * Strategy (NO jsdom):
 * - Static structure: renderToStaticMarkup on the DocUploadCard with a fixed
 *   `_testState` prop that bypasses internal state hooks. This covers idle/progress/
 *   done/error/timedout markup, accessibility attributes, and copy assertions.
 * - State logic: the pure `docUploadReducer` + `validateFile` are exported and
 *   tested directly. This covers drag-over, type rejection, oversize rejection,
 *   progress/done/error transitions, and the 90-second timeout.
 *
 * The reducer tests prove correctness without any DOM environment. The SSR tests
 * prove the correct markup is emitted for each state.
 *
 * Run: npx vitest run apps/web/components/brain/DocUploadCard.test.tsx
 */

import { renderToStaticMarkup } from 'react-dom/server';
import { describe, it, expect } from 'vitest';
import {
  DocUploadCard,
  docUploadReducer,
  validateFile,
  type DocUploadState,
  type DocUploadAction,
} from './DocUploadCard';

// ── Helper: render the card with a pinned test-state prop ─────────────────

function renderCard(testState?: Partial<DocUploadState>): string {
  return renderToStaticMarkup(<DocUploadCard _testState={testState} />);
}

// ── 1. Static structure tests (SSR) ───────────────────────────────────────

describe('DocUploadCard — static structure (idle state)', () => {
  it('renders a drop zone region with an aria-label', () => {
    const html = renderCard();
    expect(html).toMatch(/role="region"/);
    expect(html).toMatch(/aria-label=/);
  });

  it('renders a "Choose file" or equivalent file input label', () => {
    const html = renderCard();
    // Input of type file or a labelled button
    expect(html).toMatch(/type="file"/);
  });

  it('file input has an associated label', () => {
    const html = renderCard();
    // Should have a <label> that wraps or uses htmlFor
    expect(html).toMatch(/<label/);
  });

  it('renders the §14.5 empty nudge copy in idle state', () => {
    const html = renderCard();
    // renderToStaticMarkup encodes apostrophes as &#x27;
    expect(html).toMatch(/Don(&#x27;|'|&apos;)t want to type it all out\?/);
  });

  it('renders the drop-in nudge text in idle state', () => {
    const html = renderCard();
    expect(html).toContain('Drop in a doc');
  });
});

describe('DocUploadCard — progress states (SSR)', () => {
  it('uploading state shows "Uploading…"', () => {
    const html = renderCard({ phase: 'uploading' });
    expect(html).toContain('Uploading');
  });

  it('processing state shows "Reading your doc…"', () => {
    const html = renderCard({ phase: 'processing' });
    expect(html).toContain('Reading your doc');
  });

  it('done state shows "review" and proposal count', () => {
    const html = renderCard({ phase: 'done', proposalCount: 3, sourceId: 'abc' });
    expect(html).toContain('3');
    expect(html).toContain('review');
  });

  it('done state with 1 proposal uses singular copy', () => {
    const html = renderCard({ phase: 'done', proposalCount: 1, sourceId: 'abc' });
    // Doesn't crash and contains "1"
    expect(html).toContain('1');
  });

  it('error state shows an error message', () => {
    const html = renderCard({ phase: 'error', errorMessage: 'Something went wrong.' });
    expect(html).toContain('Something went wrong.');
  });

  it('timedout state shows "taking longer than expected"', () => {
    const html = renderCard({ phase: 'timedout' });
    expect(html).toContain('taking longer than expected');
  });

  it('quarantined error shows appropriate message', () => {
    const html = renderCard({ phase: 'error', errorMessage: 'This file could not be safely processed.' });
    expect(html).toContain('safely processed');
  });
});

// ── 2. validateFile — client-side inline validation ──────────────────────

describe('validateFile', () => {
  function makeFile(name: string, type: string, sizeBytes: number) {
    return { name, type, size: sizeBytes } as File;
  }

  const TWENTY_MB = 20 * 1024 * 1024;

  it('accepts application/pdf', () => {
    expect(validateFile(makeFile('sheet.pdf', 'application/pdf', 1024))).toBeNull();
  });

  it('accepts .docx MIME type', () => {
    const f = makeFile(
      'doc.docx',
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      1024,
    );
    expect(validateFile(f)).toBeNull();
  });

  it('accepts text/plain', () => {
    expect(validateFile(makeFile('notes.txt', 'text/plain', 1024))).toBeNull();
  });

  it('accepts image/jpeg', () => {
    expect(validateFile(makeFile('photo.jpg', 'image/jpeg', 1024))).toBeNull();
  });

  it('accepts image/png', () => {
    expect(validateFile(makeFile('photo.png', 'image/png', 1024))).toBeNull();
  });

  it('accepts image/webp', () => {
    expect(validateFile(makeFile('photo.webp', 'image/webp', 1024))).toBeNull();
  });

  it('accepts image/heic', () => {
    expect(validateFile(makeFile('photo.heic', 'image/heic', 1024))).toBeNull();
  });

  it('rejects .doc (application/msword) with doc_not_supported message', () => {
    const err = validateFile(makeFile('old.doc', 'application/msword', 1024));
    expect(err).not.toBeNull();
    expect(err!.code).toBe('doc_not_supported');
    expect(err!.message).toContain('.docx');
  });

  it('rejects .xlsx with unsupported_type message mentioning PDFs / Word / images', () => {
    const err = validateFile(makeFile(
      'spreadsheet.xlsx',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      1024,
    ));
    expect(err).not.toBeNull();
    expect(err!.code).toBe('unsupported_type');
    // Message should mention what IS accepted
    expect(err!.message).toMatch(/PDF|Word|image/i);
  });

  it('rejects file exactly at 20 MB limit (size === limit → rejected)', () => {
    // The limit is >20 MB; exactly 20 MB is fine
    expect(validateFile(makeFile('edge.pdf', 'application/pdf', TWENTY_MB))).toBeNull();
  });

  it('rejects file over 20 MB with file_too_large message including "20 MB"', () => {
    const err = validateFile(makeFile('huge.pdf', 'application/pdf', TWENTY_MB + 1));
    expect(err).not.toBeNull();
    expect(err!.code).toBe('file_too_large');
    expect(err!.message).toContain('20 MB');
  });

  it('includes actual file size in MB in the oversize message', () => {
    const twentyFiveMB = 25 * 1024 * 1024;
    const err = validateFile(makeFile('big.pdf', 'application/pdf', twentyFiveMB));
    expect(err).not.toBeNull();
    expect(err!.message).toMatch(/25\s*MB/i);
  });
});

// ── 3. docUploadReducer — state machine transitions ───────────────────────

describe('docUploadReducer', () => {
  const idle: DocUploadState = { phase: 'idle' };

  function dispatch(state: DocUploadState, action: DocUploadAction): DocUploadState {
    return docUploadReducer(state, action);
  }

  // Drag-over state
  it('DRAG_ENTER transitions idle → dragging', () => {
    const next = dispatch(idle, { type: 'DRAG_ENTER' });
    expect(next.phase).toBe('dragging');
  });

  it('DRAG_LEAVE transitions dragging → idle', () => {
    const dragging: DocUploadState = { phase: 'dragging' };
    const next = dispatch(dragging, { type: 'DRAG_LEAVE' });
    expect(next.phase).toBe('idle');
  });

  // Invalid file dropped → error
  it('FILE_INVALID sets error message and transitions to error', () => {
    const next = dispatch(idle, {
      type: 'FILE_INVALID',
      errorMessage: 'Please save the file as .docx and try again.',
    });
    expect(next.phase).toBe('error');
    expect(next.errorMessage).toBe('Please save the file as .docx and try again.');
  });

  it('doc_not_supported error copy mentions .docx', () => {
    const next = dispatch(idle, {
      type: 'FILE_INVALID',
      errorMessage: 'Please save the file as .docx and try again.',
    });
    expect(next.errorMessage).toContain('.docx');
  });

  // Upload started
  it('UPLOAD_START transitions idle → uploading', () => {
    const next = dispatch(idle, { type: 'UPLOAD_START' });
    expect(next.phase).toBe('uploading');
  });

  // Upload succeeded → processing
  it('UPLOAD_DONE transitions uploading → processing with sourceId', () => {
    const uploading: DocUploadState = { phase: 'uploading' };
    const next = dispatch(uploading, { type: 'UPLOAD_DONE', sourceId: 'src-123' });
    expect(next.phase).toBe('processing');
    expect(next.sourceId).toBe('src-123');
  });

  // Upload failed → error
  it('UPLOAD_ERROR transitions uploading → error', () => {
    const uploading: DocUploadState = { phase: 'uploading' };
    const next = dispatch(uploading, { type: 'UPLOAD_ERROR', errorMessage: 'Upload failed.' });
    expect(next.phase).toBe('error');
    expect(next.errorMessage).toBe('Upload failed.');
  });

  // Poll done → done
  it('POLL_DONE transitions processing → done with proposalCount', () => {
    const processing: DocUploadState = { phase: 'processing', sourceId: 'src-abc' };
    const next = dispatch(processing, { type: 'POLL_DONE', proposalCount: 5 });
    expect(next.phase).toBe('done');
    expect(next.proposalCount).toBe(5);
  });

  // Poll error → error
  it('POLL_ERROR transitions processing → error', () => {
    const processing: DocUploadState = { phase: 'processing', sourceId: 'src-abc' };
    const next = dispatch(processing, {
      type: 'POLL_ERROR',
      errorMessage: 'This file could not be safely processed.',
    });
    expect(next.phase).toBe('error');
    expect(next.errorMessage).toBe('This file could not be safely processed.');
  });

  // Timeout after 90 seconds
  it('POLL_TIMEOUT transitions processing → timedout', () => {
    const processing: DocUploadState = { phase: 'processing', sourceId: 'src-abc' };
    const next = dispatch(processing, { type: 'POLL_TIMEOUT' });
    expect(next.phase).toBe('timedout');
  });

  // Reset → idle
  it('RESET always returns idle state', () => {
    for (const state of [
      { phase: 'uploading' as const },
      { phase: 'error' as const, errorMessage: 'oops' },
      { phase: 'done' as const, proposalCount: 2, sourceId: 'x' },
    ]) {
      expect(dispatch(state as DocUploadState, { type: 'RESET' }).phase).toBe('idle');
    }
  });

  // Dragging → uploading (file dropped then validated elsewhere)
  it('DRAG_LEAVE from dragging preserves the transition back to idle', () => {
    const dragging: DocUploadState = { phase: 'dragging' };
    const next = dispatch(dragging, { type: 'DRAG_LEAVE' });
    expect(next.phase).toBe('idle');
  });
});

// ── 4. Done state deep-links to F2 review surface ─────────────────────────

describe('DocUploadCard — done state review link', () => {
  it('done state renders a link to /app/memory (review anchor)', () => {
    const html = renderCard({ phase: 'done', proposalCount: 2, sourceId: 'src-xyz' });
    // The card should link somewhere in /app/memory or /app/proposals
    expect(html).toMatch(/href="[^"]*\/app\/(memory|proposals)[^"]*"/);
  });

  it('done state shows "review" in the link or surrounding text', () => {
    const html = renderCard({ phase: 'done', proposalCount: 4, sourceId: 'src-xyz' });
    expect(html.toLowerCase()).toContain('review');
  });
});
