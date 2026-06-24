import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { isShell, desktopBridge } from './bridge';

// ---------------------------------------------------------------------------
// Helpers to install / remove the Tauri global shim on globalThis.
// Tests run in Node (no jsdom) — bridge.ts uses globalThis, so this works.
// ---------------------------------------------------------------------------

type InvokeMock = ReturnType<typeof vi.fn<() => Promise<unknown>>>;

let mockInvoke: InvokeMock;

// Typed cast so we can add/delete Tauri globals safely.
const g = globalThis as Record<string, unknown>;

function installTauriInternals(result: unknown = null) {
  mockInvoke = vi.fn<() => Promise<unknown>>().mockResolvedValue(result);
  g['__TAURI_INTERNALS__'] = { invoke: mockInvoke };
}

function removeTauriGlobals() {
  delete g['__TAURI_INTERNALS__'];
  delete g['__TAURI__'];
}

// ---------------------------------------------------------------------------
// isShell()
// ---------------------------------------------------------------------------

describe('isShell()', () => {
  afterEach(() => removeTauriGlobals());

  it('returns false when no Tauri global is present', () => {
    removeTauriGlobals();
    expect(isShell()).toBe(false);
  });

  it('returns true when __TAURI_INTERNALS__ is set', () => {
    installTauriInternals();
    expect(isShell()).toBe(true);
  });

  it('returns true when __TAURI__ is set', () => {
    g['__TAURI__'] = { core: { invoke: vi.fn<() => Promise<unknown>>().mockResolvedValue(null) } };
    expect(isShell()).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// desktopBridge — non-shell fallbacks (no Tauri globals installed)
// ---------------------------------------------------------------------------

describe('desktopBridge (non-shell)', () => {
  beforeEach(() => removeTauriGlobals());
  afterEach(() => removeTauriGlobals());

  it('studyStatus() returns DAEMON_OFFLINE fallback without throwing', async () => {
    const result = await desktopBridge.studyStatus();
    expect(result.state).toBe('DAEMON_OFFLINE');
    expect(result.remaining_ms).toBeNull();
  });

  it('reviewData() returns empty array without throwing', async () => {
    expect(await desktopBridge.reviewData()).toEqual([]);
  });

  it('reviewDelete() resolves to undefined without throwing', async () => {
    expect(await desktopBridge.reviewDelete(['id-1'])).toBeUndefined();
  });

  it('reviewKeep() resolves to undefined without throwing', async () => {
    expect(await desktopBridge.reviewKeep(['id-1'])).toBeUndefined();
  });

  it('pause() resolves without throwing', async () => {
    expect(await desktopBridge.pause()).toBeUndefined();
  });

  it('resume() resolves without throwing', async () => {
    expect(await desktopBridge.resume()).toBeUndefined();
  });

  it('stopEarly() resolves without throwing', async () => {
    expect(await desktopBridge.stopEarly()).toBeUndefined();
  });

  it('deleteEverything() resolves without throwing', async () => {
    expect(await desktopBridge.deleteEverything()).toBeUndefined();
  });

  it('consent() resolves without throwing', async () => {
    expect(await desktopBridge.consent()).toBeUndefined();
  });

  it('start() resolves without throwing', async () => {
    expect(await desktopBridge.start()).toBeUndefined();
  });

  it('accessToken() returns null without throwing', async () => {
    expect(await desktopBridge.accessToken()).toBeNull();
  });

  it('exclusions() returns empty array without throwing', async () => {
    expect(await desktopBridge.exclusions()).toEqual([]);
  });

  it('addExclusion() resolves without throwing', async () => {
    expect(await desktopBridge.addExclusion({ host: 'example.com' })).toBeUndefined();
  });

  it('removeExclusion() resolves without throwing', async () => {
    expect(await desktopBridge.removeExclusion({ host: 'example.com' })).toBeUndefined();
  });

  it('fieldNotes() returns empty array without throwing', async () => {
    expect(await desktopBridge.fieldNotes()).toEqual([]);
  });

  it('captureHealth() returns fallback without throwing', async () => {
    const result = await desktopBridge.captureHealth();
    expect(result.healthy).toBe(false);
  });

  it('buildPacket() returns null without throwing', async () => {
    expect(await desktopBridge.buildPacket()).toBeNull();
  });

  it('onStudyStateChange() returns a no-op unsubscribe without throwing', async () => {
    const unsub = await desktopBridge.onStudyStateChange(() => {});
    expect(typeof unsub).toBe('function');
    expect(() => unsub()).not.toThrow();
  });

  it('onCaptureHealth() returns a no-op unsubscribe without throwing', async () => {
    const unsub = await desktopBridge.onCaptureHealth(() => {});
    expect(typeof unsub).toBe('function');
    expect(() => unsub()).not.toThrow();
  });

  it('finalizeReview() returns inert fallback off-shell', async () => {
    await expect(desktopBridge.finalizeReview()).resolves.toEqual({ proposals_requested: false });
  });

  it('deriveObservationSummary() returns null off-shell', async () => {
    await expect(desktopBridge.deriveObservationSummary()).resolves.toBeNull();
  });
});

// ---------------------------------------------------------------------------
// desktopBridge — in-shell invoke wiring
// ---------------------------------------------------------------------------

describe('desktopBridge (in-shell)', () => {
  beforeEach(() => removeTauriGlobals());
  afterEach(() => removeTauriGlobals());

  it('studyStatus() invokes "study_status" and returns the mocked result', async () => {
    const status = {
      state: 'RUNNING',
      remaining_ms: 5000,
      paused: false,
      pipeline_halted: false,
      daemon_health: 'ok',
      capture_blocked: null,
      study: { id: 'abc' },
    };
    installTauriInternals(status);
    const result = await desktopBridge.studyStatus();
    expect(mockInvoke).toHaveBeenCalledWith('study_status', undefined);
    expect(result.state).toBe('RUNNING');
    expect(result.remaining_ms).toBe(5000);
  });

  it('reviewData() invokes "review_events" and returns the mocked list', async () => {
    const events = [{ v: 1, id: 'e1' }];
    installTauriInternals(events);
    const result = await desktopBridge.reviewData();
    expect(mockInvoke).toHaveBeenCalledWith('review_events', undefined);
    expect(result).toEqual(events);
  });

  it('reviewDelete() invokes "review_delete" with {ids}', async () => {
    installTauriInternals(undefined);
    await desktopBridge.reviewDelete(['id-1', 'id-2']);
    expect(mockInvoke).toHaveBeenCalledWith('review_delete', { ids: ['id-1', 'id-2'] });
  });

  it('reviewKeep() invokes "review_keep" with {ids}', async () => {
    installTauriInternals(undefined);
    await desktopBridge.reviewKeep(['id-3']);
    expect(mockInvoke).toHaveBeenCalledWith('review_keep', { ids: ['id-3'] });
  });

  it('pause() invokes "send_control" with {cmd:"pause"}', async () => {
    installTauriInternals(undefined);
    await desktopBridge.pause();
    expect(mockInvoke).toHaveBeenCalledWith('send_control', { cmd: 'pause' });
  });

  it('resume() invokes "send_control" with {cmd:"resume"}', async () => {
    installTauriInternals(undefined);
    await desktopBridge.resume();
    expect(mockInvoke).toHaveBeenCalledWith('send_control', { cmd: 'resume' });
  });

  it('stopEarly() invokes "send_control" with {cmd:"stop_early"}', async () => {
    installTauriInternals(undefined);
    await desktopBridge.stopEarly();
    expect(mockInvoke).toHaveBeenCalledWith('send_control', { cmd: 'stop_early' });
  });

  it('deleteEverything() invokes "send_control" with {cmd:"delete_everything"}', async () => {
    installTauriInternals(undefined);
    await desktopBridge.deleteEverything();
    expect(mockInvoke).toHaveBeenCalledWith('send_control', { cmd: 'delete_everything' });
  });

  it('consent() invokes "send_control" with {cmd:"consent"}', async () => {
    installTauriInternals(undefined);
    await desktopBridge.consent();
    expect(mockInvoke).toHaveBeenCalledWith('send_control', { cmd: 'consent' });
  });

  it('start() invokes "send_control" with {cmd:"start"}', async () => {
    installTauriInternals(undefined);
    await desktopBridge.start();
    expect(mockInvoke).toHaveBeenCalledWith('send_control', { cmd: 'start' });
  });

  it('createStudy() invokes "create_study" with correct args', async () => {
    installTauriInternals(undefined);
    await desktopBridge.createStudy('study-1', 'full_study', 'My Study', 'detailed');
    expect(mockInvoke).toHaveBeenCalledWith('create_study', {
      id: 'study-1',
      kind: 'full_study',
      label: 'My Study',
      depth: 'detailed',
    });
  });

  it('createStudy() uses "lite" as default depth', async () => {
    installTauriInternals(undefined);
    await desktopBridge.createStudy('study-2', 'quick_scan', null);
    expect(mockInvoke).toHaveBeenCalledWith('create_study', {
      id: 'study-2',
      kind: 'quick_scan',
      label: null,
      depth: 'lite',
    });
  });

  it('accessToken() invokes "access_token" and returns the token', async () => {
    installTauriInternals('tok-abc');
    const result = await desktopBridge.accessToken();
    expect(mockInvoke).toHaveBeenCalledWith('access_token', undefined);
    expect(result).toBe('tok-abc');
  });

  it('exclusions() invokes "exclusions" and returns the list', async () => {
    const list = [{ host: 'bank.example.com' }];
    installTauriInternals(list);
    const result = await desktopBridge.exclusions();
    expect(mockInvoke).toHaveBeenCalledWith('exclusions', undefined);
    expect(result).toEqual(list);
  });

  it('addExclusion() invokes "add_exclusion" with normalised args', async () => {
    installTauriInternals(undefined);
    await desktopBridge.addExclusion({ host: 'example.com' });
    expect(mockInvoke).toHaveBeenCalledWith('add_exclusion', {
      host: 'example.com',
      bundleId: null,
      appName: null,
    });
  });

  it('removeExclusion() invokes "remove_exclusion" with normalised args', async () => {
    installTauriInternals(undefined);
    await desktopBridge.removeExclusion({ appName: 'Slack' });
    expect(mockInvoke).toHaveBeenCalledWith('remove_exclusion', {
      host: null,
      bundleId: null,
      appName: 'Slack',
    });
  });

  it('fieldNotes() invokes "field_notes" and returns the list', async () => {
    const notes = [{ id: 'n1', ts: '2026-01-01T00:00:00Z', content: 'hello' }];
    installTauriInternals(notes);
    const result = await desktopBridge.fieldNotes();
    expect(mockInvoke).toHaveBeenCalledWith('field_notes', undefined);
    expect(result).toEqual(notes);
  });

  it('degrades to fallback when native command throws', async () => {
    installTauriInternals(undefined);
    mockInvoke.mockRejectedValue(new Error('command not found: exclusions'));
    const result = await desktopBridge.exclusions();
    expect(result).toEqual([]);
  });

  it('finalizeReview() invokes "finalize_review" and returns the mocked result', async () => {
    installTauriInternals({ proposals_requested: true });
    const result = await desktopBridge.finalizeReview();
    expect(mockInvoke).toHaveBeenCalledWith('finalize_review', undefined);
    expect(result).toEqual({ proposals_requested: true });
  });

  it('deriveObservationSummary() invokes "derive_observation_summary" and returns the mocked result', async () => {
    const summary = {
      study_id: 's1',
      study_period: { start: '2026-06-20', end: '2026-06-21' },
      total_events_reviewed: 20,
      active_ms: 600_000,
      top_apps: [{ name: 'Figma', durationMs: 400_000 }],
      busiest_hour: 9,
      workflow_shapes: [{ pattern: 'Figma→Slack', frequency: 3 }],
      gap_count: 1,
    };
    installTauriInternals(summary);
    const result = await desktopBridge.deriveObservationSummary();
    expect(mockInvoke).toHaveBeenCalledWith('derive_observation_summary', undefined);
    expect(result).toEqual(summary);
  });

  it('deriveObservationSummary() degrades to null when command throws (absent Rust command)', async () => {
    installTauriInternals(undefined);
    mockInvoke.mockRejectedValue(new Error('command not found: derive_observation_summary'));
    const result = await desktopBridge.deriveObservationSummary();
    expect(result).toBeNull();
  });

  it('finalizeReview() degrades to inert fallback when command throws (absent Rust command)', async () => {
    installTauriInternals(undefined);
    mockInvoke.mockRejectedValue(new Error('command not found: finalize_review'));
    const result = await desktopBridge.finalizeReview();
    expect(result).toEqual({ proposals_requested: false });
  });

  it('onStudyStateChange() subscribes to the "study:status" event the shell actually emits', async () => {
    // Regression: the bridge previously listened for "study_state_change", which
    // nothing emits. The Tauri shell emits "study:status" ~1×/sec (see
    // apps/desktop/src-tauri/app/src/lib.rs countdown refresher). If this name
    // drifts again the live countdown freezes and pause/stop stop reflecting.
    const listen = vi.fn<() => Promise<() => void>>().mockResolvedValue(() => {});
    g['__TAURI_INTERNALS__'] = { invoke: vi.fn(), event: { listen } };

    const cb = vi.fn();
    await desktopBridge.onStudyStateChange(cb);

    expect(listen).toHaveBeenCalledTimes(1);
    expect(listen).toHaveBeenCalledWith('study:status', expect.any(Function));
  });

  it('onStudyStateChange() forwards the event payload to the callback', async () => {
    type Handler = (e: { payload: unknown }) => void;
    let captured: Handler | null = null;
    const listen = vi
      .fn<(event: string, handler: Handler) => Promise<() => void>>()
      .mockImplementation((_event, handler) => {
        captured = handler;
        return Promise.resolve(() => {});
      });
    g['__TAURI_INTERNALS__'] = { invoke: vi.fn(), event: { listen } };

    const cb = vi.fn();
    await desktopBridge.onStudyStateChange(cb);

    const payload = { state: 'ACTIVE', remaining_ms: 12345 };
    (captured as Handler | null)?.({ payload });
    expect(cb).toHaveBeenCalledWith(payload);
  });
});
