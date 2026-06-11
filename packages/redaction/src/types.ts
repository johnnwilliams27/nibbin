/**
 * Observer event schema v1 (SPEC §5) and the pre-persistence raw shapes.
 *
 * The persisted event carries ONLY redacted text (window title, AX label) and a
 * value CLASS — field values are classified and discarded, never persisted.
 * Keystroke contents are never recorded (counts/timing only). `frame_ref`
 * points at a local encrypted blob and never appears in a synthesis packet.
 */

export type EventKind =
  | 'focus'
  | 'ax_delta'
  | 'nav'
  | 'input_burst'
  | 'file_dialog'
  | 'clipboard_meta'
  | 'capture_gap';

export type AxAction = 'press' | 'select' | 'edit' | 'scroll' | 'read';

export type ValueClass = 'currency' | 'date' | 'email' | 'freeform' | 'none';

export type ReviewState = 'auto' | 'user_kept' | 'user_deleted';

/** The persisted, post-redaction event. Append-only during a study. */
export interface ObserverEvent {
  v: 1;
  id: string;
  ts: string;
  session: string;
  kind: EventKind;
  app: { bundle_id: string; name: string };
  window: { title_redacted: string; id: string };
  url: { host: string; path_template: string } | null;
  ax: {
    role_path: string;
    action: AxAction;
    label_redacted: string;
    value_class: ValueClass;
  } | null;
  input: { keys: number; clicks: number; duration_ms: number } | null;
  frame_ref: string | null;
  redaction: { rules_hit: string[]; review_state: ReviewState };
}

/**
 * A raw capture observation, alive only inside the daemon between capture and
 * the pipeline. Secure fields (C4) never reach this shape with content: the
 * capture normalizer is the only constructor and emits `secureSuppressed`
 * nodes with no value, no label, no frame.
 */
export interface RawCaptureEvent {
  id: string;
  ts: string;
  session: string;
  kind: EventKind;
  app: { bundleId: string; name: string };
  window: { title: string; id: string; category?: string };
  url?: string;
  ax?: RawAxObservation;
  input?: { keys: number; clicks: number; durationMs: number };
  /** Local content-addressed blob ref; forced null for secure fields. */
  frameRef?: string | null;
}

export type RawAxObservation =
  | {
      secureSuppressed: false;
      rolePath: string;
      action: AxAction;
      label: string;
      /** Classified then discarded by the pipeline; never persisted. */
      value: string | null;
    }
  | {
      /** C4: structurally suppressed at capture — no value, no label, no frame. */
      secureSuppressed: true;
      rolePath: string;
      action: AxAction;
    };

/** AX snapshot shape produced by the capture layer (and by corpus fixtures). */
export interface AxSnapshot {
  window: { app: string; bundleId?: string; title: string; category?: string; id?: string };
  url?: string;
  axTree: AxSnapshotNode;
  frameRef?: string | null;
}

export interface AxSnapshotNode {
  role: string;
  label?: string;
  value?: string;
  secure?: boolean;
  action?: AxAction;
  children?: AxSnapshotNode[];
}

export type ProcessResult =
  | { action: 'persisted'; event: ObserverEvent }
  | { action: 'blocked_category'; category: string }
  | { action: 'halted_ner_unavailable' };
