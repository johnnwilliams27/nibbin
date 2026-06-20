/**
 * Web-side typed bridge to the Tauri shell.
 *
 * Every method is safe to call in a plain browser (Vercel, dev server): when
 * `isShell()` is false the method returns an inert fallback and never throws.
 *
 * Invoke access path: global `window.__TAURI_INTERNALS__.invoke` — no
 * `@tauri-apps/api` package dependency required (it is absent from
 * apps/web/package.json). A type-only declaration covers the global so
 * TypeScript is happy without adding a real runtime dep.
 */
import type { ObserverEvent, SynthesisPacket } from '@nibbin/redaction';

// ---------------------------------------------------------------------------
// Tauri global type shim — matches what Tauri v2 injects into the global
// object (window in the browser, globalThis everywhere).
// We only need invoke; the full API surface is declared by @tauri-apps/api
// but we avoid that dep here.
// ---------------------------------------------------------------------------

interface TauriInternals {
  invoke<T>(cmd: string, args?: Record<string, unknown>): Promise<T>;
  event?: TauriEventEmitter;
}

interface TauriEventEmitter {
  listen<T>(event: string, handler: (event: { payload: T }) => void): Promise<() => void>;
}

// Use a module-scoped interface so TypeScript knows about the globals without
// polluting the Window type (which doesn't exist in Node/vitest).
interface TauriGlobalScope {
  __TAURI_INTERNALS__?: TauriInternals;
  __TAURI__?: {
    core?: { invoke<T>(cmd: string, args?: Record<string, unknown>): Promise<T> };
    event?: TauriEventEmitter;
  };
}

/** Cast globalThis to a shape that may carry Tauri internals. */
function tauriScope(): TauriGlobalScope {
  return globalThis as unknown as TauriGlobalScope;
}

// ---------------------------------------------------------------------------
// Shell probe
// ---------------------------------------------------------------------------

/**
 * Returns true when running inside the Tauri desktop shell.
 * Always false on the server (SSR-safe).
 */
export function isShell(): boolean {
  const g = tauriScope();
  return '__TAURI_INTERNALS__' in g || '__TAURI__' in g;
}

// ---------------------------------------------------------------------------
// Internal invoke helper
// ---------------------------------------------------------------------------

function getInvoke(): ((cmd: string, args?: Record<string, unknown>) => Promise<unknown>) | null {
  const g = tauriScope();
  if (g.__TAURI_INTERNALS__) {
    const internals = g.__TAURI_INTERNALS__;
    return (cmd, args) => internals.invoke(cmd, args);
  }
  if (g.__TAURI__?.core) {
    const core = g.__TAURI__!.core!;
    return (cmd, args) => core.invoke(cmd, args);
  }
  return null;
}

async function call<T>(cmd: string, args: Record<string, unknown> | undefined, fallback: T): Promise<T> {
  const invoke = getInvoke();
  if (invoke === null) return fallback;
  try {
    return (await invoke(cmd, args)) as T;
  } catch {
    // If the native command isn't registered yet (e.g. a query added later by
    // the Rust side), degrade to the fallback rather than surfacing an error.
    return fallback;
  }
}

async function getEventListener(): Promise<TauriEventEmitter | null> {
  const g = tauriScope();
  if (g.__TAURI_INTERNALS__?.event) return g.__TAURI_INTERNALS__.event;
  if (g.__TAURI__?.event) return g.__TAURI__!.event!;
  return null;
}

// ---------------------------------------------------------------------------
// Shared interfaces
// ---------------------------------------------------------------------------

export interface StudyStatus {
  state: string;
  remaining_ms: number | null;
  paused: boolean | null;
  pipeline_halted: boolean | null;
  daemon_health: string | null;
  capture_blocked: string | null;
  study: unknown;
}

export interface CaptureHealth {
  healthy: boolean;
  reason: string | null;
}

export interface Exclusion {
  host?: string;
  bundleId?: string;
  appName?: string;
}

export interface FieldNote {
  id: string;
  ts: string;
  content: string;
}

// ---------------------------------------------------------------------------
// Desktop bridge
// ---------------------------------------------------------------------------

const STUDY_STATUS_FALLBACK: StudyStatus = {
  state: 'DAEMON_OFFLINE',
  remaining_ms: null,
  paused: null,
  pipeline_halted: null,
  daemon_health: null,
  capture_blocked: null,
  study: null,
};

export const desktopBridge = {
  // -------------------------------------------------------------------------
  // Status + review
  // -------------------------------------------------------------------------

  /** Current study status from the daemon. */
  studyStatus(): Promise<StudyStatus> {
    return call<StudyStatus>('study_status', undefined, STUDY_STATUS_FALLBACK);
  },

  /** Already-redacted event list (review queue). */
  reviewData(): Promise<ObserverEvent[]> {
    return call<ObserverEvent[]>('review_events', undefined, []);
  },

  /** Mark events for deletion by id. */
  reviewDelete(ids: string[]): Promise<void> {
    return call<void>('review_delete', { ids }, undefined);
  },

  /** Mark events to keep by id. */
  reviewKeep(ids: string[]): Promise<void> {
    return call<void>('review_keep', { ids }, undefined);
  },

  // -------------------------------------------------------------------------
  // Exclusions (may be added later on the Rust side — degrade gracefully)
  // -------------------------------------------------------------------------

  /** Retrieve the current app/host exclusion list. */
  exclusions(): Promise<Exclusion[]> {
    return call<Exclusion[]>('exclusions', undefined, []);
  },

  /** Add an exclusion rule. */
  addExclusion(exclusion: Exclusion): Promise<void> {
    return call<void>(
      'add_exclusion',
      {
        host: exclusion.host ?? null,
        bundleId: exclusion.bundleId ?? null,
        appName: exclusion.appName ?? null,
      },
      undefined,
    );
  },

  /** Remove an exclusion rule. */
  removeExclusion(exclusion: Exclusion): Promise<void> {
    return call<void>(
      'remove_exclusion',
      {
        host: exclusion.host ?? null,
        bundleId: exclusion.bundleId ?? null,
        appName: exclusion.appName ?? null,
      },
      undefined,
    );
  },

  // -------------------------------------------------------------------------
  // Field notes (may be added later on the Rust side — degrade gracefully)
  // -------------------------------------------------------------------------

  /** Retrieve field notes attached to the current study. */
  fieldNotes(): Promise<FieldNote[]> {
    return call<FieldNote[]>('field_notes', undefined, []);
  },

  // -------------------------------------------------------------------------
  // Capture health (future Rust command — degrade gracefully)
  // -------------------------------------------------------------------------

  /** Capture pipeline health snapshot. */
  captureHealth(): Promise<CaptureHealth> {
    return call<CaptureHealth>('capture_health', undefined, { healthy: false, reason: null });
  },

  // -------------------------------------------------------------------------
  // Control verbs
  // -------------------------------------------------------------------------

  /** Pause the running study. */
  pause(): Promise<void> {
    return call<void>('send_control', { cmd: 'pause' }, undefined);
  },

  /** Resume a paused study. */
  resume(): Promise<void> {
    return call<void>('send_control', { cmd: 'resume' }, undefined);
  },

  /** Stop the study early (triggers review). */
  stopEarly(): Promise<void> {
    return call<void>('send_control', { cmd: 'stop_early' }, undefined);
  },

  /** Purge everything and reset. */
  deleteEverything(): Promise<void> {
    return call<void>('send_control', { cmd: 'delete_everything' }, undefined);
  },

  /** Grant consent to begin capture. */
  consent(): Promise<void> {
    return call<void>('send_control', { cmd: 'consent' }, undefined);
  },

  /** Start the study (fires after consent). */
  start(): Promise<void> {
    return call<void>('send_control', { cmd: 'start' }, undefined);
  },

  // -------------------------------------------------------------------------
  // Study lifecycle
  // -------------------------------------------------------------------------

  /** Create a new study with the given parameters. */
  createStudy(
    id: string,
    kind: 'full_study' | 'quick_scan',
    label: string | null,
    depth: 'lite' | 'detailed' = 'lite',
  ): Promise<void> {
    return call<void>('create_study', { id, kind, label, depth }, undefined);
  },

  // -------------------------------------------------------------------------
  // Auth
  // -------------------------------------------------------------------------

  /** Retrieve the current access token from the native keychain. */
  accessToken(): Promise<string | null> {
    return call<string | null>('access_token', undefined, null);
  },

  // -------------------------------------------------------------------------
  // Packet (synthesis)
  // -------------------------------------------------------------------------

  /** Build a synthesis packet from the current study's reviewed events. */
  buildPacket(): Promise<SynthesisPacket | null> {
    return call<SynthesisPacket | null>('build_packet', undefined, null);
  },

  /** Upload a pre-built synthesis packet to the server. */
  uploadPacket(packet: SynthesisPacket): Promise<void> {
    return call<void>('upload_packet', { packet }, undefined);
  },

  // -------------------------------------------------------------------------
  // Event subscriptions
  // -------------------------------------------------------------------------

  /**
   * Subscribe to study-state-change events from the daemon.
   * Returns an unsubscribe function; no-op when not in shell.
   */
  async onStudyStateChange(cb: (payload: StudyStatus) => void): Promise<() => void> {
    const emitter = await getEventListener();
    if (!emitter) return () => {};
    try {
      return await emitter.listen<StudyStatus>('study_state_change', (e) => cb(e.payload));
    } catch {
      return () => {};
    }
  },

  /**
   * Subscribe to capture-health events from the daemon.
   * Returns an unsubscribe function; no-op when not in shell.
   */
  async onCaptureHealth(cb: (payload: CaptureHealth) => void): Promise<() => void> {
    const emitter = await getEventListener();
    if (!emitter) return () => {};
    try {
      return await emitter.listen<CaptureHealth>('capture_health', (e) => cb(e.payload));
    } catch {
      return () => {};
    }
  },
};
