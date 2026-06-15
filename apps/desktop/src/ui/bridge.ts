/**
 * Typed bridge to the Tauri shell. In a plain browser (vite dev without the
 * shell) every call resolves to inert defaults so the UI can be exercised —
 * there is no capture and no store outside the daemon, so "no data" is the
 * truthful dev-mode answer.
 */
import type { ObserverEvent } from '@nibbin/redaction';

export interface StudyStatus {
  state: string;
  remaining_ms: number | null;
  paused: boolean | null;
  pipeline_halted: boolean | null;
  study: unknown;
}

type InvokeFn = (cmd: string, args?: Record<string, unknown>) => Promise<unknown>;

let invokeFn: InvokeFn | null | undefined;

async function getInvoke(): Promise<InvokeFn | null> {
  if (invokeFn !== undefined) return invokeFn;
  if ('__TAURI_INTERNALS__' in window) {
    const api = await import('@tauri-apps/api/core');
    invokeFn = api.invoke as InvokeFn;
  } else {
    invokeFn = null;
  }
  return invokeFn;
}

async function call<T>(cmd: string, args: Record<string, unknown> | undefined, fallback: T): Promise<T> {
  const invoke = await getInvoke();
  if (invoke === null) return fallback;
  return (await invoke(cmd, args)) as T;
}

export const bridge = {
  studyStatus: () =>
    call<StudyStatus>('study_status', undefined, {
      state: 'DAEMON_OFFLINE',
      remaining_ms: null,
      paused: null,
      pipeline_halted: null,
      study: null,
    }),
  sendControl: (cmd: string) => call<void>('send_control', { cmd }, undefined),
  reviewEvents: () => call<ObserverEvent[]>('review_events', undefined, []),
  reviewDelete: (ids: string[]) => call<void>('review_delete', { ids }, undefined),
  reviewKeep: (ids: string[]) => call<void>('review_keep', { ids }, undefined),
  addExclusion: (exclusion: { host?: string; bundleId?: string; appName?: string }) =>
    call<void>(
      'add_exclusion',
      { host: exclusion.host ?? null, bundleId: exclusion.bundleId ?? null, appName: exclusion.appName ?? null },
      undefined,
    ),
  storeSession: (session: Record<string, unknown>) =>
    call<void>('store_session', { session }, undefined),
  authSession: () => call<Record<string, unknown> | null>('auth_session', undefined, null),
  accessToken: () => call<string | null>('access_token', undefined, null),
  signOut: () => call<void>('sign_out', undefined, undefined),
  groveShow: () => call<void>('grove_show', undefined, undefined),
  groveHide: () => call<void>('grove_hide', undefined, undefined),
  onEvent: async (event: string, handler: (payload: unknown) => void): Promise<() => void> => {
    if (!('__TAURI_INTERNALS__' in window)) return () => {};
    const { listen } = await import('@tauri-apps/api/event');
    return listen(event, (e) => handler(e.payload));
  },
};
