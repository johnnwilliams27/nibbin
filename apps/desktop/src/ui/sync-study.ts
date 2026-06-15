/**
 * Field-study cloud sync (design 2026-06-15). Build the diagnosis packet
 * on-device, upload it Bearer-authed, and advance the study ONLY on a 200 —
 * holding at Synthesizing on any failure so the daemon never deletes raw data
 * before the packet is safely off-device (C3).
 */
import { segmentStudy } from '@nibbin/redaction';

export type SyncState = 'building' | 'uploading' | 'done' | 'error';

const WEB_ORIGIN = 'https://nibbin.com';

interface SyncBridge {
  reviewEvents(): Promise<unknown[]>;
  accessToken(): Promise<string | null>;
  sendControl(cmd: string): Promise<void>;
}

export async function syncStudy(opts: {
  studyId: string;
  bridge: SyncBridge;
  now: string;
  /** Study kind + task label, read off the study snapshot, ride the packet to
   * the diagnosis so the web history can badge + name it. */
  kind?: 'full_study' | 'quick_scan';
  label?: string | null;
  fetchFn?: typeof fetch;
  onState?: (s: SyncState) => void;
}): Promise<{ ok: boolean; error?: string }> {
  const { studyId, bridge, now, kind, label, fetchFn = fetch, onState = () => {} } = opts;
  try {
    onState('building');
    const events = (await bridge.reviewEvents()) as Parameters<typeof segmentStudy>[1];
    const packet = await segmentStudy(studyId, events, now, { kind, label });
    const token = await bridge.accessToken();
    if (!token) { onState('error'); return { ok: false, error: 'not_signed_in' }; }

    onState('uploading');
    const res = await fetchFn(`${WEB_ORIGIN}/api/study/packet`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
      body: JSON.stringify(packet),
    });
    if (!res.ok) { onState('error'); return { ok: false, error: `upload_${res.status}` }; }

    // 200 confirmed → safe to let the daemon delete raw data.
    await bridge.sendControl('synthesis_complete');
    onState('done');
    return { ok: true };
  } catch (e) {
    onState('error');
    return { ok: false, error: e instanceof Error ? e.message : 'sync_failed' };
  }
}
